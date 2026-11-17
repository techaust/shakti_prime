import type {
  DeliveredEvent,
  WhatsAppMilestoneOutcome,
  WhatsAppMilestoneSubject,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  readMilestoneSubject,
  sendWhatsAppMilestone,
  type Logger,
  type MilestoneSubject,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { formatDate, formatRupees } from '../../print/format';
import type { EventHandlerContext } from '../events/registry';

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

/** `sales.quote.sent`: a quote sent by WhatsApp goes as the `quote_sent` milestone on its chat. */
export async function handleQuoteSent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  logger: Logger = appLogger,
): Promise<WhatsAppMilestoneOutcome | 'not_found' | 'recorded'> {
  if (event.payload.channel !== 'whatsapp') return 'recorded';
  const threadId = typeof event.payload.threadId === 'string' ? event.payload.threadId : null;
  return sendMilestone(event, ctx, 'quote_sent', 'quote', threadId, logger);
}

/** `sales.order.confirmed`: the `order_confirmed` milestone on the customer's chat. */
export async function handleOrderConfirmed(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
  logger: Logger = appLogger,
): Promise<WhatsAppMilestoneOutcome | 'not_found'> {
  return sendMilestone(event, ctx, 'order_confirmed', 'sales_order', null, logger);
}
