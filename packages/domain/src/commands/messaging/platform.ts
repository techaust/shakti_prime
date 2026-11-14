import {
  ClaimWhatsAppMessageInput,
  DomainError,
  EntityIdSchema,
  InboundWhatsAppRecorded,
  MatchWhatsAppThreadInput,
  QueueWhatsAppMessageInput,
  RecordInboundWhatsAppInput,
  RecordWhatsAppHandOffInput,
  RecordWhatsAppOptOutInput,
  RecordWhatsAppSendInput,
  RecordWhatsAppStatusInput,
  RecordWhatsAppTemplateStatusInput,
  WhatsAppHandOffRecorded,
  WhatsAppHandoffReasonSchema,
  WhatsAppMessageClaimed,
  WhatsAppMessageQueued,
  WhatsAppMessageStatusSchema,
  WhatsAppOptOutRecorded,
  WhatsAppSendRecorded,
  WhatsAppStatusRecorded,
  WhatsAppTemplateStatusRecorded,
  WhatsAppThreadHandlerSchema,
  WhatsAppThreadMatched,
  type MessageRequested,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { isoOf, maskMessageText, threadOptedOut } from './shared';

// The platform's WhatsApp commands (docs/03-roadmap-appendix/phase2.md §6.1): run as
// `system:workers`, which holds the platform-only `messaging.process` and no customer grant (ADR
// 0020). Each writes through one definer that checks that permission and the request's companies
// itself (docs/05-database.md §4.1); none reads a thread, customer or consent by a customer grant.
// Delivery bookkeeping (a message stored, a status, a queued or taken message) writes no audit row,
// as the webhook worker's does: the messages are the record. A change to a customer's consent, who
// answers a thread, the customer it belongs to, or a template's state is audited.

/** A WhatsApp `phone_number_id`, a customer's number and Meta's ids are long numbers by design. */
const META_IDS = [
  // WhatsApp's id for a company's number, matched whole to route the message to its company.
  'phoneNumberId',
  // The customer's number as WhatsApp names it (91 and a mobile number), the thread's key.
  'waId',
  // Meta's message id, an opaque reference that must stay whole to find the message again.
  'providerMessageId',
] as const;

interface InboundRow {
  entity_id: number;
  thread_id: string;
  message_id: string;
  duplicate: boolean;
  first_message: boolean;
  account_id: string | null;
  opportunity_id: string | null;
  holders: number;
  opted_out: boolean;
  handled_by: string;
}

/**
 * `messaging.inbound.record`: one inbound message from Meta's webhook, through
 * `app.whatsapp_record_inbound()`: the company by its WhatsApp number, the thread of that number
 * and the customer's (opened on the first message), the customer when exactly one of the
 * company's customers holds the number, the window opened for 24 hours, and the message stored
 * once by Meta's id. The customer's text is untrusted: masked before it is stored, never logged,
 * never in the audit row. A message stored for the first time emits `messaging.message.received`
 * (or `messaging.button.pressed` for a button reply) with ids only; a repeat changes and emits
 * nothing. A number of no company of the request is not found.
 */
export const recordInboundWhatsApp = defineCommand({
  name: 'messaging.inbound.record',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordInboundWhatsAppInput,
  output: InboundWhatsAppRecorded,
  auditFields: [],
  auditWhen: 'changed',
  auditInput: (input) => ({ kind: input.kind, providerMessageId: input.providerMessageId }),
  unmaskedFields: META_IDS,
  async handler(ctx, input) {
    const body = input.body === null ? null : maskMessageText(input.body);
    const rows = (await ctx.tx.execute(sql`
      select entity_id, thread_id, message_id, duplicate, first_message, account_id,
             opportunity_id, holders, opted_out, handled_by
        from app.whatsapp_record_inbound(${input.phoneNumberId}, ${input.waId},
                                         ${input.providerMessageId}, ${input.kind}, ${body},
                                         ${input.buttonPayload}, ${input.sentAt}::timestamptz)`)) as unknown as InboundRow[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', 'no company has this WhatsApp number', {
        reason: 'whatsapp_number_unknown',
      });
    }
    const entityId = EntityIdSchema.parse(row.entity_id);
    if (!row.duplicate) {
      const facts = { messageId: row.message_id, accountId: row.account_id };
      if (input.kind === 'button') {
        ctx.emit({
          type: 'messaging.button.pressed',
          entityId,
          aggregateType: 'whatsapp_thread',
          aggregateId: row.thread_id,
          payload: { ...facts, firstMessage: row.first_message },
        });
      } else {
        ctx.emit({
          type: 'messaging.message.received',
          entityId,
          aggregateType: 'whatsapp_thread',
          aggregateId: row.thread_id,
          payload: { ...facts, kind: input.kind, firstMessage: row.first_message },
        });
      }
    }
    return {
      entityId,
      threadId: row.thread_id,
      messageId: row.message_id,
      duplicate: row.duplicate,
      firstMessage: row.first_message,
      accountId: row.account_id,
      opportunityId: row.opportunity_id,
      holders: row.holders,
      optedOut: row.opted_out,
      handledBy: WhatsAppThreadHandlerSchema.parse(row.handled_by),
    };
  },
});

