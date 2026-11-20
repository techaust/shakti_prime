import {
  COPILOT_ACTION_TYPES,
  COPILOT_FACTS,
  CopilotFactsSchema,
  CopilotPanelDto,
  CopilotPanelInput,
  CopilotReportDto,
  DomainError,
  hasGrant,
  IdSchema,
  ShadowReportInput,
  type CopilotFact,
  type CopilotOutcomeAgreement,
  type CopilotPanelNoteDto,
  type CopilotReportFactDto,
  type ShadowAgreement,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AGENT_DEFAULTS } from '../../ai/agent-defaults';
import { checkPermission, isAgent } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { checkShadowReader, istEndAfter, istStart } from './shadow-report';
import { agentRefusals, proposalFigures, refusalsByReason, spendPerLead } from './shadow-pack';
import { listInbox } from './inbox';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

// The Caller Co-pilot's screens (docs/03-roadmap-appendix/phase2.md §7.3): the panel of one lead in
// the Cold Caller and Lead Converter workspaces, and the shadow report on Admin › Agents. Both read
// under the viewer's own policies: a lead's notes come with the lead (`copilot_notes_read`), the
// suggestions with the viewer's inbox scope, the report's leads and customers as the viewer reads
// them.

/**
 * When the lead's newest brief was written or started since `since`: a brief note, a person's
 * request for one, or an assignment that started one (`app.copilot_brief_started_at()`); null
 * when none was. Asking for a brief and the panel's button both count all three, so a brief is
 * asked for at most once an hour whether or not one came of it. The lead is one the caller has
 * already read under its own policies.
 */
export async function copilotBriefStartedAt(
  ctx: Pick<RequestContext, 'tx'>,
  lead: { entityId: number; id: string },
  since: Date,
): Promise<Date | null> {
  const d = AGENT_DEFAULTS.copilot;
  const n = schema.copilotNotes;
  const [note] = await ctx.tx
    .select({ at: n.createdAt })
    .from(n)
    .where(and(eq(n.opportunityId, lead.id), eq(n.kind, 'brief'), gt(n.createdAt, since)))
    .orderBy(desc(n.createdAt), desc(n.id))
    .limit(1);
  const [started] = (await ctx.tx.execute(sql`
    select app.copilot_brief_started_at(${lead.entityId}::smallint, ${lead.id}::uuid,
             ${since.toISOString()}::timestamptz,
             make_interval(hours => ${d.assignedBriefSkipHours}::integer)) as at`)) as unknown as {
    at: Date | string | null;
  }[];
  const times = [note?.at, started?.at ?? null]
    .filter((t): t is Date | string => t !== undefined && t !== null)
    .map((t) => new Date(t).getTime());
  return times.length === 0 ? null : new Date(Math.max(...times));
}

/** How many of the Co-pilot's open suggestions on one lead the panel shows. */
export const COPILOT_PANEL_SUGGESTIONS = 20;

interface NoteRow {
  id: string;
  kind: string;
  body: string;
  fields: unknown;
  providerCallId: string | null;
  suggestedDispositionId: string | null;
  outcomeLabel: string | null;
  shown: boolean;
  createdAt: Date;
}

