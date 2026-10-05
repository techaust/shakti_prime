import {
  CallLeadDto,
  CallQueueItemDto,
  CallQueuePageDto,
  CustomerLanguageSchema,
  DialNumberDto,
  DialNumberInput,
  DomainError,
  hasGrant,
  ListCallQueueInput,
  ListTeamQueuesInput,
  LoadCallLeadInput,
  OpportunityStateSchema,
  SegmentSchema,
  StageExitFieldSchema,
  TeamQueueDto,
  type CallLeadDto as CallLead,
  type CallQueuePageDto as CallQueuePage,
  type CallQueueReason,
  type DialNumberDto as DialNumber,
  type TeamQueueDto as TeamQueue,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission, isAgent } from '../../command/run-command';
import { opportunityRecord } from '../../commands/crm/opportunity-shared';
import { exitFieldFilled } from '../../state-machines/machines/opportunity';
import { istDayStart } from '../../telecom/call-schedule';
import { withinCallingHours } from '../../telecom/dial-policy';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { listTimeline } from '../crm/customers';
import { teamIn } from '../crm/list-lead-assignees';
import { effectiveDispositions } from '../crm/pipeline-settings';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { callConsentWithdrawnSql } from './consent';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** Postgres's text form of a timestamp, as the cursor carries it. */
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

const QueueCursor = z
  .object({
    asOf: z.iso.datetime(),
    b: z.number().int().min(0).max(2),
    d: z.string().regex(PG_TIME).nullable(),
    s: z.number().int(),
    c: z.string().regex(PG_TIME),
    id: z.uuid(),
  })
  .strict();

/** The recent timeline rows the workspace shows of a lead. */
const RECENT_ACTIVITY = 8;
/** The most callers a team view lists. */
const MAX_TEAM_CALLERS = 200;

/** The queue screens are for people; an agent never works a caller's queue. */
function checkCaller(ctx: Ctx): void {
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the calling screens are for people, not agents');
  }
  checkPermission(ctx.principal, 'calls.log', 'own');
}

/** The request's companies, narrowed to one when the input names it. */
function companies(ctx: Ctx, entityId: number | undefined): number[] {
  if (entityId === undefined) return [...ctx.entityIds];
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  return [entityId];
}

/**
 * The leads in callers' queues as of `asOf`, ranked (docs/design/phase1.md §7.2, PRD TEL-01): the
 * owners' open leads in their pipeline's first stages (the open stages before Qualified) and their
 * nurtured leads, each with
 * - `next_call_at`, the owner's earliest open callback or nurture call on it;
 * - `bucket`: 0 when that call is due, 1 for a lead never called whose first-contact limit
 *   (`pipelines.first_contact_sla_minutes`) has passed, 2 for any other lead with no call set, and
 *   null for a lead whose next call is later or a nurtured lead with no call due, which stays out
 *   of the queue until then.
 * RLS decides which leads the reader sees; `owners` names whose queues.
 */
function rankedQueue(owners: SQL, entityIds: readonly number[], asOf: Date): SQL {
  const at = asOf.toISOString();
  return sql`
    select q.*,
           case
             when q.next_call_at is not null and q.next_call_at <= ${at}::timestamptz then 0
             when q.next_call_at is not null or q.state = 'nurture' then null
             when q.last_call_at is null and q.sla_minutes is not null
                  and q.created_at + make_interval(mins => q.sla_minutes) <= ${at}::timestamptz then 1
             else 2
           end as bucket
      from (
        select o.id, o.entity_id, o.account_id, o.site_id, o.owner_id, o.score, o.created_at,
               o.state, pl.segment, pl.first_contact_sla_minutes as sla_minutes, ps.name as stage_name,
               (select min(t.due_at) from tasks t
                 where t.opportunity_id = o.id and t.entity_id = o.entity_id
                   and t.account_id = o.account_id and t.assignee_id = o.owner_id
                   and t.state = 'open' and t.kind in ('callback', 'nurture')) as next_call_at,
               lc.started_at as last_call_at,
               case when lc.next_action = 'retry' then lc.attempt_no else 0 end as attempts
          from opportunities o
          join pipeline_stages ps on ps.id = o.stage_id
          join pipelines pl on pl.id = o.pipeline_id
          left join lateral (
            select c.started_at, c.attempt_no, d.next_action
              from calls c join call_dispositions d on d.id = c.disposition_id
             where c.opportunity_id = o.id
             order by c.started_at desc, c.id desc
             limit 1) lc on true
         where ${owners}
           and o.entity_id = any(${`{${entityIds.join(',')}}`}::int[])
           and o.archived_at is null
           and ((o.state = 'open' and ps.kind = 'open'
                 and ps.position < coalesce(
                   (select f.position from pipeline_stages f
                     where f.pipeline_id = o.pipeline_id and f.key = 'qualified'
                       and f.archived_at is null), 2147483647))
                or o.state = 'nurture')
      ) q`;
}

