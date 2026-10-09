import {
  CallerHomeDto,
  CreditHomeDto,
  DomainError,
  PipelineStagesDto,
  ResponseTimeDto,
  SalesHomeDto,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { checkPermission, isAgent } from '../../command/run-command';
import { periodBounds, periodStartOn } from '../../sales/targets';
import { teamQueueCountsSql } from '../calls/call-queue';
import { targetActualsSql } from '../sales/targets';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The home pages are for people; an agent has none. */
function requirePerson(ctx: Ctx): void {
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the home pages are for people, not agents');
  }
}

const idList = (ids: readonly number[]) => sql`${`{${ids.join(',')}}`}::int[]`;

/**
 * The caller's home: per company of the request, how many leads wait in their queue, how many of
 * those are due and how many first calls are late (the queue's own count, `calls.log` at own
 * scope), and the calls they logged today, counted by the database whether or not they can still
 * read the lead (`app.target_actuals()`).
 */
export async function homeCaller(ctx: Ctx, now: Date = new Date()): Promise<CallerHomeDto[]> {
  requirePerson(ctx);
  checkPermission(ctx.principal, 'calls.log', 'own');
  const me = ctx.principal.id;
  const counts = (await ctx.tx.execute(
    teamQueueCountsSql([me], ctx.entityIds, now),
  )) as unknown as { entity_id: number; waiting: number; due: number; late: number }[];
  const { from, to } = periodBounds('day', periodStartOn('day', now));
  const out: CallerHomeDto[] = [];
  for (const entityId of ctx.entityIds) {
    const [today] = (await ctx.tx.execute(
      targetActualsSql(entityId, from, to, [me]),
    )) as unknown as { calls_n: number }[];
    const c = counts.find((x) => x.entity_id === entityId);
    out.push(
      CallerHomeDto.parse({
        entityId,
        waiting: c?.waiting ?? 0,
        due: c?.due ?? 0,
        late: c?.late ?? 0,
        callsToday: today?.calls_n ?? 0,
      }),
    );
  }
  return out;
}

/**
 * The pipeline by stage per company (the General Manager's and Executive's homes): the open
 * leads in each stage of each pipeline, in the stages' order. RLS decides which leads are counted;
 * `crm.lead.read` at company scope is the reader's grant.
 */
export function pipelineByStageSql(entityIds: readonly number[]) {
  return sql`
    select o.entity_id, pl.id as pipeline_id, pl.name as pipeline_name, ps.id as stage_id,
           ps.name as stage_name, ps.position, count(*)::int as leads
      from opportunities o
      join pipeline_stages ps on ps.id = o.stage_id
      join pipelines pl on pl.id = o.pipeline_id
     where o.entity_id = any(${idList(entityIds)}) and o.state = 'open' and o.archived_at is null
     group by o.entity_id, pl.id, pl.name, ps.id, ps.name, ps.position
     order by o.entity_id, pl.name, pl.id, ps.position`;
}

export async function homePipeline(ctx: Ctx): Promise<PipelineStagesDto[]> {
  requirePerson(ctx);
  checkPermission(ctx.principal, 'crm.lead.read', 'entity');
  const rows = (await ctx.tx.execute(pipelineByStageSql(ctx.entityIds))) as unknown as {
    entity_id: number;
    pipeline_id: string;
    pipeline_name: string;
    stage_id: string;
    stage_name: string;
    position: number;
    leads: number;
  }[];
  const out = new Map<string, PipelineStagesDto>();
  for (const r of rows) {
    const key = `${String(r.entity_id)}|${r.pipeline_id}`;
    let pipeline = out.get(key);
    if (pipeline === undefined) {
      pipeline = {
        entityId: r.entity_id,
        pipelineId: r.pipeline_id,
        pipelineName: r.pipeline_name,
        stages: [],
      };
      out.set(key, pipeline);
    }
    pipeline.stages.push({
      stageId: r.stage_id,
      stageName: r.stage_name,
      position: r.position,
      leads: r.leads,
    });
  }
  return [...out.values()].map((p) => PipelineStagesDto.parse(p));
}

/**
 * First-call response times per company (the General Manager's home): the open leads whose
 * pipeline sets a first-contact limit that have waited past it with no call, and the leads of the
 * last 30 days whose first call came after the limit. `crm.lead.read` at company scope.
 */
export function responseTimeSql(entityIds: readonly number[], now: Date) {
  const at = now.toISOString();
  return sql`
    select e.id as entity_id,
           coalesce(s.waiting_past_limit, 0)::int as waiting_past_limit,
           coalesce(s.called_late, 0)::int as called_late,
           (select count(*)::int from pipelines p2
             where p2.first_contact_sla_minutes is not null and p2.archived_at is null
               and (p2.entity_id is null or p2.entity_id = e.id)) as pipelines_with_limit
      from unnest(${idList(entityIds)}) as e(id)
      left join lateral (
        select count(*) filter (where fc.first_call is null and o.state = 'open'
                                  and o.created_at + make_interval(mins => pl.first_contact_sla_minutes)
                                      <= ${at}::timestamptz) as waiting_past_limit,
               count(*) filter (where fc.first_call is not null
                                  and fc.first_call > o.created_at + make_interval(mins => pl.first_contact_sla_minutes)
                                  and o.created_at >= ${at}::timestamptz - interval '30 days') as called_late
          from opportunities o
          join pipelines pl on pl.id = o.pipeline_id and pl.first_contact_sla_minutes is not null
          left join lateral (select min(c.started_at) as first_call from calls c
                              where c.opportunity_id = o.id) fc on true
         where o.entity_id = e.id and o.archived_at is null
           and (o.state = 'open' or o.created_at >= ${at}::timestamptz - interval '30 days')
      ) s on true`;
}

