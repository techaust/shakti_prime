import {
  DomainError,
  hasGrant,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  QuoteStateSchema,
  SalesOrderStateSchema,
  type AskSource,
  type PlaybookAudience,
  type Principal,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { z } from 'zod';
import { executeQuery } from '../../command/execute';
import { istCalendarDate } from '../../numbering/financial-year';
import { pipelineByStageSql, salesThisMonthSql } from '../../queries/home/home';
import { listLeads } from '../../queries/crm/list-leads';
import { listPipelines } from '../../queries/crm/list-pipelines';
import { approvedPlaybook } from '../../queries/knowledge/playbook';
import { searchKnowledge } from '../../queries/knowledge/vault';
import { listEntities } from '../../queries/org/list-entities';
import { listDealerCredit } from '../../queries/sales/dealer-credit';
import { listSalesOrders } from '../../queries/sales/list-orders';
import { listQuotes } from '../../queries/sales/list-quotes';
import { myProgress, teamProgress } from '../../queries/sales/targets';
import { periodBounds, periodStartOn } from '../../sales/targets';
import { AGENT_DEFAULTS } from '../agent-defaults';
import type { AiProvider } from '../provider';

// The lookups of Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5). Each wraps a query
// the screens already use, run through `executeQuery()` as the person asking, on the reader pool
// where it is set up, for the companies of the conversation: row security and the person's own
// grants decide every row, so a cost or a supplier's rate reaches an answer only where the person
// could read it on a screen. No lookup writes. A lookup is offered only to a person whose grants
// let its query answer.
//
// What a lookup returns is data for the model, never instructions (the wrapper labels it so).
// It names records by id (`ref`, which the answer cites) and by their document numbers, never a
// customer's or a person's name, phone or address: the screen shows each cited record as the
// person may read it. Dates are calendar days in India, amounts rupees as written in the books.

const ASK = AGENT_DEFAULTS.ask;

/** Where and as whom a lookup runs. */
export interface AskToolContext {
  principal: Principal;
  /** The conversation's companies. */
  entityIds: readonly number[];
  requestId: string;
  provider: AiProvider;
  now: Date;
  /** Each company's name as the screens show it, by id. */
  companies: ReadonlyMap<number, string>;
}

/** What one lookup answers: the data the model reads, and the records it may cite. */
export interface AskToolOutput {
  data: Record<string, unknown>;
  sources: AskSource[];
}

export interface AskTool {
  name: string;
  description: string;
  /** The input as a closed JSON schema (strict tools: every property required, none other). */
  inputSchema: Record<string, unknown>;
  input: z.ZodType;
  offered: (principal: Principal) => boolean;
  run: (ctx: AskToolContext, input: unknown) => Promise<AskToolOutput>;
}

type Read = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** A query as the person asking, for the conversation's companies, timed as `ask.<lookup>`. */
function read<T>(ctx: AskToolContext, name: string, query: (c: Read) => Promise<T>): Promise<T> {
  return executeQuery(
    ctx.principal,
    { entityIds: [...ctx.entityIds], requestId: ctx.requestId },
    query,
    { name: `ask.${name}` },
  );
}

const day = (at: string | Date | null): string | null =>
  at === null ? null : istCalendarDate(typeof at === 'string' ? new Date(at) : at);

const company = (ctx: AskToolContext, entityId: number | null): string =>
  entityId === null
    ? 'every company'
    : (ctx.companies.get(entityId) ?? `company ${String(entityId)}`);

const NO_INPUT = { type: 'object', properties: {}, required: [], additionalProperties: false };
const NoInput = z.object({}).strict();

const leadReader = (p: Principal) => hasGrant(p.permissions, 'crm.lead.read', 'own');

const searchVault: AskTool = {
  name: 'search_vault',
  description:
    "Searches the business's own documents (the Knowledge Vault) for passages about a topic: product details, policies, price lists, procedures. Returns the nearest passages with their file's title.",
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string', description: 'What to look for, in a few words.' } },
    required: ['query'],
    additionalProperties: false,
  },
  input: z.object({ query: z.string().trim().min(1).max(300) }).strict(),
  offered: (p) => hasGrant(p.permissions, 'knowledge.vault.read.staff', 'all'),
  async run(ctx, raw) {
    const { query } = z.object({ query: z.string() }).parse(raw);
    if (!ctx.provider.embeddingsAvailable) {
      return { data: { available: false, passages: [] }, sources: [] };
    }
    const { vectors } = await ctx.provider.embed({
      agent: ASK.spendName,
      purpose: 'ask_vault_search',
      entityId: null,
      caps: [{ paise: ASK.dailyCapPaise, entityId: null }],
      person: { id: ctx.principal.id, capPaise: ASK.personDailyCapPaise },
      texts: [query],
      inputType: 'query',
    });
    const vector = vectors[0];
    if (vector?.length !== KNOWLEDGE_EMBEDDING_DIMENSIONS) {
      throw new DomainError('integration_unavailable', 'the search answered no embedding');
    }
    const hits = await read(ctx, 'search_vault', (c) =>
      searchKnowledge(c, vector, ASK.passagesPerSearch),
    );
    return {
      data: {
        passages: hits.map((h) => ({ ref: h.knowledgeFileId, title: h.title, text: h.text })),
      },
      sources: hits.map((h) => ({ kind: 'knowledge_file', id: h.knowledgeFileId })),
    };
  },
};

