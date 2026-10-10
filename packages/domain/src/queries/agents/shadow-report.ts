import {
  AgentFilterReasonSchema,
  DomainError,
  hasGrant,
  IdSchema,
  ShadowReportDto,
  ShadowReportInput,
  TRIAGE_ACTION_TYPES,
  TRIAGE_PROPOSAL_KINDS,
  type ShadowAgreement,
  type ShadowKindSummaryDto,
  type ShadowProposalDto,
  type TriageProposalKind,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission, isAgent } from '../../command/run-command';
import { kindOfActionType } from '../../ai/triage/filter';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

// The shadow report (docs/03-roadmap-appendix/phase1.md §9, A1; PRD AI-04): for one company and a
// period of IST days, each proposal the Triage agent recorded in Shadow beside what people did
// with that lead, and how often the two agree, kind by kind, with the runs whose proposal the
// output filter refused. Read under the viewer's own policies: the shadowed actions with the agent
// controls (`agent_actions_read`), the lead, its customer's name and the people's names only as
// the viewer may read them.
//
// When people bear a proposal out:
// - pipeline: the lead is in the pipeline proposed;
// - score: a raise, when the lead was won or reached Qualified or a later stage; a cut, when it
//   was lost or went to nurture; either is pending while the lead is open before Qualified;
// - duplicate: the card of the two leads was merged (dismissed disagrees; open is pending);
// - assignee: the lead's owner is the person proposed (pending while it has none).

const Cursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Midnight IST starting `day`, and the midnight after `last`. */
export const istStart = (day: string): string => `${day}T00:00:00+05:30`;
export function istEndAfter(last: string): string {
  const next = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return istStart(next);
}

interface Row {
  t: string;
  id: string;
  action_type: string;
  created_at: Date | string;
  input: Record<string, unknown>;
  opportunity_id: string;
  account_id: string | null;
  customer_name: string | null;
  pipeline_key: string | null;
  score: number | null;
  lead_state: 'open' | 'nurture' | 'won' | 'lost' | null;
  reached_qualified: boolean | null;
  owner_id: string | null;
  owner_name: string | null;
  proposed_owner_name: string | null;
  duplicate_state: 'open' | 'merged' | 'dismissed' | null;
  agreement: ShadowAgreement;
}

/**
 * The shadowed actions of the period with the lead as it stands, and whether people bore each
 * out. One statement for the page and the summary alike, so the two never disagree.
 */
export function shadowedSql(
  entityId: number,
  from: string,
  until: string,
  page?: { after: { t: string; id: string } | undefined; limit: number },
) {
  // A page takes its rows off `agent_actions_shadow_idx` first, then reads their leads; the
  // summary reads the whole period.
  const keyset =
    page?.after === undefined
      ? sql``
      : sql`and (a.created_at, a.id) < (${page.after.t}::timestamptz, ${page.after.id}::uuid)`;
  const paged =
    page === undefined ? sql`` : sql`order by a.created_at desc, a.id desc limit ${page.limit}`;
  const assign = TRIAGE_ACTION_TYPES.assignee;
  const pipeline = TRIAGE_ACTION_TYPES.pipeline;
  const score = TRIAGE_ACTION_TYPES.score;
  const duplicate = TRIAGE_ACTION_TYPES.duplicate;
  return sql`
    select a.created_at::text as t, a.id, a.action_type, a.created_at, a.input_json as input,
           (a.input_json ->> 'opportunityId')::uuid as opportunity_id,
           o.account_id, acc.name as customer_name, p.key as pipeline_key, o.score,
           o.state as lead_state,
           case when o.id is null then null
                else o.state = 'won' or (o.state = 'open' and st.position >= q.position) end
             as reached_qualified,
           o.owner_id, owner.display_name as owner_name, proposed.display_name as proposed_owner_name,
           d.state as duplicate_state,
           case
             when o.id is null then 'pending'
             when a.action_type = ${pipeline} then
               case when p.key = a.input_json ->> 'pipelineKey' then 'agree' else 'disagree' end
             when a.action_type = ${score} then
               case
                 when o.state = 'won' or (o.state = 'open' and st.position >= q.position) then
                   case when (a.input_json ->> 'adjustment')::int > 0 then 'agree' else 'disagree' end
                 when o.state in ('lost', 'nurture') then
                   case when (a.input_json ->> 'adjustment')::int < 0 then 'agree' else 'disagree' end
                 else 'pending'
               end
             when a.action_type = ${duplicate} then
               case d.state when 'merged' then 'agree' when 'dismissed' then 'disagree' else 'pending' end
             when a.action_type = ${assign} then
               case
                 when o.owner_id is null then 'pending'
                 when o.owner_id = (a.input_json ->> 'ownerId')::uuid then 'agree'
                 else 'disagree'
               end
             else 'pending'
           end as agreement
      from (
        select a.* from agent_actions a
         where a.entity_id = ${entityId} and a.agent = 'agent:triage' and a.state = 'shadowed'
           and a.created_at >= ${from}::timestamptz and a.created_at < ${until}::timestamptz
           ${keyset}
         ${paged}) a
      left join opportunities o
        on o.id = (a.input_json ->> 'opportunityId')::uuid and o.entity_id = a.entity_id
      left join pipelines p on p.id = o.pipeline_id
      left join pipeline_stages st on st.id = o.stage_id
      left join lateral (
        select q.position from pipeline_stages q
         where q.pipeline_id = o.pipeline_id and q.key = 'qualified' limit 1) q on true
      left join accounts acc on acc.id = o.account_id
      left join principals owner on owner.id = o.owner_id
      left join principals proposed
        on a.action_type = ${assign} and proposed.id = (a.input_json ->> 'ownerId')::uuid
      left join duplicate_candidates d
        on a.action_type = ${duplicate} and d.entity_id = a.entity_id and d.kind = 'lead'
       and d.opportunity_id = least((a.input_json ->> 'opportunityId')::uuid,
                                    (a.input_json ->> 'otherOpportunityId')::uuid)
       and d.other_opportunity_id = greatest((a.input_json ->> 'opportunityId')::uuid,
                                             (a.input_json ->> 'otherOpportunityId')::uuid)`;
}

