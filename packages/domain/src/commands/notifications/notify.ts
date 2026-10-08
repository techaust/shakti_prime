import {
  newId,
  NoticeBatchDto,
  NoticePayloadSchema,
  NotifyEventInput,
  PushRecordDto,
  RecordPushInput,
  ScanNoticesInput,
  type WrittenNoticeDto,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import {
  NOTICE_LOOKBACK_MS,
  NOTICE_PUSH_RETRY_AFTER_SECONDS,
  NOTICE_SCAN_LIMIT,
  QUOTE_EXPIRY_NOTICE_MS,
} from '../../notifications/push-plan';
import { requireEntity } from '../crm/opportunity-shared';
import { writeNotices, type NoticeDraft } from './write-notices';

/*
 * The notify worker's commands (docs/03-roadmap-appendix/phase1.md §8.1, PRD RPT-04), run as `system:workers`,
 * which holds the platform-only `notifications.send` and no `crm.*` or `sales.*` permission a
 * person may hold (ADR 0020): every read and write goes through the definers of the notifications
 * migration, which check that permission and the company in their body.
 */

/** The lead an assignment names, as it stands now. */
async function leadNow(
  ctx: CommandContext,
  entityId: number,
  opportunityId: string,
): Promise<{ accountId: string; ownerId: string | null } | undefined> {
  const rows = (await ctx.tx.execute(
    sql`select account_id, owner_id from app.notice_lead(${entityId}::smallint, ${opportunityId}::uuid)`,
  )) as unknown as { account_id: string; owner_id: string | null }[];
  const row = rows[0];
  return row === undefined ? undefined : { accountId: row.account_id, ownerId: row.owner_id };
}

/** Who one event's notice is for, found from the records when the worker runs. */
async function draftsFor(ctx: CommandContext, input: NotifyEventInput): Promise<NoticeDraft[]> {
  switch (input.event) {
    case 'crm.opportunity.assigned': {
      // A person who took a lead themselves is not told; nor is an owner the lead has left since.
      if (input.assignedById === input.ownerId) return [];
      const lead = await leadNow(ctx, input.entityId, input.opportunityId);
      if (lead?.ownerId !== input.ownerId) return [];
      return [
        {
          userId: input.ownerId,
          type: 'lead_assigned',
          subjectType: 'opportunity',
          subjectId: input.opportunityId,
          payload: { accountId: lead.accountId, opportunityId: input.opportunityId },
          dedupeKey: `lead_assigned:${input.eventId}`,
        },
      ];
    }
    case 'crm.duplicate.found': {
      const owners = (await ctx.tx.execute(
        sql`select user_id, account_id, opportunity_id
              from app.notice_duplicate_owners(${input.entityId}::smallint, ${input.candidateId}::uuid)`,
      )) as unknown as { user_id: string; account_id: string; opportunity_id: string }[];
      return owners.map((o) => ({
        userId: o.user_id,
        type: 'duplicate_found',
        subjectType: 'duplicate_candidate',
        subjectId: input.candidateId,
        payload: { accountId: o.account_id, opportunityId: o.opportunity_id },
        dedupeKey: `duplicate_found:${input.candidateId}`,
      }));
    }
    case 'crm.enquiry.routed':
      return [
        {
          userId: input.assigneeId,
          type: 'enquiry_routed',
          subjectType: 'inbox_item',
          subjectId: input.itemId,
          payload: { accountId: input.accountId },
          dedupeKey: `enquiry_routed:${input.itemId}`,
        },
      ];
    case 'sales.order.credit_held': {
      // The Executives who may release the hold and the person who made the order, while it is held.
      const people = (await ctx.tx.execute(
        sql`select user_id, account_id
              from app.notice_order_people(${input.entityId}::smallint, ${input.orderId}::uuid)`,
      )) as unknown as { user_id: string; account_id: string }[];
      return people.map((p) => ({
        userId: p.user_id,
        type: 'order_credit_held',
        subjectType: 'sales_order',
        subjectId: input.orderId,
        payload: { accountId: p.account_id },
        // One notice per hold: a hold for another rule is a new event and tells again.
        dedupeKey: `order_credit_held:${input.eventId}`,
      }));
    }
  }
}

/**
 * `notifications.event.notify`: the notices one event stands for (`crm.opportunity.assigned`,
 * `crm.duplicate.found`, `crm.enquiry.routed`, `sales.order.credit_held`), each for the person who acts on it in the event's
 * company and once per person however often the event is delivered.
 */
export const notifyEvent = defineCommand({
  name: 'notifications.event.notify',
  permission: 'notifications.send',
  minScope: 'entity',
  input: NotifyEventInput,
  output: NoticeBatchDto,
  auditFields: ['notices'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const notices = await writeNotices(ctx, input.entityId, await draftsFor(ctx, input));
    return { entityId: input.entityId, notices, resend: [], more: false };
  },
});

interface CallRow {
  task_id: string;
  user_id: string;
  opportunity_id: string;
  account_id: string;
  dedupe_key: string;
}
interface QuoteRow {
  quote_id: string;
  user_id: string;
  opportunity_id: string;
  account_id: string;
  dedupe_key: string;
}
interface LateRow {
  opportunity_id: string;
  user_id: string;
  account_id: string;
  dedupe_key: string;
}

interface PendingRow {
  id: string;
  user_id: string;
  type: WrittenNoticeDto['type'];
  subject_id: string;
  payload_json: unknown;
}

/**
 * The notices whose push a cut-off run left pending, with their person's browsers as they stand
 * now (none left means the push is settled as failed by the sender). Newer ones are a running
 * batch's own and are left alone.
 */
async function pendingPushes(
  ctx: CommandContext,
  entityId: number,
  written: ReadonlySet<string>,
): Promise<WrittenNoticeDto[]> {
  const rows = (
    (await ctx.tx.execute(
      sql`select * from app.notice_pending_pushes(${entityId}::smallint, ${NOTICE_PUSH_RETRY_AFTER_SECONDS}, ${NOTICE_SCAN_LIMIT})`,
    )) as unknown as PendingRow[]
  ).filter((r) => !written.has(r.id));
  if (rows.length === 0) return [];
  const users = [...new Set(rows.map((r) => r.user_id))];
  const targets = (await ctx.tx.execute(
    sql`select * from app.notice_push_targets(${entityId}::smallint, ${`{${users.join(',')}}`}::uuid[])`,
  )) as unknown as { user_id: string; endpoint: string; p256dh: string; auth: string }[];
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    entityId,
    payload: NoticePayloadSchema.parse(r.payload_json),
    subjectId: r.subject_id,
    push: 'send' as const,
    targets: targets
      .filter((t) => t.user_id === r.user_id)
      .map((t) => ({ endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth })),
  }));
}

