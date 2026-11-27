import type { DeliveredEvent, FillBackordersDto } from '@shakti/contracts';
import { executeCommand, fillBackorders } from '@shakti/domain';
import type { EventHandlerContext } from '../events/registry';

function idsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * The items whose free stock an event may have changed: those stock moved into a bin of
 * (`inventory.stock.moved`; the fill takes only storage bins' free stock, so a move into any bin
 * is enough to ask), or the item of a hold that ended (`inventory.reservation.released`,
 * `.moved`, `.lapsed`).
 */
export function freedItemsOf(event: DeliveredEvent): string[] {
  const p = event.payload;
  switch (event.type) {
    case 'inventory.stock.moved': {
      const moves = Array.isArray(p.movements) ? (p.movements as unknown[]) : [];
      return [
        ...new Set(
          moves.flatMap((m) => {
            if (m === null || typeof m !== 'object') return [];
            const { itemId, toBinId } = m as { itemId?: unknown; toBinId?: unknown };
            return typeof itemId === 'string' && typeof toBinId === 'string' ? [itemId] : [];
          }),
        ),
      ];
    }
    case 'inventory.reservation.released':
    case 'inventory.reservation.moved':
      return typeof p.itemId === 'string' ? [p.itemId] : [];
    case 'inventory.reservation.lapsed':
      return [...new Set(idsOf(p.itemIds))];
    default:
      return [];
  }
}

/**
 * The backorder fill (docs/03-roadmap-appendix/phase3.md §7.1) after stock arrived or a hold ended:
 * `inventory.reservation.fill` as `system:workers` of the event's company, one transaction per
 * item, so the freed or new stock goes to the item's backorders in order of confirmation and no
 * fill holds one item's balances while it waits for another item's orders. A repeat finds nothing
 * left to fill.
 */
export async function handleFillEvent(
  event: DeliveredEvent,
  ctx: EventHandlerContext,
): Promise<FillBackordersDto | undefined> {
  const items = freedItemsOf(event);
  if (items.length === 0) return undefined;
  let filled = 0;
  for (const itemId of items) {
    const out = await executeCommand(
      ctx.principal,
      { entityIds: [event.entityId], requestId: ctx.requestId },
      fillBackorders,
      { entityId: event.entityId, itemId },
    );
    filled += out.filled;
  }
  return { entityId: event.entityId, filled };
}