const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

function toDto(row: Row, kind: TriageProposalKind): ShadowProposalDto {
  const input = row.input;
  return {
    actionId: row.id,
    kind,
    createdAt: new Date(row.created_at).toISOString(),
    opportunityId: row.opportunity_id,
    accountId: row.account_id,
    customerName: row.customer_name,
    proposedPipelineKey: kind === 'pipeline' ? text(input.pipelineKey) : null,
    proposedScoreChange: kind === 'score' ? int(input.adjustment) : null,
    proposedScore: kind === 'score' ? int(input.score) : null,
    otherOpportunityId: kind === 'duplicate' ? text(input.otherOpportunityId) : null,
    proposedOwnerId: kind === 'assignee' ? text(input.ownerId) : null,
    proposedOwnerName: kind === 'assignee' ? row.proposed_owner_name : null,
    note: text(input.note),
    pipelineKey: row.pipeline_key,
    score: row.score,
    leadState: row.lead_state,
    reachedQualified: row.reached_qualified,
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    duplicateState: kind === 'duplicate' ? row.duplicate_state : null,
    agreement: row.agreement,
  };
}

/** The agents screen's readers: the agent controls, for every company (SECURITY §3.2). */
function checkReader(ctx: Ctx, entityId: number): void {
  if (isAgent(ctx.principal)) throw new DomainError('forbidden', 'the shadow report is for people');
  const perms = ctx.principal.permissions;
  if (
    !hasGrant(perms, 'agents.killswitch', 'all') &&
    !hasGrant(perms, 'agents.autonomy.write', 'all')
  ) {
    checkPermission(ctx.principal, 'agents.killswitch', 'all');
  }
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'the company is not in this request');
  }
}

export async function loadShadowReport(ctx: Ctx, rawInput: unknown): Promise<ShadowReportDto> {
  const input = parseQueryInput(ShadowReportInput, rawInput, 'agents.shadow.report');
  checkReader(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(Cursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const from = istStart(input.from);
  const until = istEndAfter(input.to);
  const base = shadowedSql(input.entityId, from, until);

  const page = (await ctx.tx.execute(sql`
    select * from (${shadowedSql(input.entityId, from, until, { after, limit: input.limit + 1 })}) s
     order by s.created_at desc, s.id desc`)) as unknown as Row[];

  const counts = (await ctx.tx.execute(sql`
    select s.action_type, s.agreement, count(*)::int as n from (${base}) s
     group by s.action_type, s.agreement`)) as unknown as {
    action_type: string;
    agreement: ShadowAgreement;
    n: number;
  }[];

  const filtered = (await ctx.tx.execute(sql`
    select r.action_type, r.filter_reason, count(*)::int as n from agent_runs r
     where r.entity_id = ${input.entityId} and r.agent = 'agent:triage' and r.outcome = 'filtered'
       and r.created_at >= ${from}::timestamptz and r.created_at < ${until}::timestamptz
     group by r.action_type, r.filter_reason
     order by r.action_type, r.filter_reason`)) as unknown as {
    action_type: string;
    filter_reason: string;
    n: number;
  }[];

  const summary: ShadowKindSummaryDto[] = TRIAGE_PROPOSAL_KINDS.map((kind) => {
    const of = (agreement: ShadowAgreement) =>
      counts.find((c) => c.action_type === TRIAGE_ACTION_TYPES[kind] && c.agreement === agreement)
        ?.n ?? 0;
    const agreed = of('agree');
    const disagreed = of('disagree');
    const pending = of('pending');
    return {
      kind,
      proposals: agreed + disagreed + pending,
      agreed,
      disagreed,
      pending,
      filtered: filtered.flatMap((f) => {
        const reason = AgentFilterReasonSchema.safeParse(f.filter_reason);
        return f.action_type === TRIAGE_ACTION_TYPES[kind] && reason.success
          ? [{ reason: reason.data, runs: f.n }]
          : [];
      }),
    };
  });

  const more = page.length > input.limit;
  const rows = page.slice(0, input.limit);
  const last = rows.at(-1);
  return ShadowReportDto.parse({
    entityId: input.entityId,
    from: input.from,
    to: input.to,
    summary,
    items: rows.flatMap((r) => {
      const kind = kindOfActionType(r.action_type);
      return kind === undefined ? [] : [toDto(r, kind)];
    }),
    nextCursor: more && last !== undefined ? encodeCursor({ t: last.t, id: last.id }) : null,
  });
}
