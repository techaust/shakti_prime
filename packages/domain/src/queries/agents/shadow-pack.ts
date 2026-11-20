import {
  AgentFilterReasonSchema,
  CONCIERGE_ACTION_TYPES,
  COPILOT_ACTION_TYPES,
  COPILOT_FACTS,
  hasGrant,
  SampleFactsSchema,
  SHADOW_SAMPLE_SIZE,
  ShadowSampleDto,
  ShadowSampleInput,
  WhatsAppHandoffReasonSchema,
  type AgentProposalFiguresDto,
  type AgentRefusalCountDto,
  type AgentSpendPerLeadDto,
  type ConciergeHandoffCountDto,
  type CopilotFact,
  type SampleFacts,
  type ShadowSampleAgreement,
  type ShadowSampleDidDto,
  type ShadowSampleDraftDto,
  type ShadowSampleItemDto,
  type ShadowSampleState,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { moneyFromPaise } from '../../money/paise';
import { parseQueryInput } from '../parse-input';
import { checkShadowReader, istEndAfter, istStart } from './shadow-report';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

// The G2 shadow review pack (docs/03-roadmap-appendix/phase2.md §8.1): per action type, how the
// WhatsApp Concierge's and the Caller Co-pilot's proposals compare with what people did, the output
// filter's refusals, the Concierge's hand-offs, each agent's AI spend per lead, and the review
// sample of at most 50 proposals beside what people sent or did. Everything reads under the
// viewer's own policies, one company at a time: the proposals and runs with the agent controls
// (`agent_actions_read`, `agent_runs_read`), the leads, chats, tasks and facts as the viewer reads
// them, the hand-offs from the audit trail only for a viewer who reads it. No cost or supplier
// figure: spend is the agents' own AI spend (`agent_runs.cost_paise`).

/**
 * A draft's two messages on its chat (`thread`, an expression over the draft's row `a`): the
 * customer's message it answered (`asked`: the newest inbound one at or before it), and the first
 * message a person sent after it and before the customer wrote again (`sent`). Each is read by
 * the chat's `(thread_id, created_at)` index; a null chat reads none.
 */
export function replyLaterals(thread: SQL) {
  return sql`
      left join lateral (
        select m.body_masked, m.kind from whatsapp_messages m
         where m.thread_id = ${thread} and m.entity_id = a.entity_id
           and m.direction = 'inbound' and m.created_at <= a.created_at
         order by m.created_at desc, m.id desc limit 1) asked on true
      left join lateral (
        select m.body_masked, w.label as template_label, m.created_at,
               m.drafted_by_agent_action_id
          from whatsapp_messages m
          join principals p on p.id = m.sent_by and p.kind = 'user'
          left join whatsapp_templates w
            on w.entity_id = m.entity_id and w.name = m.template_name and w.language = 'en'
         where m.thread_id = ${thread} and m.entity_id = a.entity_id
           and m.direction = 'outbound' and m.kind in ('text', 'template')
           and m.created_at >= a.created_at
           and not exists (select 1 from whatsapp_messages n
                            where n.thread_id = m.thread_id and n.entity_id = m.entity_id
                              and n.direction = 'inbound'
                              and n.created_at > a.created_at and n.created_at < m.created_at)
         order by m.created_at, m.id limit 1) sent on true`;
}

/** The agents with a review pack. */
export type PackAgent = 'agent:concierge' | 'agent:copilot';

const REPLY = CONCIERGE_ACTION_TYPES.reply;
const QUALIFICATION = COPILOT_ACTION_TYPES.qualification;
const TASK = COPILOT_ACTION_TYPES.followUp;
const TEMPLATE = COPILOT_ACTION_TYPES.template;

/** Each agent's action types, in the order the reports show them. */
export const PACK_ACTION_TYPES: Readonly<Record<PackAgent, readonly string[]>> = {
  'agent:concierge': Object.values(CONCIERGE_ACTION_TYPES),
  'agent:copilot': Object.values(COPILOT_ACTION_TYPES),
};

/** The lead's recorded value of each fact, by its column of `lead_qualifications`. */
type FactColumn =
  | 'pump_depth_ft'
  | 'required_hp'
  | 'monthly_bill_rupees'
  | 'roof_area_sq_ft'
  | 'sanctioned_load_kw';
const FACT_COLUMNS: Readonly<Record<CopilotFact, FactColumn>> = {
  pumpDepthFt: 'pump_depth_ft',
  requiredHp: 'required_hp',
  monthlyBillRupees: 'monthly_bill_rupees',
  roofAreaSqFt: 'roof_area_sq_ft',
  sanctionedLoadKw: 'sanctioned_load_kw',
};
const recordedFact = sql.raw(
  `case f.key ${COPILOT_FACTS.map((fact) => `when '${fact}' then lq.${FACT_COLUMNS[fact]}::numeric`).join(' ')} end`,
);
const factKeys = sql.raw(COPILOT_FACTS.map((fact) => `'${fact}'`).join(', '));

/**
 * One agent's proposals of a company in a period (`[from, until)`), each with its lead and how what
 * people did compares with it (`agreement`):
 * - a person's decision first: approved as proposed agrees, approved after an edit is `edited`,
 *   rejected or dismissed disagrees, waiting is open;
 * - in Shadow, by action type: qualification facts agree when every fact the lead records of
 *   those proposed is the one proposed (one that differs disagrees; none recorded is open); a task
 *   or a template agrees when a person made a task on the lead, or sent the template on the lead's
 *   chat, at or after the proposal, and disagrees when the lead was won or lost without it; a
 *   reply stays open, since only a reader can set two texts side by side (the review sample).
 *
 * With `sample`, only the sample's rows: the period's proposals in time order cut into 50 runs of
 * equal length (`ntile`), the first of each, so the same period gives the same pairs; the customer's
 * message and what a person sent come with each reply. The agent's rows come off
 * `agent_actions_type_created_idx`; each lookup after is by key or by its own index.
 */
export function shadowActionsSql(
  agent: PackAgent,
  entityId: number,
  from: string,
  until: string,
  options: { sample?: boolean } = {},
) {
  const period = sql`a.entity_id = ${entityId} and a.agent = ${agent}
           and a.created_at >= ${from}::timestamptz and a.created_at < ${until}::timestamptz`;
  const actions = options.sample
    ? sql`(
        select a.* from (
          select a.*, row_number() over (partition by a.bucket order by a.created_at, a.id) as nth
            from (
              select a.*, ntile(${SHADOW_SAMPLE_SIZE}::int) over (order by a.created_at, a.id) as bucket
                from agent_actions a
               where ${period}) a) a
         where a.nth = 1)`
    : sql`(select a.* from agent_actions a where ${period})`;
  const texts = options.sample
    ? sql`, asked.body_masked as asked, asked.kind as asked_kind,
           sent.body_masked as sent_body, sent.template_label as sent_template,
           sent.created_at as sent_at, sent.drafted_by_agent_action_id = a.id as from_draft,
           pt.label as proposed_template_label`
    : sql``;
  const textJoins = options.sample
    ? sql`${replyLaterals(sql`th.id`)}
      left join whatsapp_templates pt
        on a.action_type = ${TEMPLATE} and pt.entity_id = a.entity_id
       and pt.name = a.input_json ->> 'templateName' and pt.language = 'en'`
    : sql``;
  return sql`
    select a.id, a.action_type, a.created_at, a.state, a.edited, a.input_json as input,
           l.opportunity_id, o.account_id, acc.name as customer_name,
           lq.pump_depth_ft, lq.required_hp, lq.monthly_bill_rupees, lq.roof_area_sq_ft,
           lq.sanctioned_load_kw,
           task.kind as task_kind, task.due_at as task_due_at, task.title as task_title,
           task.created_at as task_at,
           tpl.created_at as template_at, tpl.label as template_label
           ${texts},
           case
             when a.state in ('approved', 'executed') then
               case when a.edited then 'edited' else 'agree' end
             when a.state in ('rejected', 'dismissed') then 'disagree'
             when a.state <> 'shadowed' then 'open'
             when a.action_type = ${QUALIFICATION} then
               case when fc.differ > 0 then 'disagree' when fc.same > 0 then 'agree' else 'open' end
             when a.action_type in (${TASK}, ${TEMPLATE}) then
               case
                 when coalesce(task.created_at, tpl.created_at) is not null then 'agree'
                 when o.state in ('won', 'lost') then 'disagree'
                 else 'open'
               end
             else 'open'
           end as agreement
      from ${actions} a
      left join whatsapp_threads th
        on a.action_type = ${REPLY} and th.id = (a.input_json ->> 'threadId')::uuid
       and th.entity_id = a.entity_id
      cross join lateral (
        select coalesce((a.input_json ->> 'opportunityId')::uuid, th.opportunity_id)
                 as opportunity_id) l
      left join opportunities o on o.id = l.opportunity_id and o.entity_id = a.entity_id
      left join accounts acc on acc.id = o.account_id
      left join lead_qualifications lq
        on a.action_type = ${QUALIFICATION} and lq.opportunity_id = l.opportunity_id
       and lq.entity_id = a.entity_id
      left join lateral (
        select count(*) filter (where r.recorded is not null and r.recorded = r.heard)::int as same,
               count(*) filter (where r.recorded is not null and r.recorded <> r.heard)::int as differ
          from jsonb_each_text(case when jsonb_typeof(a.input_json -> 'facts') = 'object'
                                    then a.input_json -> 'facts' else '{}'::jsonb end) f
          cross join lateral (
            select case when f.value ~ '^-?[0-9]+(\\.[0-9]+)?$' then f.value::numeric end as heard,
                   ${recordedFact} as recorded) r
         where f.key in (${factKeys})) fc on a.action_type = ${QUALIFICATION}
      left join lateral (
        select t.kind, t.due_at, t.title, t.created_at from tasks t
          join principals p on p.id = t.created_by and p.kind = 'user'
         where a.action_type = ${TASK} and t.opportunity_id = l.opportunity_id
           and t.entity_id = a.entity_id and t.created_at >= a.created_at
         order by t.created_at, t.id limit 1) task on true
      left join lateral (
        select m.created_at, w.label from whatsapp_threads t2
          join whatsapp_messages m on m.thread_id = t2.id and m.entity_id = t2.entity_id
          join principals p on p.id = m.sent_by and p.kind = 'user'
          left join whatsapp_templates w
            on w.entity_id = m.entity_id and w.name = m.template_name and w.language = 'en'
         where a.action_type = ${TEMPLATE} and t2.opportunity_id = l.opportunity_id
           and t2.entity_id = a.entity_id and m.direction = 'outbound' and m.kind = 'template'
           and m.template_name = a.input_json ->> 'templateName' and m.created_at >= a.created_at
         order by m.created_at, m.id limit 1) tpl on true
      ${textJoins}`;
}

interface FigureRow {
  action_type: string;
  proposals: number;
  shadowed: number;
  waiting: number;
  approved: number;
  rejected: number;
  decided: number;
  agreed: number;
  edited: number;
  disagreed: number;
  open: number;
}

/** The output filter's refusals of one agent in the period, by action type and reason. */
export async function agentRefusals(
  ctx: Pick<Ctx, 'tx'>,
  agent: PackAgent,
  entityId: number,
  from: string,
  until: string,
): Promise<(AgentRefusalCountDto & { actionType: string })[]> {
  const rows = (await ctx.tx.execute(sql`
    select r.action_type, r.filter_reason, count(*)::int as n from agent_runs r
     where r.agent = ${agent} and r.entity_id = ${entityId} and r.outcome = 'filtered'
       and r.created_at >= ${from}::timestamptz and r.created_at < ${until}::timestamptz
     group by r.action_type, r.filter_reason
     order by r.action_type, r.filter_reason`)) as unknown as {
    action_type: string;
    filter_reason: string;
    n: number;
  }[];
  return rows.flatMap((r) => {
    const reason = AgentFilterReasonSchema.safeParse(r.filter_reason);
    return reason.success ? [{ actionType: r.action_type, reason: reason.data, runs: r.n }] : [];
  });
}

/** The refusals summed by reason over every action type, as the reports' summary shows them. */
export function refusalsByReason(
  refusals: readonly (AgentRefusalCountDto & { actionType: string })[],
): AgentRefusalCountDto[] {
  const by = new Map<AgentRefusalCountDto['reason'], number>();
  for (const r of refusals) by.set(r.reason, (by.get(r.reason) ?? 0) + r.runs);
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, runs]) => ({ reason, runs }));
}