/** A note as the panel shows it: a summary written in Shadow shows its text alone. */
function panelNote(row: NoteRow | undefined): CopilotPanelNoteDto | null {
  if (row === undefined) return null;
  const fields = CopilotFactsSchema.safeParse(row.fields);
  return {
    id: row.id,
    kind: row.kind === 'brief' ? 'brief' : 'call_summary',
    body: row.body,
    fields: row.shown && fields.success ? fields.data : {},
    providerCallId: row.providerCallId,
    suggestedDispositionId: row.shown ? row.suggestedDispositionId : null,
    suggestedOutcomeLabel: row.shown ? row.outcomeLabel : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The Co-pilot panel of one lead the caller reads: its newest brief, the newest summary of a dial
 * call of the lead (a call with no lead is never read here), the outcome to pre-select from the
 * summary of the caller's own latest dial of the lead while that call is not logged yet, when a
 * brief may next be asked for, and the Co-pilot's open suggestions on the lead in the caller's
 * inbox scope. A summary written in Shadow shows its text alone: no facts heard, no outcome
 * (`suggestions_shown`, the lead's decision of 18-11-2026). A person's screen: an agent never reads
 * it.
 */
export async function loadCopilotPanel(ctx: Ctx, rawInput: unknown): Promise<CopilotPanelDto> {
  const input = parseQueryInput(CopilotPanelInput, rawInput, 'agents.copilot.panel');
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the Co-pilot panel is for people, not agents');
  }
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'the company is not in this request');
  }
  const o = schema.opportunities;
  const [lead] = await ctx.tx
    .select({ id: o.id })
    .from(o)
    .where(and(eq(o.id, input.opportunityId), eq(o.entityId, input.entityId), isNull(o.archivedAt)))
    .limit(1);
  if (lead === undefined) {
    throw new DomainError('not_found', `opportunity ${input.opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }

  const n = schema.copilotNotes;
  const d = schema.callDispositions;
  const pc = schema.providerCalls;
  const columns = {
    id: n.id,
    kind: n.kind,
    body: n.body,
    fields: n.fieldsJson,
    providerCallId: n.providerCallId,
    suggestedDispositionId: n.suggestedDispositionId,
    outcomeLabel: d.label,
    shown: n.suggestionsShown,
    createdAt: n.createdAt,
  };
  const [brief] = await ctx.tx
    .select(columns)
    .from(n)
    .leftJoin(d, eq(d.id, n.suggestedDispositionId))
    .where(and(eq(n.opportunityId, lead.id), eq(n.kind, 'brief')))
    .orderBy(desc(n.createdAt), desc(n.id))
    .limit(1);
  const [summary] = await ctx.tx
    .select(columns)
    .from(n)
    .innerJoin(
      pc,
      and(
        eq(pc.id, n.providerCallId),
        eq(pc.opportunityId, n.opportunityId),
        eq(pc.direction, 'outbound'),
      ),
    )
    .leftJoin(d, eq(d.id, n.suggestedDispositionId))
    .where(and(eq(n.opportunityId, lead.id), eq(n.kind, 'call_summary')))
    .orderBy(desc(n.createdAt), desc(n.id))
    .limit(1);

  // The outcome to pre-select: the summary of the caller's own latest dial of the lead, while that
  // call is not logged yet and the summary's suggestions are shown.
  const [mine] = await ctx.tx
    .select({ id: pc.id, logged: sql<boolean>`${pc.callId} is not null` })
    .from(pc)
    .where(
      and(
        eq(pc.opportunityId, lead.id),
        eq(pc.entityId, input.entityId),
        eq(pc.direction, 'outbound'),
        eq(pc.callerId, ctx.principal.id),
      ),
    )
    .orderBy(desc(pc.startedAt), desc(pc.id))
    .limit(1);
  let preselect: string | null = null;
  if (mine !== undefined && !mine.logged) {
    const [own] = await ctx.tx
      .select({ id: n.suggestedDispositionId })
      .from(n)
      .where(
        and(
          eq(n.providerCallId, mine.id),
          eq(n.opportunityId, lead.id),
          eq(n.kind, 'call_summary'),
          eq(n.suggestionsShown, true),
        ),
      )
      .limit(1);
    preselect = own?.id ?? null;
  }

  // A brief may be asked for an hour after the newest one written, asked for or started.
  const intervalMs = AGENT_DEFAULTS.copilot.briefIntervalMinutes * 60_000;
  const now = Date.now();
  const started = await copilotBriefStartedAt(
    ctx,
    { entityId: input.entityId, id: lead.id },
    new Date(now - intervalMs),
  );
  const nextBrief = started === null ? undefined : started.getTime() + intervalMs;

  const suggestions = hasGrant(ctx.principal.permissions, 'agents.inbox.act', 'own')
    ? (
        await listInbox(ctx, {
          limit: COPILOT_PANEL_SUGGESTIONS,
          subjectId: lead.id,
          agent: 'agent:copilot',
        })
      ).items
    : [];

  // What each suggestion to record the heard facts would record (its card shows no values).
  const factItems = suggestions
    .filter((item) => item.actionType === COPILOT_ACTION_TYPES.qualification)
    .map((item) => item.id);
  const suggestedFacts: Record<string, unknown> = {};
  if (factItems.length > 0) {
    const i = schema.inboxItems;
    const a = schema.agentActions;
    const rows = await ctx.tx
      .select({ itemId: i.id, facts: sql<unknown>`${a.inputJson} -> 'facts'` })
      .from(i)
      .innerJoin(a, and(eq(a.id, i.agentActionId), eq(a.entityId, i.entityId)))
      .where(inArray(i.id, factItems));
    for (const row of rows) {
      const facts = CopilotFactsSchema.safeParse(row.facts);
      if (facts.success) suggestedFacts[row.itemId] = facts.data;
    }
  }

  return CopilotPanelDto.parse({
    entityId: input.entityId,
    opportunityId: lead.id,
    brief: panelNote(brief),
    summary: panelNote(summary),
    preselectDispositionId: preselect,
    nextBriefAt:
      nextBrief === undefined || nextBrief <= now ? null : new Date(nextBrief).toISOString(),
    suggestions,
    suggestedFacts,
  });
}

const Cursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** The lead's recorded value of each fact, by its column. */
const RECORDED: Readonly<Record<CopilotFact, string>> = {
  pumpDepthFt: 'pump_depth_ft',
  requiredHp: 'required_hp',
  monthlyBillRupees: 'monthly_bill_rupees',
  roofAreaSqFt: 'roof_area_sq_ft',
  sanctionedLoadKw: 'sanctioned_load_kw',
};

/**
 * The call summaries of one company in a period whose suggestions callers did not see (written in
 * Shadow), newest first, with the outcome each suggested, the outcome the caller logged for its
 * call and the lead's recorded facts. Keyset on `(created_at, id)` over
 * `copilot_notes_entity_created_idx`.
 */
export function copilotSummariesSql(
  entityId: number,
  from: string,
  until: string,
  page?: { after: { t: string; id: string } | undefined; limit: number },
) {
  const keyset =
    page?.after === undefined
      ? sql``
      : sql`and (n.created_at, n.id) < (${page.after.t}::timestamptz, ${page.after.id}::uuid)`;
  const paged =
    page === undefined ? sql`` : sql`order by n.created_at desc, n.id desc limit ${page.limit}`;
  return sql`
    select n.created_at::text as t, n.id, n.created_at, n.opportunity_id, o.account_id,
           acc.name as customer_name, n.fields_json as fields,
           n.suggested_disposition_id, sd.label as suggested_label,
           c.disposition_id as logged_id, ld.label as logged_label,
           lq.pump_depth_ft, lq.required_hp, lq.monthly_bill_rupees, lq.roof_area_sq_ft,
           lq.sanctioned_load_kw,
           case
             when n.suggested_disposition_id is null then 'none'
             when c.disposition_id is null then 'pending'
             when c.disposition_id = n.suggested_disposition_id then 'agree'
             else 'disagree'
           end as outcome_agreement
      from (
        select n.* from copilot_notes n
         where n.entity_id = ${entityId} and n.kind = 'call_summary' and not n.suggestions_shown
           and n.created_at >= ${from}::timestamptz and n.created_at < ${until}::timestamptz
           ${keyset}
         ${paged}) n
      left join opportunities o on o.id = n.opportunity_id and o.entity_id = n.entity_id
      left join accounts acc on acc.id = o.account_id
      left join call_dispositions sd on sd.id = n.suggested_disposition_id
      left join provider_calls pc on pc.id = n.provider_call_id and pc.entity_id = n.entity_id
      left join calls c on c.id = pc.call_id
      left join call_dispositions ld on ld.id = c.disposition_id
      left join lead_qualifications lq on lq.opportunity_id = n.opportunity_id`;
}

interface SummaryRow {
  t: string;
  id: string;
  created_at: Date | string;
  opportunity_id: string;
  account_id: string | null;
  customer_name: string | null;
  fields: unknown;
  suggested_label: string | null;
  logged_label: string | null;
  outcome_agreement: CopilotOutcomeAgreement;
  pump_depth_ft: number | string | null;
  required_hp: number | string | null;
  monthly_bill_rupees: number | string | null;
  roof_area_sq_ft: number | string | null;
  sanctioned_load_kw: number | string | null;
}

/** Each fact heard beside the lead's: pending while the lead records none. */
function factLines(row: SummaryRow): CopilotReportFactDto[] {
  const heard = CopilotFactsSchema.safeParse(row.fields);
  if (!heard.success) return [];
  return COPILOT_FACTS.flatMap((fact) => {
    const value = heard.data[fact];
    if (value === undefined) return [];
    const raw = row[RECORDED[fact] as keyof SummaryRow];
    const recorded = raw === null || raw === undefined ? null : Number(raw);
    const agreement: ShadowAgreement =
      recorded === null ? 'pending' : recorded === value ? 'agree' : 'disagree';
    return [{ fact, heard: value, recorded, agreement }];
  });
}

/**
 * The Co-pilot's shadow report (PRD AI-04, design §7.3): for one company and a period of IST days,
 * each call summary written while callers could not see its suggestions, its suggested outcome and
 * heard facts beside what the caller logged and what the lead now records, how often they agree
 * (so the figures measure callers who did not see the suggestion), how many summaries callers saw
 * and are left out, the runs the output filter refused by reason, and the
 * proposals by action type and how they ended.
 */
export async function loadCopilotReport(ctx: Ctx, rawInput: unknown): Promise<CopilotReportDto> {
  const input = parseQueryInput(ShadowReportInput, rawInput, 'agents.copilot.report');
  checkShadowReader(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(Cursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const from = istStart(input.from);
  const until = istEndAfter(input.to);
  const page = (await ctx.tx.execute(sql`
    select * from (${copilotSummariesSql(input.entityId, from, until, {
      after,
      limit: input.limit + 1,
    })}) s order by s.created_at desc, s.id desc`)) as unknown as SummaryRow[];

  const base = copilotSummariesSql(input.entityId, from, until);
  const [outcomes] = (await ctx.tx.execute(sql`
    select count(*)::int as summaries,
           count(*) filter (where s.outcome_agreement = 'agree')::int as agreed,
           count(*) filter (where s.outcome_agreement = 'disagree')::int as disagreed,
           count(*) filter (where s.outcome_agreement = 'pending')::int as pending,
           count(*) filter (where s.outcome_agreement = 'none')::int as none
      from (${base}) s`)) as unknown as {
    summaries: number;
    agreed: number;
    disagreed: number;
    pending: number;
    none: number;
  }[];
  const [shown] = (await ctx.tx.execute(sql`
    select count(*)::int as n from copilot_notes n
     where n.entity_id = ${input.entityId} and n.kind = 'call_summary' and n.suggestions_shown
       and n.created_at >= ${from}::timestamptz and n.created_at < ${until}::timestamptz`)) as unknown as {
    n: number;
  }[];
  const recorded = sql.raw(
    `case f.key ${COPILOT_FACTS.map((fact) => `when '${fact}' then s.${RECORDED[fact]}::numeric`).join(' ')} end`,
  );
  const [facts] = (await ctx.tx.execute(sql`
    select count(*) filter (where r.recorded is not null and r.recorded = r.heard)::int as agreed,
           count(*) filter (where r.recorded is not null and r.recorded <> r.heard)::int as disagreed,
           count(*) filter (where r.recorded is null)::int as pending
      from (${base}) s
      cross join lateral jsonb_each_text(s.fields) f
      cross join lateral (select f.value::numeric as heard, ${recorded} as recorded) r`)) as unknown as {
    agreed: number;
    disagreed: number;
    pending: number;
  }[];

  const refusals = await agentRefusals(ctx, 'agent:copilot', input.entityId, from, until);
  const proposals = await proposalFigures(
    ctx,
    'agent:copilot',
    input.entityId,
    from,
    until,
    refusals,
  );
  const spend = await spendPerLead(ctx, 'agent:copilot', input.entityId, from, until);

  const more = page.length > input.limit;
  const rows = page.slice(0, input.limit);
  const last = rows.at(-1);
  return CopilotReportDto.parse({
    entityId: input.entityId,
    from: input.from,
    to: input.to,
    summaries: outcomes?.summaries ?? 0,
    shown: shown?.n ?? 0,
    outcomes: {
      agreed: outcomes?.agreed ?? 0,
      disagreed: outcomes?.disagreed ?? 0,
      pending: outcomes?.pending ?? 0,
      none: outcomes?.none ?? 0,
    },
    facts: {
      agreed: facts?.agreed ?? 0,
      disagreed: facts?.disagreed ?? 0,
      pending: facts?.pending ?? 0,
    },
    filtered: refusalsByReason(refusals),
    proposals,
    spend,
    items: rows.map((r) => ({
      noteId: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      opportunityId: r.opportunity_id,
      accountId: r.account_id,
      customerName: r.customer_name,
      suggestedOutcome: r.suggested_label,
      loggedOutcome: r.logged_label,
      outcomeAgreement: r.outcome_agreement,
      facts: factLines(r),
    })),
    nextCursor: more && last !== undefined ? encodeCursor({ t: last.t, id: last.id }) : null,
  });
}