const readPlaybook: AskTool = {
  name: 'read_playbook',
  description:
    "Reads the business's approved Playbook: the policies, priorities, procedures, common questions and tone the Executives approved. Returns each rule with its type and title.",
  inputSchema: NO_INPUT,
  input: NoInput,
  offered: (p) => hasGrant(p.permissions, 'knowledge.vault.read.staff', 'all'),
  async run(ctx) {
    const audiences: PlaybookAudience[] = ['customer', 'staff'];
    if (hasGrant(ctx.principal.permissions, 'knowledge.vault.read.management', 'all')) {
      audiences.push('management');
    }
    const directives = await read(ctx, 'read_playbook', async (c) => {
      const out: Awaited<ReturnType<typeof approvedPlaybook>>['directives'] = [];
      let cursor: string | null = null;
      do {
        const page = await approvedPlaybook(c, {
          audiences,
          limit: Math.min(500, ASK.directivesRead - out.length),
          ...(cursor === null ? {} : { cursor }),
        });
        out.push(...page.directives);
        cursor = page.nextCursor;
      } while (cursor !== null && out.length < ASK.directivesRead);
      return out;
    });
    return {
      data: {
        rules: directives.map((d) => ({
          ref: d.id,
          company: company(ctx, d.entityId),
          type: d.type,
          for: d.audience,
          title: d.title,
          text: d.text,
        })),
      },
      sources: directives.map((d) => ({ kind: 'playbook_directive', id: d.id })),
    };
  },
};

const pipelineByStage: AskTool = {
  name: 'pipeline_by_stage',
  description:
    'Counts the open leads the person may see in each stage of each sales pipeline, per company.',
  inputSchema: NO_INPUT,
  input: NoInput,
  offered: leadReader,
  async run(ctx) {
    const rows = await read(ctx, 'pipeline_by_stage', async (c) => {
      if (!leadReader(c.principal)) throw new DomainError('forbidden', 'crm.lead.read is required');
      return (await c.tx.execute(pipelineByStageSql(c.entityIds))) as unknown as {
        entity_id: number;
        pipeline_name: string;
        stage_id: string;
        stage_name: string;
        leads: number;
      }[];
    });
    return {
      data: {
        stages: rows.map((r) => ({
          ref: r.stage_id,
          company: company(ctx, r.entity_id),
          pipeline: r.pipeline_name,
          stage: r.stage_name,
          openLeads: r.leads,
        })),
      },
      sources: rows.map((r) => ({ kind: 'pipeline_stage', id: r.stage_id })),
    };
  },
};

const listLeadsTool: AskTool = {
  name: 'list_leads',
  description:
    'Lists the leads the person may see, newest change first or highest score first: each with its company, pipeline stage, state, score and the day it last changed.',
  inputSchema: {
    type: 'object',
    properties: {
      order: {
        type: 'string',
        enum: ['recent', 'score'],
        description: 'Newest change or highest score first.',
      },
    },
    required: ['order'],
    additionalProperties: false,
  },
  input: z.object({ order: z.enum(['recent', 'score']) }).strict(),
  offered: leadReader,
  async run(ctx, raw) {
    const { order } = z.object({ order: z.enum(['recent', 'score']) }).parse(raw);
    const { page, stages } = await read(ctx, 'list_leads', async (c) => {
      const leads = await listLeads(c, {
        limit: ASK.rowsPerLookup,
        sort: { column: order === 'score' ? 'score' : 'updated', direction: 'desc' },
      });
      const pipelines = await listPipelines(c);
      return {
        page: leads,
        stages: new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s.name] as const))),
      };
    });
    return {
      data: {
        leads: page.items.map((l) => ({
          ref: l.id,
          company: company(ctx, l.entityId),
          customerType: l.account.type,
          stage: stages.get(l.stageId) ?? null,
          state: l.state,
          score: l.score,
          lastChanged: day(l.updatedAt),
        })),
        more: page.nextCursor !== null,
      },
      sources: page.items.map((l) => ({ kind: 'opportunity', id: l.id })),
    };
  },
};