/**
 * The agent's proposals per action type in the period: how they ended and how what people did
 * compares with them, with the output filter's refusals of that type.
 */
export async function proposalFigures(
  ctx: Pick<Ctx, 'tx'>,
  agent: PackAgent,
  entityId: number,
  from: string,
  until: string,
  refusals: readonly (AgentRefusalCountDto & { actionType: string })[],
): Promise<AgentProposalFiguresDto[]> {
  const rows = (await ctx.tx.execute(sql`
    select s.action_type, count(*)::int as proposals,
           count(*) filter (where s.state = 'shadowed')::int as shadowed,
           count(*) filter (where s.state = 'proposed')::int as waiting,
           count(*) filter (where s.state in ('approved', 'executed'))::int as approved,
           count(*) filter (where s.state in ('rejected', 'dismissed'))::int as rejected,
           count(*) filter (where s.state in ('approved', 'rejected', 'dismissed'))::int as decided,
           count(*) filter (where s.agreement = 'agree')::int as agreed,
           count(*) filter (where s.agreement = 'edited')::int as edited,
           count(*) filter (where s.agreement = 'disagree')::int as disagreed,
           count(*) filter (where s.agreement = 'open')::int as open
      from (${shadowActionsSql(agent, entityId, from, until)}) s
     group by s.action_type`)) as unknown as FigureRow[];
  return PACK_ACTION_TYPES[agent].map((actionType) => {
    const r = rows.find((x) => x.action_type === actionType);
    return {
      actionType,
      proposals: r?.proposals ?? 0,
      shadowed: r?.shadowed ?? 0,
      waiting: r?.waiting ?? 0,
      approved: r?.approved ?? 0,
      rejected: r?.rejected ?? 0,
      decided: r?.decided ?? 0,
      agreed: r?.agreed ?? 0,
      edited: r?.edited ?? 0,
      disagreed: r?.disagreed ?? 0,
      open: r?.open ?? 0,
      filtered: refusals
        .filter((f) => f.actionType === actionType)
        .map(({ reason, runs }) => ({ reason, runs })),
    };
  });
}

