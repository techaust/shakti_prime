import {
  CONCIERGE_ACTION_TYPES,
  ConciergeDraftDto,
  ConciergeDraftInput,
  ConciergeReportDto,
  DomainError,
  hasGrant,
  IdSchema,
  ShadowReportInput,
  type ConciergeDraftState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isAgent } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { inboxScope } from './inbox';
import { checkShadowReader, istEndAfter, istStart } from './shadow-report';
import {
  agentRefusals,
  comparesWithTeam,
  conciergeHandoffs,
  proposalFigures,
  refusalsByReason,
  replyLaterals,
  spendPerLead,
} from './shadow-pack';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

// The WhatsApp Concierge's screens (docs/03-roadmap-appendix/phase2.md §7.2, A3): the draft line of
// one chat and the shadow report on Admin › Agents. Both read under the viewer's own policies: a
// draft through the viewer's Agent Inbox scope, the report's drafts with the agent controls
// (`agent_actions_read`), the chats and customers as the viewer reads them.

const REPLY = CONCIERGE_ACTION_TYPES.reply;

/**
 * The assistant's newest undecided reply on one chat the viewer reads, in the viewer's own Agent
 * Inbox scope (their own item, their team's or the company's, as `agents.inbox.act` reaches): the
 * item to decide, the words, and whether it is decided from the chat (Needs approval) or only in
 * the Agent Inbox (Suggest). None for a person who acts on no inbox, or when there is none (in
 * Shadow there never is). A person's screen: an agent never reads it.
 */
export async function loadConciergeDraft(ctx: Ctx, rawInput: unknown): Promise<ConciergeDraftDto> {
  const input = parseQueryInput(ConciergeDraftInput, rawInput, 'agents.concierge.draft');
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the draft line is for people, not agents');
  }
  if (!ctx.entityIds.includes(input.entityId)) {
    throw new DomainError('forbidden', 'the company is not in this request');
  }
  if (!hasGrant(ctx.principal.permissions, 'agents.inbox.act', 'own')) return { draft: null };
  const t = schema.whatsappThreads;
  const [thread] = await ctx.tx
    .select({ accountId: t.accountId })
    .from(t)
    .where(and(eq(t.id, input.threadId), eq(t.entityId, input.entityId)))
    .limit(1);
  if (thread === undefined || thread.accountId === null) return { draft: null };
  const i = schema.inboxItems;
  const a = schema.agentActions;
  const [row] = await ctx.tx
    .select({
      itemId: i.id,
      body: sql<string>`${a.inputJson} ->> 'body'`,
      createdAt: a.createdAt,
      autonomy: a.autonomy,
    })
    .from(i)
    .innerJoin(a, and(eq(a.id, i.agentActionId), eq(a.entityId, i.entityId)))
    .where(
      and(
        eq(i.subjectId, thread.accountId),
        eq(i.subjectType, 'account'),
        eq(i.entityId, input.entityId),
        eq(i.kind, 'agent_suggestion'),
        eq(i.state, 'open'),
        eq(a.agent, 'agent:concierge'),
        eq(a.actionType, REPLY),
        eq(a.state, 'proposed'),
        sql`${a.inputJson} ->> 'threadId' = ${input.threadId}`,
        inboxScope(ctx),
      ),
    )
    .orderBy(desc(a.createdAt), desc(a.id))
    .limit(1);
  return ConciergeDraftDto.parse({
    draft:
      row === undefined
        ? null
        : {
            itemId: row.itemId,
            body: row.body,
            createdAt: row.createdAt.toISOString(),
            // A suggestion is only dismissed (agents.inbox.dismiss), never sent from the chat.
            decidable: row.autonomy !== 'suggest',
          },
  });
}

const Cursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * The Concierge's drafts of one company in a period, newest first, each with the customer's
 * message it answered (the newest one before it), what became of it, and the first message a
 * person sent on the chat after it and before the customer wrote again. Keyset on
 * `(created_at, id)` over `agent_actions_type_created_idx`; each message is read by the chat's
 * `(thread_id, created_at)` index.
 */
export function conciergeDraftsSql(
  entityId: number,
  from: string,
  until: string,
  page?: { after: { t: string; id: string } | undefined; limit: number },
) {
  const keyset =
    page?.after === undefined
      ? sql``
      : sql`and (a.created_at, a.id) < (${page.after.t}::timestamptz, ${page.after.id}::uuid)`;
  const paged =
    page === undefined ? sql`` : sql`order by a.created_at desc, a.id desc limit ${page.limit}`;
  return sql`
    select a.created_at::text as t, a.id, a.created_at, a.state, a.edited,
           a.account_id, acc.name as customer_name,
           a.input_json ->> 'body' as draft,
           asked.body_masked as asked, asked.kind as asked_kind,
           sent.body_masked as sent_body, sent.template_label as sent_template,
           sent.created_at as sent_at, sent.drafted_by_agent_action_id = a.id as from_draft
      from (
        select a.*, (a.input_json ->> 'accountId')::uuid as account_id,
               (a.input_json ->> 'threadId')::uuid as thread_id
          from agent_actions a
         where a.entity_id = ${entityId} and a.agent = 'agent:concierge'
           and a.action_type = ${REPLY}
           and a.created_at >= ${from}::timestamptz and a.created_at < ${until}::timestamptz
           ${keyset}
         ${paged}) a
      left join accounts acc on acc.id = a.account_id
      ${replyLaterals(sql`a.thread_id`)}`;
}

