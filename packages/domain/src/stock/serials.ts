import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

/**
 * Every serial number of an item, whichever company holds it (H1), for C5's check that a serial
 * pattern compiles against the item's existing serials. Read through `app.item_serial_nos()`,
 * which answers only a holder of `catalogue.write` in a request covering every company (the
 * request a catalogue change runs in), so the check never passes for want of rows it cannot see.
 */
export async function existingSerialsOf(tx: RequestTx, itemId: string): Promise<string[]> {
  const rows = (await tx.execute(
    sql`select s as "serialNo" from app.item_serial_nos(${itemId}) s`,
  )) as unknown as { serialNo: string }[];
  return rows.map((r) => r.serialNo);
}