/** `paise / leads` rounded half up to whole paise. */
function perLeadPaise(paise: bigint, leads: number): bigint {
  const n = BigInt(leads);
  return (paise * 2n + n) / (2n * n);
}

/**
 * The agent's AI spend in the period (every run's cost, a refused or stopped one too) over the
 * distinct leads it worked on: the leads its proposals name (a reply's through its chat's lead)
 * and, for the Co-pilot, the leads of its briefs and call summaries. Runs off
 * `agent_runs_agent_day_idx`.
 */
export async function spendPerLead(
  ctx: Pick<Ctx, 'tx'>,
  agent: PackAgent,
  entityId: number,
  from: string,
  until: string,
): Promise<AgentSpendPerLeadDto> {
  const [spend] = (await ctx.tx.execute(sql`
    select coalesce(sum(r.cost_paise), 0)::text as paise, count(*)::int as runs from agent_runs r
     where r.agent = ${agent} and r.entity_id = ${entityId}
       and r.created_at >= ${from}::timestamptz and r.created_at < ${until}::timestamptz`)) as unknown as {
    paise: string;
    runs: number;
  }[];
  const notes =
    agent === 'agent:copilot'
      ? sql`union all
        select n.opportunity_id from copilot_notes n
         where n.entity_id = ${entityId}
           and n.created_at >= ${from}::timestamptz and n.created_at < ${until}::timestamptz`
      : sql``;
  const [leads] = (await ctx.tx.execute(sql`
    select count(distinct l.id)::int as n from (
      select coalesce((a.input_json ->> 'opportunityId')::uuid, th.opportunity_id) as id
        from agent_actions a
        left join whatsapp_threads th
          on a.action_type = ${REPLY} and th.id = (a.input_json ->> 'threadId')::uuid
         and th.entity_id = a.entity_id
       where a.entity_id = ${entityId} and a.agent = ${agent}
         and a.created_at >= ${from}::timestamptz and a.created_at < ${until}::timestamptz
      ${notes}) l
     where l.id is not null`)) as unknown as { n: number }[];
  const paise = BigInt(spend?.paise ?? '0');
  const n = leads?.n ?? 0;
  return {
    total: moneyFromPaise(paise),
    runs: spend?.runs ?? 0,
    leads: n,
    perLead: n === 0 ? null : moneyFromPaise(perLeadPaise(paise, n)),
  };
}