/**
 * `messaging.thread.match`: a thread matched to no customer is matched to the customer the lead
 * intake recorded for its number, through `app.whatsapp_match_thread()`, which refuses a customer
 * of the company who does not hold the number. A thread already matched keeps its customer
 * (`matched` false). A thread of no company of the request is not found.
 */
export const matchWhatsAppThread = defineCommand({
  name: 'messaging.thread.match',
  permission: 'messaging.process',
  minScope: 'entity',
  input: MatchWhatsAppThreadInput,
  output: WhatsAppThreadMatched,
  auditFields: ['matched'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(sql`
      select account_id, opportunity_id, matched
        from app.whatsapp_match_thread(${input.threadId}::uuid, ${input.accountId}::uuid)`)) as unknown as {
      account_id: string;
      opportunity_id: string | null;
      matched: boolean;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
        reason: 'whatsapp_thread_missing',
      });
    }
    if (row.matched) {
      ctx.audit({
        aggregateType: 'whatsapp_thread',
        aggregateId: input.threadId,
        entityId: input.entityId,
        before: { matched: false },
        after: { matched: true, accountId: row.account_id },
      });
    }
    return {
      threadId: input.threadId,
      accountId: row.account_id,
      opportunityId: row.opportunity_id,
      matched: row.matched,
    };
  },
});

/**
 * `messaging.status.record`: a delivery status Meta reported, through
 * `app.whatsapp_record_status()`, which moves a message's status only forward: a repeated status,
 * or one that arrives after a later one, changes nothing. A status for a message no company of the
 * request sent (Meta's own test messages) is `known: false`. No audit row.
 */
