import type { CancelForOrderDto, DeliveredEvent } from '@shakti/contracts';
import { cancelForOrder, executeCommand } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

/**
 * The project worker for one `sales.order.cancelled` event (docs/03-roadmap-appendix/phase4.md
 * §6.1, J1 review 2), as `system:workers` of the event's company
 * (`projects.project.cancel_for_order`, platform-only `projects.draft`): the order's project is
 * cancelled while none of its steps is done, else kept and its Project Manager told. A repeat
 * delivery finds the project already closed and changes nothing.
 */
export async function handleOrderCancelled(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<CancelForOrderDto> {
  return executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    cancelForOrder,
    { entityId: event.entityId, orderId: event.aggregateId },
  );
}