/** The audit trail's commands that hand a Concierge chat to people. */
const HANDOFF_COMMANDS = ['messaging.thread.record_hand_off', 'messaging.thread.hand_off'] as const;

/**
 * The Concierge's chats handed to people in the period, by reason and by whom: the platform's
 * hand-off (the assistant's rules and answers, `messaging.thread.record_hand_off`) or a person who
 * took a chat from the assistant (`messaging.thread.hand_off`). From the audit trail, since a chat
 * given back to the assistant keeps no reason; only a hand-off that moved the chat counts. Null
 * for a viewer who does not read the company's audit trail (`audit.read`), whose policy would
 * show none. Runs off `audit_logs_hand_off_idx`.
 */
export async function conciergeHandoffs(
  ctx: Ctx,
  entityId: number,
  from: string,
  until: string,
): Promise<ConciergeHandoffCountDto[] | null> {
  if (!hasGrant(ctx.principal.permissions, 'audit.read', 'entity')) return null;
  const commands = `{${HANDOFF_COMMANDS.join(',')}}`;
  const rows = (await ctx.tx.execute(sql`
    select l.after_json ->> 'handoffReason' as reason, l.actor_kind = 'user' as by_person,
           count(*)::int as n
      from audit_logs l
     where l.entity_id = ${entityId} and l.command = any(${commands}::text[]) and l.outcome = 'ok'
       and l.created_at >= ${from}::timestamptz and l.created_at < ${until}::timestamptz
       and l.before_json ->> 'handledBy' = 'assistant' and l.after_json ->> 'handledBy' = 'people'
     group by 1, 2
     order by 2, 1`)) as unknown as { reason: string | null; by_person: boolean; n: number }[];
  return rows.flatMap((r) => {
    const reason = WhatsAppHandoffReasonSchema.safeParse(r.reason);
    return reason.success
      ? [{ reason: reason.data, by: r.by_person ? 'person' : 'assistant', count: r.n } as const]
      : [];
  });
}