const QUOTE_STATES = QuoteStateSchema.options;

const listQuotesTool: AskTool = {
  name: 'list_quotes',
  description:
    'Lists the newest quotes the person may see, of one state or every state: number, company, state, grand total in rupees, the day it was made and the day it is valid until.',
  inputSchema: {
    type: 'object',
    properties: { state: { type: ['string', 'null'], enum: [...QUOTE_STATES, null] } },
    required: ['state'],
    additionalProperties: false,
  },
  input: z.object({ state: QuoteStateSchema.nullable() }).strict(),
  offered: leadReader,
  async run(ctx, raw) {
    const { state } = z.object({ state: QuoteStateSchema.nullable() }).parse(raw);
    const page = await read(ctx, 'list_quotes', (c) =>
      listQuotes(c, { limit: ASK.rowsPerLookup, ...(state === null ? {} : { state }) }, ctx.now),
    );
    return {
      data: {
        quotes: page.items.map((q) => ({
          ref: q.id,
          lead: q.opportunityId,
          company: company(ctx, q.entityId),
          number: q.quoteNo,
          state: q.state,
          grandTotal: q.grandTotal,
          made: day(q.createdAt),
          validUntil: day(q.validUntil),
        })),
        more: page.nextCursor !== null,
      },
      sources: page.items.flatMap((q): AskSource[] => [
        { kind: 'quote', id: q.id },
        { kind: 'opportunity', id: q.opportunityId },
      ]),
    };
  },
};

const ORDER_STATES = SalesOrderStateSchema.options;

const listOrdersTool: AskTool = {
  name: 'list_orders',
  description:
    'Lists the newest sales orders the person may see, of one state or every state: number, company, state, whether it is held for credit, grand total in rupees and the day it was made.',
  inputSchema: {
    type: 'object',
    properties: { state: { type: ['string', 'null'], enum: [...ORDER_STATES, null] } },
    required: ['state'],
    additionalProperties: false,
  },
  input: z.object({ state: SalesOrderStateSchema.nullable() }).strict(),
  offered: leadReader,
  async run(ctx, raw) {
    const { state } = z.object({ state: SalesOrderStateSchema.nullable() }).parse(raw);
    const page = await read(ctx, 'list_orders', (c) =>
      listSalesOrders(c, { limit: ASK.rowsPerLookup, ...(state === null ? {} : { state }) }),
    );
    return {
      data: {
        orders: page.items.map((o) => ({
          ref: o.id,
          lead: o.opportunityId,
          quote: o.quoteId,
          company: company(ctx, o.entityId),
          number: o.soNo,
          state: o.state,
          heldForCredit: o.creditHeld,
          grandTotal: o.grandTotal,
          made: day(o.createdAt),
        })),
        more: page.nextCursor !== null,
      },
      sources: page.items.flatMap((o): AskSource[] => [
        { kind: 'sales_order', id: o.id },
        ...(o.opportunityId === null
          ? []
          : [{ kind: 'opportunity' as const, id: o.opportunityId }]),
        ...(o.quoteId === null ? [] : [{ kind: 'quote' as const, id: o.quoteId }]),
      ]),
    };
  },
};

const salesThisMonth: AskTool = {
  name: 'sales_this_month',
  description:
    "This month's sales per company, counted from the quotes and orders the person may see: quotes sent and waiting, quotes accepted this month, orders confirmed this month and their total in rupees.",
  inputSchema: NO_INPUT,
  input: NoInput,
  offered: leadReader,
  async run(ctx) {
    const startsOn = periodStartOn('month', ctx.now);
    const { from, to } = periodBounds('month', startsOn);
    const rows = await read(ctx, 'sales_this_month', async (c) => {
      if (!leadReader(c.principal)) throw new DomainError('forbidden', 'crm.lead.read is required');
      return (await c.tx.execute(salesThisMonthSql(c.entityIds, from, to))) as unknown as {
        entity_id: number;
        quotes_sent: number;
        quotes_accepted: number;
        orders_confirmed: number;
        orders_value: string;
      }[];
    });
    return {
      data: {
        monthStarts: startsOn,
        companies: rows.map((r) => ({
          company: company(ctx, r.entity_id),
          quotesSentWaiting: r.quotes_sent,
          quotesAcceptedThisMonth: r.quotes_accepted,
          ordersConfirmedThisMonth: r.orders_confirmed,
          ordersConfirmedValue: r.orders_value,
        })),
      },
      sources: [],
    };
  },
};

