import type { DeliveredEvent, DraftProjectDto } from '@shakti/contracts';
import { draftProject, executeCommand } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

/**
 * The drafting worker for one `sales.order.confirmed` event (docs/03-roadmap-appendix/phase4.md
 * §6.1, question 1 (a)): the project of an order that needs installing, as `system:workers` of
 * the event's company (`projects.project.draft`, platform-only `projects.draft`). The command
 * decides whether the order gets one, and drafts once per order, so a repeat delivery drafts
 * nothing twice.
 */
export async function handleProjectDraft(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<DraftProjectDto> {
  return executeCommand(
    ctx.principal,
    { entityIds: [event.entityId], requestId: ctx.requestId },
    draftProject,
    { entityId: event.entityId, orderId: event.aggregateId },
  );
}