interface DraftRow {
  t: string;
  id: string;
  created_at: Date | string;
  state: string;
  edited: boolean;
  account_id: string;
  customer_name: string | null;
  draft: string | null;
  asked: string | null;
  asked_kind: string | null;
  sent_body: string | null;
  sent_template: string | null;
  sent_at: Date | string | null;
  from_draft: boolean | null;
}

/** What became of a draft, from its action's state. */
function stateOf(row: Pick<DraftRow, 'state' | 'edited'>): ConciergeDraftState {
  switch (row.state) {
    case 'shadowed':
      return 'shadowed';
    case 'proposed':
      return 'waiting';
    case 'approved':
    case 'executed':
      return row.edited ? 'edited' : 'sent';
    default:
      return 'discarded';
  }
}

/**
 * The Concierge's shadow report (PRD AI-04, design §7.2): for one company and a period of IST days,
 * every draft beside the customer's message and what a person sent, how the drafts ended and how
 * many a person answered after, the runs the output filter refused by reason, and the proposals by
 * action type and how they ended.
 */
export async function loadConciergeReport(
  ctx: Ctx,
  rawInput: unknown,
): Promise<ConciergeReportDto> {
  const input = parseQueryInput(ShadowReportInput, rawInput, 'agents.concierge.report');
  checkShadowReader(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(Cursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const from = istStart(input.from);
  const until = istEndAfter(input.to);
  const page = (await ctx.tx.execute(sql`
    select * from (${conciergeDraftsSql(input.entityId, from, until, {
      after,
      limit: input.limit + 1,
    })}) s order by s.created_at desc, s.id desc`)) as unknown as DraftRow[];

  const [drafts] = (await ctx.tx.execute(sql`
    select count(*)::int as total,
           count(*) filter (where s.state = 'shadowed')::int as shadowed,
           count(*) filter (where s.state = 'proposed')::int as waiting,
           count(*) filter (where s.state in ('approved', 'executed') and not s.edited)::int as sent,
           count(*) filter (where s.state in ('approved', 'executed') and s.edited)::int as edited,
           count(*) filter (where s.state in ('rejected', 'dismissed'))::int as discarded,
           count(*) filter (where s.sent_at is not null)::int as answered
      from (${conciergeDraftsSql(input.entityId, from, until)}) s`)) as unknown as {
    total: number;
    shadowed: number;
    waiting: number;
    sent: number;
    edited: number;
    discarded: number;
    answered: number;
  }[];

  const refusals = await agentRefusals(ctx, 'agent:concierge', input.entityId, from, until);
  const proposals = await proposalFigures(
    ctx,
    'agent:concierge',
    input.entityId,
    from,
    until,
    refusals,
  );
  const spend = await spendPerLead(ctx, 'agent:concierge', input.entityId, from, until);
  const handoffs = await conciergeHandoffs(ctx, input.entityId, from, until);

  const more = page.length > input.limit;
  const rows = page.slice(0, input.limit);
  const last = rows.at(-1);
  const iso = (v: Date | string) => new Date(v).toISOString();
  return ConciergeReportDto.parse({
    entityId: input.entityId,
    from: input.from,
    to: input.to,
    drafts: {
      total: drafts?.total ?? 0,
      shadowed: drafts?.shadowed ?? 0,
      waiting: drafts?.waiting ?? 0,
      sent: drafts?.sent ?? 0,
      edited: drafts?.edited ?? 0,
      discarded: drafts?.discarded ?? 0,
      answered: drafts?.answered ?? 0,
    },
    filtered: refusalsByReason(refusals),
    proposals,
    compared: comparesWithTeam(ctx),
    handoffs,
    spend,
    items: rows.map((r) => ({
      actionId: r.id,
      createdAt: iso(r.created_at),
      accountId: r.account_id,
      customerName: r.customer_name,
      asked: r.asked_kind === 'text' ? r.asked : null,
      draft: r.draft ?? '',
      state: stateOf(r),
      sent:
        r.sent_at === null
          ? null
          : {
              body: r.sent_body,
              templateLabel: r.sent_body === null ? r.sent_template : null,
              at: iso(r.sent_at),
              fromDraft: r.from_draft === true,
            },
    })),
    nextCursor: more && last !== undefined ? encodeCursor({ t: last.t, id: last.id }) : null,
  });
}