interface SampleRow {
  id: string;
  action_type: string;
  created_at: Date | string;
  state: string;
  edited: boolean;
  input: Record<string, unknown>;
  opportunity_id: string | null;
  account_id: string | null;
  customer_name: string | null;
  pump_depth_ft: number | string | null;
  required_hp: number | string | null;
  monthly_bill_rupees: number | string | null;
  roof_area_sq_ft: number | string | null;
  sanctioned_load_kw: number | string | null;
  task_kind: string | null;
  task_due_at: Date | string | null;
  task_title: string | null;
  task_at: Date | string | null;
  template_at: Date | string | null;
  template_label: string | null;
  asked: string | null;
  asked_kind: string | null;
  sent_body: string | null;
  sent_template: string | null;
  sent_at: Date | string | null;
  from_draft: boolean | null;
  proposed_template_label: string | null;
  agreement: ShadowSampleAgreement;
}

const iso = (v: Date | string): string => new Date(v).toISOString();
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** The numeric facts of a proposal, without a consumer number. */
function proposedFacts(input: Record<string, unknown>): SampleFacts | null {
  const facts = input.facts;
  if (facts === null || typeof facts !== 'object') return null;
  const numbers = Object.fromEntries(
    Object.entries(facts).filter(([key]) => (COPILOT_FACTS as readonly string[]).includes(key)),
  );
  const parsed = SampleFactsSchema.safeParse(numbers);
  return parsed.success ? parsed.data : null;
}

/** The facts the lead records of those proposed. */
function recordedFacts(row: SampleRow, proposed: SampleFacts): SampleFacts | null {
  const out: SampleFacts = {};
  for (const fact of COPILOT_FACTS) {
    if (proposed[fact] === undefined) continue;
    const raw = row[FACT_COLUMNS[fact]];
    if (raw !== null) out[fact] = Number(raw);
  }
  return Object.keys(out).length === 0 ? null : out;
}

function stateOf(row: Pick<SampleRow, 'state' | 'edited'>): ShadowSampleState {
  switch (row.state) {
    case 'shadowed':
      return 'shadowed';
    case 'proposed':
      return 'waiting';
    case 'approved':
    case 'executed':
      return row.edited ? 'edited' : 'approved';
    default:
      return 'rejected';
  }
}