/** A metric's progress as the model reads it: the share of the target as a whole percent. */
const progress = (m: {
  metric: string;
  target: number | null;
  actual: number;
  fraction: number | null;
}) => ({
  metric: m.metric,
  target: m.target,
  actual: m.actual,
  percentOfTarget: m.fraction === null ? null : Math.round(m.fraction * 100),
});

const targetsTool: AskTool = {
  name: 'targets_progress',
  description:
    "The person's own targets and progress for today, this week and this month per company, and, for a team lead, their team's totals against the team's targets this month.",
  inputSchema: NO_INPUT,
  input: NoInput,
  offered: () => true,
  async run(ctx) {
    const lead = hasGrant(ctx.principal.permissions, 'sales.targets.write', 'team');
    const { mine, team } = await read(ctx, 'targets_progress', async (c) => ({
      mine: await myProgress(c, {}, ctx.now),
      team: lead ? await teamProgress(c, { period: 'month' }, ctx.now) : [],
    }));
    return {
      data: {
        mine: mine.map((m) => ({
          company: company(ctx, m.entityId),
          periods: m.periods.map((p) => ({
            period: p.period,
            from: p.startsOn,
            to: p.endsOn,
            metrics: p.metrics.map(progress),
          })),
        })),
        // The team's totals only: the callers are not named to the model.
        teams: team.map((t) => ({
          company: company(ctx, t.entityId),
          period: t.period,
          from: t.startsOn,
          to: t.endsOn,
          callers: t.leaderboard.length,
          metrics: t.team.map(progress),
        })),
      },
      sources: [],
    };
  },
};

const creditHolder = (p: Principal) => hasGrant(p.permissions, 'sales.credit.write', 'entity');

const dealerCredit: AskTool = {
  name: 'dealer_credit',
  description:
    "Each dealer's credit in each company: credit limit and days, outstanding and the day it stands at, confirmed orders not yet invoiced, the exposure the credit check reads, and the oldest unpaid invoice with its age in days.",
  inputSchema: NO_INPUT,
  input: NoInput,
  offered: creditHolder,
  async run(ctx) {
    const rows = await read(ctx, 'dealer_credit', async (c) => {
      const out: {
        entityId: number;
        row: Awaited<ReturnType<typeof listDealerCredit>>['items'][number];
      }[] = [];
      for (const entityId of c.entityIds) {
        const page = await listDealerCredit(c, { entityId, limit: ASK.rowsPerLookup }, ctx.now);
        out.push(...page.items.map((row) => ({ entityId, row })));
      }
      return out;
    });
    return {
      data: {
        dealers: rows.map(({ entityId, row }) => ({
          ref: row.accountId,
          company: company(ctx, entityId),
          creditLimit: row.creditLimit,
          creditDays: row.creditDays,
          outstanding: row.outstanding,
          outstandingAsOf: row.asOf,
          confirmedNotInvoiced: row.confirmedUnpaid,
          exposure: row.exposure,
          oldestUnpaidInvoice: row.oldestUnpaidInvoiceNo,
          oldestUnpaidOn: row.oldestUnpaidInvoiceDate,
          oldestUnpaidAgeDays: row.oldestUnpaidAgeDays,
        })),
      },
      sources: rows.map(({ row }) => ({ kind: 'account', id: row.accountId })),
    };
  },
};

/** Every lookup, in the order the model is offered them. */
export const ASK_TOOLS: readonly AskTool[] = [
  searchVault,
  readPlaybook,
  pipelineByStage,
  listLeadsTool,
  listQuotesTool,
  listOrdersTool,
  salesThisMonth,
  targetsTool,
  dealerCredit,
];

/** The lookups a person's grants let answer. */
export function toolsFor(principal: Principal): AskTool[] {
  return ASK_TOOLS.filter((t) => t.offered(principal));
}

/** Each company's name as the screens show it, read as the person. */
export async function companyNames(
  principal: Principal,
  entityIds: readonly number[],
  requestId: string,
): Promise<Map<number, string>> {
  const rows = await executeQuery(
    principal,
    { entityIds: [...entityIds], requestId },
    (c) => listEntities(c),
    { name: 'ask.companies' },
  );
  return new Map(rows.map((e) => [e.id, e.brandName]));
}