export const recordWhatsAppStatus = defineCommand({
  name: 'messaging.status.record',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordWhatsAppStatusInput,
  output: WhatsAppStatusRecorded,
  auditFields: [],
  auditWhen: 'changed',
  unmaskedFields: ['providerMessageId'],
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select message_id, thread_id, entity_id, status, changed
        from app.whatsapp_record_status(${input.providerMessageId}, ${input.status},
                                        ${input.at}::timestamptz, ${input.errorCode}::integer)`)) as unknown as {
      message_id: string;
      thread_id: string;
      entity_id: number;
      status: string;
      changed: boolean;
    }[];
    const row = rows[0];
    if (row === undefined) {
      return {
        known: false,
        messageId: null,
        threadId: null,
        entityId: null,
        status: null,
        changed: false,
      };
    }
    return {
      known: true,
      messageId: row.message_id,
      threadId: row.thread_id,
      entityId: EntityIdSchema.parse(row.entity_id),
      status: WhatsAppMessageStatusSchema.parse(row.status),
      changed: row.changed,
    };
  },
});

/**
 * `messaging.template.record_status`: a template's status from Meta's template event, through
 * `app.whatsapp_record_template_status()`, in every company of the request that registered the
 * template under that name and language. Each template it changes is audited.
 */
export const recordWhatsAppTemplateStatus = defineCommand({
  name: 'messaging.template.record_status',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordWhatsAppTemplateStatusInput,
  output: WhatsAppTemplateStatusRecorded,
  auditFields: ['templateStatus'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(sql`
      select template_id, entity_id, previous_status
        from app.whatsapp_record_template_status(${input.name}, ${input.language}, ${input.status})`)) as unknown as {
      template_id: string;
      entity_id: number;
      previous_status: string;
    }[];
    for (const row of rows) {
      ctx.audit({
        aggregateType: 'whatsapp_template',
        aggregateId: row.template_id,
        entityId: row.entity_id,
        before: { templateStatus: row.previous_status },
        after: { templateStatus: input.status },
      });
    }
    return { changed: rows.length };
  },
});

/**
 * `messaging.opt_out.record`: the customer sent STOP on a thread (BLUEPRINT §7.8, PRD CRM-10),
 * through `app.whatsapp_record_opt_out()`: the number opts out, and every WhatsApp consent of every
 * holder of the number is withdrawn, the thread's own customer's on its timeline. A number already
 * opted out changes nothing (`newly` false). From here no message reaches the number by any path
 * but the one confirmation of the STOP (`messaging.message.queue`).
 */
export const recordWhatsAppOptOut = defineCommand({
  name: 'messaging.opt_out.record',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordWhatsAppOptOutInput,
  output: WhatsAppOptOutRecorded,
  auditFields: ['optedOutAt', 'consentsWithdrawn'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(sql`
      select opted_out_at, newly, consents_withdrawn
        from app.whatsapp_record_opt_out(${input.threadId}::uuid, ${input.at}::timestamptz)`)) as unknown as {
      opted_out_at: Date | string;
      newly: boolean;
      consents_withdrawn: number;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
        reason: 'whatsapp_thread_missing',
      });
    }
    const optedOutAt = isoOf(row.opted_out_at) ?? ctx.now.toISOString();
    if (row.newly) {
      ctx.audit({
        aggregateType: 'whatsapp_thread',
        aggregateId: input.threadId,
        entityId: input.entityId,
        after: { optedOutAt, consentsWithdrawn: row.consents_withdrawn },
      });
    }
    return {
      threadId: input.threadId,
      optedOutAt,
      newly: row.newly,
      consentsWithdrawn: row.consents_withdrawn,
    };
  },
});

/**
 * `messaging.thread.record_hand_off`: the platform hands a thread to people (the customer's HUMAN,
 * the output filter's refusals, complaint words), through `app.whatsapp_hand_off()`. A thread
 * already with people keeps its first reason (`changed` false).
 */
export const recordWhatsAppHandOff = defineCommand({
  name: 'messaging.thread.record_hand_off',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordWhatsAppHandOffInput,
  output: WhatsAppHandOffRecorded,
  auditFields: ['handledBy', 'handoffReason'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(sql`
      select handled_by, handoff_reason, changed
        from app.whatsapp_hand_off(${input.threadId}::uuid, ${input.reason})`)) as unknown as {
      handled_by: string;
      handoff_reason: string | null;
      changed: boolean;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
        reason: 'whatsapp_thread_missing',
      });
    }
    if (row.changed) {
      ctx.audit({
        aggregateType: 'whatsapp_thread',
        aggregateId: input.threadId,
        entityId: input.entityId,
        before: { handledBy: 'assistant', handoffReason: null },
        after: { handledBy: row.handled_by, handoffReason: row.handoff_reason },
      });
    }
    return {
      threadId: input.threadId,
      handledBy: WhatsAppThreadHandlerSchema.parse(row.handled_by),
      handoffReason:
        row.handoff_reason === null ? null : WhatsAppHandoffReasonSchema.parse(row.handoff_reason),
      changed: row.changed,
    };
  },
});

/**
 * `messaging.message.queue`: the platform queues the company's template of a purpose on a thread,
 * through `app.whatsapp_queue_message()`: the welcome on a customer's first message (the owner's
 * decision of 13-11-2026, question 2 (a): a template sent by the messaging worker, not by an
 * agent), or the confirmation of a STOP, the one message a number that opted out still gets, once
 * after each STOP. Nothing is queued when the company registered no template for the purpose, or
 * for the welcome when the number has opted out. Emits `messaging.message.requested`.
 */
export const queueWhatsAppMessage = defineCommand({
  name: 'messaging.message.queue',
  permission: 'messaging.process',
  minScope: 'entity',
  input: QueueWhatsAppMessageInput,
  output: WhatsAppMessageQueued,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const none = { threadId: input.threadId, messageId: null, queued: false };
    const w = schema.whatsappTemplates;
    const [template] = await ctx.tx
      .select({ name: w.name })
      .from(w)
      .where(and(eq(w.entityId, input.entityId), eq(w.purpose, input.purpose), eq(w.language, 'en')))
      .limit(1);
    if (!template) return none;
    if (input.purpose === 'welcome' && (await threadOptedOut(ctx, input.threadId))) return none;
    const kind = input.purpose === 'welcome' ? 'template' : 'system';
    const rows = (await ctx.tx.execute(sql`
      select message_id
        from app.whatsapp_queue_message(${input.threadId}::uuid, ${kind}, ${template.name},
                                        '[]'::jsonb)`)) as unknown as { message_id: string }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
        reason: 'whatsapp_thread_missing',
      });
    }
    const payload: MessageRequested = {
      messageId: row.message_id,
      threadId: input.threadId,
      kind,
    };
    ctx.emit({
      type: 'messaging.message.requested',
      entityId: input.entityId,
      aggregateType: 'whatsapp_thread',
      aggregateId: input.threadId,
      payload,
    });
    return { threadId: input.threadId, messageId: row.message_id, queued: true };
  },
});

/**
 * `messaging.message.claim`: the messaging worker takes a queued message to send it, through
 * `app.whatsapp_claim_send()`: once only, so a message is handed to Meta at most once, even when
 * Meta did not answer in time (a timeout does not prove it was not delivered). No audit row.
 */
export const claimWhatsAppMessage = defineCommand({
  name: 'messaging.message.claim',
  permission: 'messaging.process',
  minScope: 'entity',
  input: ClaimWhatsAppMessageInput,
  output: WhatsAppMessageClaimed,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(
      sql`select app.whatsapp_claim_send(${input.messageId}::uuid) as claimed`,
    )) as unknown as { claimed: boolean }[];
    return { messageId: input.messageId, claimed: rows[0]?.claimed === true };
  },
});

/**
 * `messaging.message.record_send`: what came of a queued message, through
 * `app.whatsapp_record_send()`: sent with Meta's id or failed, for a message the worker took;
 * refused with the check that refused it, for one it did not take. A message already past queued
 * changes nothing (`changed` false). No audit row.
 */
export const recordWhatsAppSend = defineCommand({
  name: 'messaging.message.record_send',
  permission: 'messaging.process',
  minScope: 'entity',
  input: RecordWhatsAppSendInput,
  output: WhatsAppSendRecorded,
  auditFields: [],
  auditWhen: 'changed',
  unmaskedFields: ['providerMessageId'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const providerId = input.status === 'sent' ? input.providerMessageId : null;
    const refusal = input.status === 'refused' ? input.refusal : null;
    const errorCode = input.status === 'failed' ? input.errorCode : null;
    const rows = (await ctx.tx.execute(sql`
      select thread_id, status, changed
        from app.whatsapp_record_send(${input.messageId}::uuid, ${input.status}, ${providerId},
                                      ${refusal}, ${errorCode}::integer)`)) as unknown as {
      thread_id: string;
      status: string;
      changed: boolean;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `message ${input.messageId} is not visible`, {
        reason: 'whatsapp_message_missing',
      });
    }
    return {
      messageId: input.messageId,
      threadId: row.thread_id,
      status: WhatsAppMessageStatusSchema.parse(row.status),
      changed: row.changed,
    };
  },
});
