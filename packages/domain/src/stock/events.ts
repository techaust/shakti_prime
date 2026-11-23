import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

/** At most this many movements ride in one `inventory.stock.moved` event; `count` says how many. */
const EVENT_MOVEMENTS = 200;

interface MovedRow {
  movementId: string;
  itemId: string;
  fromBinId: string | null;
  toBinId: string | null;
  qty: string;
  reason: string;
}

/**
 * The payload of `inventory.stock.moved` for a posted batch: its movements as the ledger holds
 * them (ids, items, bins, quantities, reasons), never a cost.
 */
export async function stockMovedPayload(
  tx: RequestTx,
  movementIds: readonly string[],
): Promise<{ count: number; movements: MovedRow[] }> {
  const ids = movementIds.slice(0, EVENT_MOVEMENTS);
  const rows = (await tx.execute(sql`
    select m.id as "movementId", m.item_id as "itemId", m.from_bin_id as "fromBinId",
           m.to_bin_id as "toBinId", m.qty::text as qty, m.reason
      from stock_movements m
      join unnest(${`{${ids.join(',')}}`}::uuid[]) with ordinality as x(id, n) on x.id = m.id
     order by x.n`)) as unknown as MovedRow[];
  return { count: movementIds.length, movements: rows };
}