/**
 * `notifications.due.scan`: one batch of a company's notices that no event announces, run every five
 * minutes by the scan worker: callbacks and nurture calls that fell due (for their person), quotes
 * that lapse within a day (for their lead's owner), and new leads past the first-contact limit and
 * never called (for the company's General Managers, once per lead). Each find comes with the
 * reason it is told for, and nothing already told for that reason comes back, so a repeated scan
 * writes nothing twice (and the pushes a cut-off run left pending come back in `resend`); `more` asks for another batch when a kind filled its batch.
 */
export const scanNotices = defineCommand({
  name: 'notifications.due.scan',
  permission: 'notifications.send',
  minScope: 'entity',
  input: ScanNoticesInput,
  output: NoticeBatchDto,
  auditFields: ['notices'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const entity = input.entityId;
    const since = new Date(ctx.now.getTime() - NOTICE_LOOKBACK_MS).toISOString();
    const until = new Date(ctx.now.getTime() + QUOTE_EXPIRY_NOTICE_MS).toISOString();
    const calls = (await ctx.tx.execute(
      sql`select * from app.notice_due_calls(${entity}::smallint, ${since}::timestamptz, ${NOTICE_SCAN_LIMIT})`,
    )) as unknown as CallRow[];
    const quotes = (await ctx.tx.execute(
      sql`select * from app.notice_expiring_quotes(${entity}::smallint, ${until}::timestamptz, ${NOTICE_SCAN_LIMIT})`,
    )) as unknown as QuoteRow[];
    const late = (await ctx.tx.execute(
      sql`select * from app.notice_late_first_calls(${entity}::smallint, ${since}::timestamptz, ${NOTICE_SCAN_LIMIT})`,
    )) as unknown as LateRow[];
    const drafts: NoticeDraft[] = [
      ...calls.map((r) => ({
        userId: r.user_id,
        type: 'call_due' as const,
        subjectType: 'task' as const,
        subjectId: r.task_id,
        payload: { accountId: r.account_id, opportunityId: r.opportunity_id },
        dedupeKey: r.dedupe_key,
      })),
      ...quotes.map((r) => ({
        userId: r.user_id,
        type: 'quote_expiring' as const,
        subjectType: 'quote' as const,
        subjectId: r.quote_id,
        payload: { accountId: r.account_id, opportunityId: r.opportunity_id, quoteId: r.quote_id },
        dedupeKey: r.dedupe_key,
      })),
      ...late.map((r) => ({
        userId: r.user_id,
        type: 'first_call_late' as const,
        subjectType: 'opportunity' as const,
        subjectId: r.opportunity_id,
        payload: { accountId: r.account_id, opportunityId: r.opportunity_id },
        dedupeKey: r.dedupe_key,
      })),
    ];
    const notices = await writeNotices(ctx, entity, drafts);
    const resend = await pendingPushes(ctx, entity, new Set(notices.map((n) => n.id)));
    const more = [calls, quotes, late].some((rows) => rows.length === NOTICE_SCAN_LIMIT);
    return { entityId: entity, notices, resend, more };
  },
});

/**
 * `notifications.push.record`: what became of the pushes of a company's new notices, the browsers
 * the push service says are gone (removed) and the ones that took a push. One audit row counts it.
 */
export const recordPush = defineCommand({
  name: 'notifications.push.record',
  permission: 'notifications.send',
  minScope: 'entity',
  input: RecordPushInput,
  output: PushRecordDto,
  auditFields: ['recorded', 'removed'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // Addresses go as JSON and come out as a text array, so no character of theirs is lost.
    const toArray = (values: readonly string[]) =>
      sql`array(select jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
    const rows = (await ctx.tx.execute(
      sql`select recorded, removed from app.record_notice_push(
            ${input.entityId}::smallint, ${JSON.stringify(input.outcomes)}::jsonb,
            ${toArray(input.gone)}, ${toArray(input.delivered)})`,
    )) as unknown as { recorded: number; removed: number }[];
    const result = { recorded: rows[0]?.recorded ?? 0, removed: rows[0]?.removed ?? 0 };
    if (result.removed > 0) {
      ctx.audit({
        aggregateType: 'push_batch',
        aggregateId: newId(),
        entityId: input.entityId,
        before: null,
        after: result,
      });
    }
    return result;
  },
});