/** One sampled proposal as the page shows it; none for an action type the pack does not know. */
function sampleItem(row: SampleRow): ShadowSampleItemDto | null {
  const input = row.input;
  let draft: ShadowSampleDraftDto;
  let did: ShadowSampleDidDto | null = null;
  switch (row.action_type) {
    case REPLY: {
      draft = { kind: 'reply', text: text(input.body) ?? '' };
      if (row.sent_at !== null) {
        did = {
          kind: 'message',
          body: row.sent_body,
          templateLabel: row.sent_body === null ? row.sent_template : null,
          at: iso(row.sent_at),
          fromDraft: row.from_draft === true,
        };
      }
      break;
    }
    case QUALIFICATION: {
      const facts = proposedFacts(input);
      if (facts === null) return null;
      draft = { kind: 'facts', facts };
      const recorded = recordedFacts(row, facts);
      if (recorded !== null) did = { kind: 'facts', facts: recorded };
      break;
    }
    case TASK: {
      draft = {
        kind: 'task',
        taskKind: text(input.kind) ?? 'follow_up',
        dueAt: isoOrNull(input.dueAt),
        title: text(input.title),
      };
      if (row.task_at !== null && row.task_due_at !== null) {
        did = {
          kind: 'task',
          taskKind: row.task_kind ?? 'follow_up',
          dueAt: iso(row.task_due_at),
          title: row.task_title,
          at: iso(row.task_at),
        };
      }
      break;
    }
    case TEMPLATE: {
      draft = {
        kind: 'template',
        templateName: text(input.templateName) ?? '',
        templateLabel: row.proposed_template_label,
        occasion: text(input.occasion),
      };
      if (row.template_at !== null) {
        did = { kind: 'template', templateLabel: row.template_label, at: iso(row.template_at) };
      }
      break;
    }
    default:
      return null;
  }
  return {
    actionId: row.id,
    actionType: row.action_type,
    createdAt: iso(row.created_at),
    opportunityId: row.opportunity_id,
    accountId: row.account_id,
    customerName: row.customer_name,
    asked: row.action_type === REPLY && row.asked_kind === 'text' ? row.asked : null,
    draft,
    did,
    state: stateOf(row),
    agreement: row.agreement,
  };
}

/**
 * The review sample of one agent (design §8.1): at most 50 of its proposals of a company in a
 * period of IST days, spread evenly over the period in time order, oldest first, each beside what
 * people sent or did, with the period's proposals and the output filter's refusals by action type
 * and reason. Read-only: the Executive reviews it offline and nothing is recorded.
 */
export async function loadShadowSample(
  ctx: Ctx,
  agent: PackAgent,
  rawInput: unknown,
): Promise<ShadowSampleDto> {
  const name = agent === 'agent:concierge' ? 'agents.concierge.sample' : 'agents.copilot.sample';
  const input = parseQueryInput(ShadowSampleInput, rawInput, name);
  checkShadowReader(ctx, input.entityId);
  const from = istStart(input.from);
  const until = istEndAfter(input.to);
  const rows = (await ctx.tx.execute(sql`
    select * from (${shadowActionsSql(agent, input.entityId, from, until, { sample: true })}) s
     order by s.created_at, s.id`)) as unknown as SampleRow[];
  const [total] = (await ctx.tx.execute(sql`
    select count(*)::int as n from agent_actions a
     where a.entity_id = ${input.entityId} and a.agent = ${agent}
       and a.created_at >= ${from}::timestamptz and a.created_at < ${until}::timestamptz`)) as unknown as {
    n: number;
  }[];
  return ShadowSampleDto.parse({
    entityId: input.entityId,
    from: input.from,
    to: input.to,
    proposals: total?.n ?? 0,
    items: rows.flatMap((r) => {
      const item = sampleItem(r);
      return item === null ? [] : [item];
    }),
    filtered: await agentRefusals(ctx, agent, input.entityId, from, until),
  });
}

/** `agents.concierge.sample`: the WhatsApp Concierge's review sample. */
export function loadConciergeSample(ctx: Ctx, rawInput: unknown): Promise<ShadowSampleDto> {
  return loadShadowSample(ctx, 'agent:concierge', rawInput);
}

/** `agents.copilot.sample`: the Caller Co-pilot's review sample. */
export function loadCopilotSample(ctx: Ctx, rawInput: unknown): Promise<ShadowSampleDto> {
  return loadShadowSample(ctx, 'agent:copilot', rawInput);
}
