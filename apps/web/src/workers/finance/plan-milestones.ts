import type { DeliveredEvent } from '@shakti/contracts';
import { executeCommand, planConfirmedMilestones } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

/**
 * `sales.order.confirmed`: the order's payment milestones planned from its company's terms
 * (FN1, docs/03-roadmap-appendix/phase5.md §6.1), as `system:workers`. A repeated delivery, or
 * one for an order cancelled since, changes nothing.
 */
export async function handleOrderConfirmedMilestones(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<void> {
  await executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    planConfirmedMilestones,
    { entityId: event.entityId, orderId: event.aggregateId },
  );
}