function reasonOf(bucket: number, state: string, lastCallAt: Date | null): CallQueueReason {
  if (bucket === 0) return state === 'nurture' ? 'nurture_due' : 'call_due';
  if (bucket === 1) return 'first_call_late';
  return lastCallAt === null ? 'not_called' : 'to_call';
}

interface QueueRow extends Record<string, unknown> {
  id: string;
  entity_id: number;
  account_id: string;
  score: number;
  created_at: Date | string;
  created_text: string;
  state: string;
  segment: string;
  stage_name: string;
  next_call_at: Date | string | null;
  due_text: string | null;
  last_call_at: Date | string | null;
  attempts: number;
  bucket: number;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/**
 * A caller's queue (`/calling`, PRD TEL-01), a page at a time: due callbacks, retries and nurture
 * calls first (earliest due first), then new leads whose first call is late, then the rest, each
 * by score (highest first) and age (oldest first), keyset on that order. The page is read as of
 * one moment (`asOf`), which the cursor carries, so a lead does not jump between pages as calls
 * fall due. `callerId` names a member of the caller's team (a team lead's view, `calls.log` at
 * team scope or wider); RLS still decides which of their leads the reader sees. Only the page's
 * customers are read after: name, village, the main phone's last four digits and whether consent
 * to calls was withdrawn.
 */
export async function listCallQueue(
  ctx: Ctx,
  rawInput: unknown = {},
  now: Date = new Date(),
): Promise<CallQueuePage> {
  const input = parseQueryInput(ListCallQueueInput, rawInput, 'calls.queue.list');
  checkCaller(ctx);
  const callerId = input.callerId ?? ctx.principal.id;
  if (callerId !== ctx.principal.id) checkPermission(ctx.principal, 'calls.log', 'team');
  const entityIds = companies(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(QueueCursor, input.cursor);
  const asOf = after === undefined ? now : new Date(after.asOf);

  const keyset =
    after === undefined
      ? sql`true`
      : sql`(r.bucket, coalesce(r.next_call_at, '-infinity'::timestamptz), -r.score, r.created_at, r.id)
            > (${after.b}, coalesce(${after.d}::text::timestamptz, '-infinity'::timestamptz),
               ${after.s}, ${after.c}::text::timestamptz, ${after.id}::uuid)`;
  const rows = (await ctx.tx.execute(sql`
    select r.id, r.entity_id, r.account_id, r.score, r.created_at, r.created_at::text as created_text,
           r.state, r.segment, r.stage_name, r.next_call_at,
           case when r.bucket = 0 then r.next_call_at::text end as due_text,
           r.last_call_at, r.attempts, r.bucket
      from (${rankedQueue(sql`o.owner_id = ${callerId}::uuid`, entityIds, asOf)}) r
     where r.bucket is not null and ${keyset}
     order by r.bucket, coalesce(case when r.bucket = 0 then r.next_call_at end, '-infinity'::timestamptz),
              r.score desc, r.created_at, r.id
     limit ${input.limit + 1}`)) as unknown as QueueRow[];

  const page = rows.slice(0, input.limit);
  const details = await customersOf(
    ctx,
    page.map((r) => r.id),
  );
  const last = page.at(-1);
  return CallQueuePageDto.parse({
    items: page.flatMap((r) => {
      const customer = details.get(r.id);
      if (customer === undefined) return [];
      const lastCallAt = r.last_call_at === null ? null : toDate(r.last_call_at);
      return [
        CallQueueItemDto.parse({
          opportunityId: r.id,
          entityId: r.entity_id,
          accountId: r.account_id,
          customerName: customer.name,
          village: customer.village,
          phoneLast4: customer.last4,
          segment: SegmentSchema.parse(r.segment),
          stageName: r.stage_name,
          state: OpportunityStateSchema.parse(r.state),
          score: r.score,
          createdAt: toDate(r.created_at).toISOString(),
          reason: reasonOf(r.bucket, r.state, lastCallAt),
          dueAt: r.bucket === 0 && r.next_call_at !== null ? toDate(r.next_call_at).toISOString() : null,
          attempts: r.attempts,
          lastCallAt: lastCallAt?.toISOString() ?? null,
          consentWithdrawn: customer.withdrawn,
        }),
      ];
    }),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({
            asOf: asOf.toISOString(),
            b: last.bucket,
            d: last.due_text,
            s: -last.score,
            c: last.created_text,
            id: last.id,
          })
        : null,
    asOf: asOf.toISOString(),
  });
}

/** The customers of a page of leads: name, the site's village, the main phone's last digits. */
async function customersOf(ctx: Ctx, opportunityIds: readonly string[]) {
  const out = new Map<
    string,
    { name: string; village: string | null; last4: string | null; withdrawn: boolean }
  >();
  if (opportunityIds.length === 0) return out;
  const rows = (await ctx.tx.execute(sql`
    select o.id, a.name, s.village, right(p.e164, 4) as last4,
           ${callConsentWithdrawnSql(sql`a.id`)} as withdrawn
      from opportunities o
      join accounts a on a.id = o.account_id
      left join customer_sites s on s.id = o.site_id
      left join account_contacts ac on ac.account_id = a.id and ac.role = 'owner'
      left join contact_phones p on p.contact_id = ac.contact_id and p.is_primary
     where o.id = any(${`{${opportunityIds.join(',')}}`}::uuid[])`)) as unknown as {
    id: string;
    name: string;
    village: string | null;
    last4: string | null;
    withdrawn: boolean;
  }[];
  for (const r of rows) {
    out.set(r.id, { name: r.name, village: r.village, last4: r.last4, withdrawn: r.withdrawn });
  }
  return out;
}

/** The lead, its pipeline and stage, its site and its customer's owner contact, under RLS. */
async function leadFor(ctx: Ctx, entityId: number, opportunityId: string) {
  const o = schema.opportunities;
  const [row] = await ctx.tx
    .select()
    .from(o)
    .where(and(eq(o.id, opportunityId), eq(o.entityId, entityId), isNull(o.archivedAt)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `opportunity ${opportunityId} is not visible`, {
      reason: 'lead_missing',
    });
  }
  return row;
}

/**
 * One lead as the workspace shows it (`/calling`): the customer and their call language (the
 * script variant, ADR 0014), the stage and what its exit rules ask, the outcomes the caller may
 * press (`effectiveDispositions`), the unanswered attempts so far, the next call set and the
 * lead's recent timeline. The phone shows only its last four digits; `dialNumber` shows it in
 * full inside calling hours.
 */
export async function loadCallLead(ctx: Ctx, rawInput: unknown): Promise<CallLead> {
  const input = parseQueryInput(LoadCallLeadInput, rawInput, 'calls.lead.load');
  checkCaller(ctx);
  companies(ctx, input.entityId);
  const lead = await leadFor(ctx, input.entityId, input.opportunityId);

  const pl = schema.pipelines;
  const ps = schema.pipelineStages;
  const [where] = await ctx.tx
    .select({ pipelineName: pl.name, segment: pl.segment, stageName: ps.name })
    .from(pl)
    .innerJoin(ps, eq(ps.id, lead.stageId))
    .where(eq(pl.id, lead.pipelineId))
    .limit(1);
  if (!where) throw new DomainError('internal', `lead ${lead.id} has no readable stage`);
  const segment = SegmentSchema.parse(where.segment);

  const [customer] = (await ctx.tx.execute(sql`
    select a.name, c.name as contact_name, c.preferred_language, s.village, s.district,
           right(p.e164, 4) as last4, ${callConsentWithdrawnSql(sql`a.id`)} as withdrawn
      from accounts a
      left join account_contacts ac on ac.account_id = a.id and ac.role = 'owner'
      left join contacts c on c.id = ac.contact_id
      left join contact_phones p on p.contact_id = c.id and p.is_primary
      left join customer_sites s on s.id = ${lead.siteId}::uuid
     where a.id = ${lead.accountId}::uuid`)) as unknown as {
    name: string;
    contact_name: string | null;
    preferred_language: string | null;
    village: string | null;
    district: string | null;
    last4: string | null;
    withdrawn: boolean;
  }[];
  if (!customer) {
    throw new DomainError('not_found', `the customer of lead ${lead.id} is not visible`, {
      reason: 'lead_missing',
    });
  }

  const record = await opportunityRecord(ctx, lead);
  const exitChecks = record.exitRequiredFields.flatMap((field) => {
    const parsed = StageExitFieldSchema.safeParse(field);
    return parsed.success
      ? [{ field: parsed.data, met: exitFieldFilled(record.fields[field]) }]
      : [];
  });

  const c = schema.calls;
  const d = schema.callDispositions;
  const t = schema.tasks;
  const people = [...new Set([ctx.principal.id, ...(lead.ownerId === null ? [] : [lead.ownerId])])];
  const [outcomes, latest, nextTask, timeline] = await Promise.all([
    effectiveDispositions(ctx, lead.entityId, segment),
    ctx.tx
      .select({ attemptNo: c.attemptNo, nextAction: d.nextAction })
      .from(c)
      .innerJoin(d, eq(d.id, c.dispositionId))
      .where(eq(c.opportunityId, lead.id))
      .orderBy(sql`${c.startedAt} desc`, sql`${c.id} desc`)
      .limit(1),
    ctx.tx
      .select({ kind: t.kind, dueAt: t.dueAt })
      .from(t)
      .where(
        and(
          eq(t.opportunityId, lead.id),
          eq(t.entityId, lead.entityId),
          eq(t.state, 'open'),
          inArray(t.kind, ['callback', 'nurture']),
          inArray(t.assigneeId, people),
        ),
      )
      .orderBy(asc(t.dueAt))
      .limit(1),
    listTimeline(ctx, {
      entityId: lead.entityId,
      opportunityId: lead.id,
      limit: RECENT_ACTIVITY,
    }),
  ]);

  const state = OpportunityStateSchema.parse(lead.state);
  const perms = ctx.principal.permissions;
  const covers =
    hasGrant(perms, 'calls.log', 'entity') ||
    (hasGrant(perms, 'calls.log', 'team') &&
      lead.teamId !== null &&
      lead.teamId === teamIn(ctx, lead.entityId)) ||
    (hasGrant(perms, 'calls.log', 'own') && lead.ownerId === ctx.principal.id);
  const last = latest[0];
  const next = nextTask[0];
  return CallLeadDto.parse({
    opportunityId: lead.id,
    entityId: lead.entityId,
    accountId: lead.accountId,
    state,
    customerName: customer.name,
    contactName: customer.contact_name,
    language: CustomerLanguageSchema.catch('hinglish').parse(customer.preferred_language),
    segment,
    pipelineName: where.pipelineName,
    stageName: where.stageName,
    score: lead.score,
    village: customer.village,
    district: customer.district,
    phoneLast4: customer.last4,
    consentWithdrawn: customer.withdrawn,
    canLog: covers && (state === 'open' || state === 'nurture'),
    exitChecks,
    dispositions: outcomes.dispositions,
    attempts: last?.nextAction === 'retry' ? last.attemptNo : 0,
    maxAttempts: WORKSHOP_DEFAULTS.calling.attemptDays.length,
    nextCall:
      next === undefined
        ? null
        : { kind: next.kind, dueAt: next.dueAt.toISOString() },
    recentActivity: timeline.items,
  });
}

/**
 * The full number to dial for a lead (the workspace's `D`), shown only inside calling hours
 * (`outside_calling_hours`, TRAI 9 AM to 9 PM) and to a customer who has not withdrawn consent to
 * calls (`call_consent_withdrawn`); the main phone of the customer's owner contact.
 */
export async function dialNumber(
  ctx: Ctx,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<DialNumber> {
  const input = parseQueryInput(DialNumberInput, rawInput, 'calls.dial_number');
  checkCaller(ctx);
  companies(ctx, input.entityId);
  const lead = await leadFor(ctx, input.entityId, input.opportunityId);
  if (!withinCallingHours(now)) {
    throw new DomainError('validation_failed', 'numbers are shown in calling hours', {
      reason: 'outside_calling_hours',
    });
  }
  const [row] = (await ctx.tx.execute(sql`
    select p.e164, ${callConsentWithdrawnSql(sql`${lead.accountId}::uuid`)} as withdrawn
      from account_contacts ac
      join contact_phones p on p.contact_id = ac.contact_id and p.is_primary
     where ac.account_id = ${lead.accountId}::uuid and ac.role = 'owner'
     limit 1`)) as unknown as { e164: string; withdrawn: boolean }[];
  if (row?.withdrawn === true) {
    throw new DomainError('conflict', 'the customer withdrew consent to calls', {
      reason: 'call_consent_withdrawn',
    });
  }
  if (!row) {
    throw new DomainError('not_found', 'the customer has no main number', {
      reason: 'dial_number_missing',
    });
  }
  return DialNumberDto.parse({ e164: row.e164 });
}

/**
 * The team lead's view (`/calling`, PRD TEL-01): every person of the caller's team who logs calls,
 * in the request's companies, with how many leads wait in their queue, how many of those are due
 * calls and late first calls, and how many calls they logged today (IST). A company-wide reader
 * (`calls.log` at company scope) sees every caller of the company. Needs `calls.log` at team
 * scope or wider; RLS decides which leads and calls are counted.
 */
export async function listTeamQueues(
  ctx: Ctx,
  rawInput: unknown = {},
  now: Date = new Date(),
): Promise<TeamQueue[]> {
  const input = parseQueryInput(ListTeamQueuesInput, rawInput, 'calls.team_queues.list');
  checkCaller(ctx);
  checkPermission(ctx.principal, 'calls.log', 'team');
  const entityIds = companies(ctx, input.entityId);
  const wide = hasGrant(ctx.principal.permissions, 'calls.log', 'entity');

  const uer = schema.userEntityRoles;
  const rp = schema.rolePermissions;
  const p = schema.principals;
  const teams = entityIds.flatMap((e) => {
    const team = teamIn(ctx, e);
    return team === undefined ? [] : [{ entityId: e, teamId: team }];
  });
  if (!wide && teams.length === 0) return [];
  const reach = wide
    ? undefined
    : sql`(${uer.entityId}, ${uer.teamId}) in (${sql.join(
        teams.map((t) => sql`(${t.entityId}::smallint, ${t.teamId}::uuid)`),
        sql`, `,
      )})`;
  const members = await ctx.tx
    .selectDistinct({ id: p.id, name: p.displayName, entityId: uer.entityId })
    .from(uer)
    .innerJoin(p, and(eq(p.id, uer.userId), eq(p.kind, 'user'), isNull(p.archivedAt)))
    .innerJoin(rp, and(eq(rp.roleId, uer.roleId), eq(rp.permissionKey, 'calls.log')))
    .where(and(inArray(uer.entityId, entityIds), reach, sql`app.user_is_active(${p.id})`))
    .orderBy(asc(p.displayName), asc(p.id), asc(uer.entityId))
    .limit(MAX_TEAM_CALLERS);
  if (members.length === 0) return [];

  const ids = [...new Set(members.map((m) => m.id))];
  const idList = `{${ids.join(',')}}`;
  const counts = (await ctx.tx.execute(sql`
    select r.owner_id, r.entity_id,
           count(*)::int as waiting,
           count(*) filter (where r.bucket = 0)::int as due,
           count(*) filter (where r.bucket = 1)::int as late
      from (${rankedQueue(sql`o.owner_id = any(${idList}::uuid[])`, entityIds, now)}) r
     where r.bucket is not null
     group by r.owner_id, r.entity_id`)) as unknown as {
    owner_id: string;
    entity_id: number;
    waiting: number;
    due: number;
    late: number;
  }[];
  const today = await ctx.tx
    .select({
      callerId: schema.calls.callerId,
      entityId: schema.calls.entityId,
      n: sql<number>`count(*)::int`,
    })
    .from(schema.calls)
    .where(
      and(
        inArray(schema.calls.callerId, ids),
        inArray(schema.calls.entityId, entityIds),
        sql`${schema.calls.startedAt} >= ${istDayStart(now).toISOString()}::timestamptz`,
      ),
    )
    .groupBy(schema.calls.callerId, schema.calls.entityId);

  return members.map((m) => {
    const c = counts.find((x) => x.owner_id === m.id && x.entity_id === m.entityId);
    const n = today.find((x) => x.callerId === m.id && x.entityId === m.entityId);
    return TeamQueueDto.parse({
      callerId: m.id,
      callerName: m.name,
      entityId: m.entityId,
      waiting: c?.waiting ?? 0,
      due: c?.due ?? 0,
      late: c?.late ?? 0,
      callsToday: n?.n ?? 0,
    });
  });
}
