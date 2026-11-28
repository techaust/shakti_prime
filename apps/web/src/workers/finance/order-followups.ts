import type { DeliveredEvent } from '@shakti/contracts';
import { executeCommand, refreshMilestones, settleCancelledOrder } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

/**
 * `sales.order.cancelled`: the order's live proforma and its waiting payments are cancelled with
 * it (FN1, the review of 27-11-2026, finding 6), as `system:workers`. A repeated delivery changes
 * nothing.
 */
export async function handleOrderCancelledFinance(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<void> {
  await executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    settleCancelledOrder,
    { entityId: event.entityId, orderId: event.aggregateId },
  );
}

/**
 * A customer loan's move (J2's `crm.loan.sanctioned`, `crm.loan.disbursed` and
 * `crm.loan.gates_released`, whose payload names `salesOrderId`): the order's waiting payments
 * whose loan no longer holds them fall due (finding 4). Subscribed in `EVENT_WORKERS`, one line
 * each.
 */
export async function handleOrderLoanMoved(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<void> {
  const orderId = event.payload.salesOrderId;
  if (typeof orderId !== 'string') return;
  await executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    refreshMilestones,
    { entityId: event.entityId, orderId },
  );
}
