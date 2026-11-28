// Q1's labels journey fixtures (`e2e/labels.spec.ts`), written by the seed on the host as the
// table owner: per project, a serial-tracked item of company 1 with one serial in the stock
// journey's first bin, put there through the ledger's own definer and found again by its number.
// Test values for these journeys alone.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { LABEL_JOURNEY, PROJECTS, STOCK_JOURNEY } from '../support/users';

/** Makes the labels journey's serials; the stock journeys' hub and bins come first. */
export async function ensureLabelJourneys(executiveId: string): Promise<void> {
  await asMigrator(async (m) => {
    const [bin] = await m<{ id: string }[]>`
      select b.id from bins b join warehouses w on w.id = b.warehouse_id
       where w.code = ${STOCK_JOURNEY.hub.code} and b.code = ${STOCK_JOURNEY.bins[0]}`;
    if (bin === undefined) throw new Error('the stock journeys’ bin is missing');
    for (const project of PROJECTS) {
      const spec = LABEL_JOURNEY.items[project];
      const [item] = await m<{ id: string }[]>`select id from items where sku = ${spec.sku}`;
      const itemId = item?.id ?? newId();
      if (item === undefined) {
        await m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked)
                values (${itemId}, ${spec.sku}, ${spec.name}, 'pump', '8413', 'nos', true)`;
      }
      const [serial] = await m<{ id: string }[]>`
        select id from serials where item_id = ${itemId} and serial_no = ${spec.serialNo}`;
      if (serial !== undefined) continue;
      await m.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${executiveId}, true),
                        set_config('app.entity_ids', ${`{${String(STOCK_JOURNEY.entityId)}}`}, true),
                        set_config('app.permissions', 'inventory.stock.adjust:entity', true)`;
        await tx`select app.stock_move(${tx.json([
          {
            reason: 'adjust_gain',
            entity_id: STOCK_JOURNEY.entityId,
            item_id: itemId,
            serial_no: spec.serialNo,
            to_bin_id: bin.id,
            qty: '1',
            unit_cost: '1000.0000',
            note: 'Journey serial for labels',
          },
        ])})`;
      });
    }
  });
}