export async function homeResponseTimes(
  ctx: Ctx,
  now: Date = new Date(),
): Promise<ResponseTimeDto[]> {
  requirePerson(ctx);
  checkPermission(ctx.principal, 'crm.lead.read', 'entity');
  const rows = (await ctx.tx.execute(responseTimeSql(ctx.entityIds, now))) as unknown as {
    entity_id: number;
    waiting_past_limit: number;
    called_late: number;
    pipelines_with_limit: number;
  }[];
  return ctx.entityIds.map((entityId) => {
    const r = rows.find((x) => x.entity_id === entityId);
    return ResponseTimeDto.parse({
      entityId,
      limitSet: (r?.pipelines_with_limit ?? 0) > 0,
      waitingPastLimit: r?.waiting_past_limit ?? 0,
      calledLate: r?.called_late ?? 0,
    });
  });
}

/**
 * Quotes and orders per company this month in IST (the Executive's home): quotes sent and still
 * waiting for an answer, quotes accepted this month, orders confirmed this month and their total.
 * Sales figures only, no cost or margin. `crm.lead.read` at company scope; RLS decides the rows.
 */
export function salesThisMonthSql(entityIds: readonly number[], from: Date, to: Date) {
  const f = from.toISOString();
  const t = to.toISOString();
  return sql`
    select e.id as entity_id,
           (select count(*)::int from quotes q where q.entity_id = e.id and q.state = 'sent') as quotes_sent,
           (select count(*)::int from quotes q where q.entity_id = e.id and q.state = 'accepted'
               and q.state_changed_at >= ${f}::timestamptz and q.state_changed_at < ${t}::timestamptz) as quotes_accepted,
           (select count(*)::int from sales_orders so where so.entity_id = e.id and so.state <> 'cancelled'
               and so.confirmed_at >= ${f}::timestamptz and so.confirmed_at < ${t}::timestamptz) as orders_confirmed,
           (select coalesce(sum(so.grand_total), 0)::numeric(14, 2)::text from sales_orders so
             where so.entity_id = e.id and so.state <> 'cancelled'
               and so.confirmed_at >= ${f}::timestamptz and so.confirmed_at < ${t}::timestamptz) as orders_value
      from unnest(${idList(entityIds)}) as e(id)`;
}

export async function homeSales(ctx: Ctx, now: Date = new Date()): Promise<SalesHomeDto[]> {
  requirePerson(ctx);
  checkPermission(ctx.principal, 'crm.lead.read', 'entity');
  const { from, to } = periodBounds('month', periodStartOn('month', now));
  const rows = (await ctx.tx.execute(salesThisMonthSql(ctx.entityIds, from, to))) as unknown as {
    entity_id: number;
    quotes_sent: number;
    quotes_accepted: number;
    orders_confirmed: number;
    orders_value: string;
  }[];
  return rows.map((r) =>
    SalesHomeDto.parse({
      entityId: r.entity_id,
      quotesSent: r.quotes_sent,
      quotesAccepted: r.quotes_accepted,
      ordersConfirmed: r.orders_confirmed,
      ordersValue: r.orders_value,
    }),
  );
}

/**
 * Dealer credit per company (Accounts' home): orders held for credit, dealers whose exposure
 * (outstanding plus confirmed unpaid orders) is over their limit, and dealers whose oldest unpaid
 * invoice is older than their credit days today in IST. The figures come from
 * `app.dealer_credit_position()`, the one place the exposure is worked out; `sales.credit.write`
 * at company scope, for the companies of the request.
 */
export function creditSummarySql(entityIds: readonly number[]) {
  return sql`
    select e.id as entity_id,
           (select count(*)::int from sales_orders so
             where so.entity_id = e.id and so.credit_held_at is not null) as held_orders,
           d.over_limit, d.overdue
      from unnest(${idList(entityIds)}) as e(id)
      cross join lateral (
        select count(*) filter (where p.credit_limit is not null
                                  and coalesce(p.outstanding, 0) + p.confirmed_unpaid > p.credit_limit)::int as over_limit,
               count(*) filter (where p.credit_days is not null and p.oldest_unpaid_invoice_date is not null
                                  and (now() at time zone 'Asia/Kolkata')::date - p.oldest_unpaid_invoice_date > p.credit_days)::int as overdue
          from accounts a
          join account_entities ae on ae.account_id = a.id and ae.entity_id = e.id
          cross join lateral app.dealer_credit_position(e.id::smallint, a.id, null) p
         where a.type = 'dealer' and a.archived_at is null) d`;
}

export async function homeCredit(ctx: Ctx): Promise<CreditHomeDto[]> {
  requirePerson(ctx);
  checkPermission(ctx.principal, 'sales.credit.write', 'entity');
  const rows = (await ctx.tx.execute(creditSummarySql(ctx.entityIds))) as unknown as {
    entity_id: number;
    held_orders: number;
    over_limit: number;
    overdue: number;
  }[];
  return rows.map((r) =>
    CreditHomeDto.parse({
      entityId: r.entity_id,
      heldOrders: r.held_orders,
      dealersOverLimit: r.over_limit,
      overdueInvoices: r.overdue,
    }),
  );
}
