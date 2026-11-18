import type {
  DeliveredEvent,
  WhatsAppMilestoneOutcome,
  WhatsAppMilestoneSubject,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  notifyEvent,
  readMilestoneSubject,
  sendWhatsAppMilestone,
  type Logger,
  type MilestoneSubject,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { formatDate, formatRupees } from '../../print/format';
import type { EventHandlerContext } from '../events/registry';
import { deliverNoticeBatch } from '../notify/deliver-notices';

/*
 * The customer milestones of Phase 2 on WhatsApp (docs/03-roadmap-appendix/phase2.md §7.1, PRD
 * WA-01): a quote sent by WhatsApp (`sales.quote.sent` with the channel `whatsapp`) and an order
 * confirmed (`sales.order.confirmed`) each send the company's mapped template once per subject,
 * through `messaging.milestone.send` as the platform. A milestone whose template is not approved
 * is held, not sent. Later phases add their event's handler here and nothing else.
 */

type LiveMilestone = 'quote_sent' | 'order_confirmed';

/** The template's values of a milestone, in the order `WHATSAPP_MILESTONE_VALUES` names them. */
export function milestoneValues(milestone: LiveMilestone, subject: MilestoneSubject): string[] {
  const total = formatRupees(subject.grandTotal);
  if (milestone === 'order_confirmed') return [subject.ref, total];
  return [subject.ref, total, subject.validUntil === null ? '' : formatDate(subject.validUntil)];
}

async function sendMilestone(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  milestone: LiveMilestone,
  subjectKind: WhatsAppMilestoneSubject,
  threadId: string | null,
  log: Logger,
): Promise<WhatsAppMilestoneOutcome | 'not_found'> {
  const scope = { entityIds: [event.entityId], requestId: ctx.requestId };
  const subject = await executeQuery(
    ctx.principal,
    scope,
    (tx) =>
      readMilestoneSubject(tx, {
        entityId: event.entityId,
        milestone,
        subjectKind,
        subjectId: event.aggregateId,
        threadId,
      }),
    { name: 'messaging.milestone.subject' },
  );
  if (subject === null) return 'not_found';
  const sent = await executeCommand(ctx.principal, scope, sendWhatsAppMilestone, {
    entityId: event.entityId,
    milestone,
    subjectKind,
    subjectId: event.aggregateId,
    threadId,
    values: milestoneValues(milestone, subject),
  });
  log.log('info', 'messaging.milestone', {
    requestId: ctx.requestId,
    milestone,
    subjectId: event.aggregateId,
    outcome: sent.outcome,
  });
  return sent.outcome;
}

/** The outcomes of a quote's milestone that leave the customer without it. */
const NOT_SENT: readonly WhatsAppMilestoneOutcome[] = [
  'held',
  'not_mapped',
  'not_due',
  'no_chat',
  'opted_out',
  'no_consent',
];

/**
 * `sales.quote.sent`: a quote sent by WhatsApp goes as the `quote_sent` milestone on its chat.
 * When it does not go (its template not approved, no map, no chat, no consent, the number
 * stopped messages), the person who sent it is told once (`whatsapp_quote_not_sent`), so they
 * share it another way: the quote reads as sent, and the customer has nothing.
 */
export async function handleQuoteSent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  logger: Logger = appLogger,
): Promise<WhatsAppMilestoneOutcome | 'not_found' | 'recorded'> {
  if (event.payload.channel !== 'whatsapp') return 'recorded';
  const threadId = typeof event.payload.threadId === 'string' ? event.payload.threadId : null;
  const outcome = await sendMilestone(event, ctx, 'quote_sent', 'quote', threadId, logger);
  const sentBy = event.payload.sentBy;
  if (outcome !== 'not_found' && NOT_SENT.includes(outcome) && typeof sentBy === 'string') {
    const batch = await executeCommand(
      ctx.principal,
      { entityIds: [event.entityId], requestId: ctx.requestId },
      notifyEvent,
      {
        event: 'sales.quote.sent',
        entityId: event.entityId,
        eventId: event.id,
        quoteId: event.aggregateId,
        sentBy,
      },
    );
    await deliverNoticeBatch(ctx.principal, batch, { requestId: ctx.requestId });
  }
  return outcome;
}

/** `sales.order.confirmed`: the `order_confirmed` milestone on the customer's chat. */
export async function handleOrderConfirmed(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  logger: Logger = appLogger,
): Promise<WhatsAppMilestoneOutcome | 'not_found'> {
  return sendMilestone(event, ctx, 'order_confirmed', 'sales_order', null, logger);
}
