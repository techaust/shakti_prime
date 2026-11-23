// H1's stock journey fixtures (`e2e/inventory.spec.ts`), written by the seed on the host as the
// table owner: hubs, bins and items made once and found again by code; per project, the item's
// stock in company 1 topped up to its starting quantity through the ledger's own definer; and the
// snapshot company's two items' stock and costs, made once. Every quantity and cost here is a
// test value for these journeys alone.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { PROJECTS, SNAPSHOT_COMPANY, STOCK_JOURNEY } from '../support/users';

type Sql = Parameters<Parameters<typeof asMigrator>[0]>[0];

async function ensureHub(m: Sql, code: string, name: string, by: string): Promise<string> {
  const [hub] = await m<{ id: string }[]>`select id from warehouses where code = ${code}`;
  if (hub) return hub.id;
  const id = newId();
  await m`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
          values (${id}, ${code}, ${name}, 'godown', '08', '302022', ${by})`;
  await m`insert into bins (id, warehouse_id, code, kind, created_by) values
          (${newId()}, ${id}, 'RECEIVING', 'receiving', ${by}),
          (${newId()}, ${id}, 'DISPATCH', 'dispatch', ${by})`;
  return id;
}

async function ensureBin(m: Sql, hubId: string, code: string, by: string): Promise<string> {
  const [bin] = await m<{ id: string }[]>`
    select id from bins where warehouse_id = ${hubId} and code = ${code}`;
  if (bin) return bin.id;
  const id = newId();
  await m`insert into bins (id, warehouse_id, code, kind, created_by)
          values (${id}, ${hubId}, ${code}, 'storage', ${by})`;
  return id;
}

async function ensureItem(m: Sql, sku: string, name: string, category: string): Promise<string> {
  const [item] = await m<{ id: string }[]>`select id from items where sku = ${sku}`;
  if (item) return item.id;
  const id = newId();
  await m`insert into items (id, sku, name, category, hsn, unit)
          values (${id}, ${sku}, ${name}, ${category}, '8544', 'metre')`;
  return id;
}

/** Makes the stock fixtures. */
export async function ensureStockJourneys(executiveId: string): Promise<void> {
  await asMigrator(async (m) => {
    const hub = await ensureHub(m, STOCK_JOURNEY.hub.code, STOCK_JOURNEY.hub.name, executiveId);
    const [from] = await Promise.all(
      STOCK_JOURNEY.bins.map((code) => ensureBin(m, hub, code, executiveId)),
    );
    for (const project of PROJECTS) {
      const spec = STOCK_JOURNEY.items[project];
      const itemId = await ensureItem(m, spec.sku, spec.name, 'cable');
      // Topped up to the starting quantity through the ledger, as an Executive would adjust it.
      const [held] = await m<{ q: string }[]>`
        select coalesce(sum(qty_on_hand), 0)::text as q from stock_balances
         where entity_id = ${STOCK_JOURNEY.entityId} and item_id = ${itemId} and bin_id = ${from ?? ''}`;
      const short = STOCK_JOURNEY.startingQty - Number(held?.q ?? '0');
      if (short > 0) {
        await m.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${executiveId}, true),
                          set_config('app.entity_ids', ${`{${String(STOCK_JOURNEY.entityId)}}`}, true),
                          set_config('app.permissions', 'inventory.stock.adjust:entity', true)`;
          await tx`select app.stock_move(${JSON.stringify([
            {
              reason: 'adjust_gain',
              entity_id: STOCK_JOURNEY.entityId,
              item_id: itemId,
              to_bin_id: from,
              qty: String(short),
              unit_cost: '25.0000',
              note: 'Journey starting stock',
            },
          ])}::jsonb)`;
        });
      }
    }

    // The snapshot company's stock: made once, so its list and valuation never change.
    const snap = STOCK_JOURNEY.snapshot;
    const snapHub = await ensureHub(m, snap.hub.code, snap.hub.name, executiveId);
    const snapBin = await ensureBin(m, snapHub, snap.bin, executiveId);
    for (const item of snap.items) {
      const itemId = await ensureItem(m, item.sku, item.name, item.category);
      const [held] = await m<{ n: number }[]>`
        select count(*)::int as n from stock_movements
         where entity_id = ${SNAPSHOT_COMPANY.entityId} and item_id = ${itemId}`;
      if ((held?.n ?? 0) > 0) continue;
      await m.begin(async (tx) => {
        await tx`select set_config('app.user_id', ${executiveId}, true),
                        set_config('app.entity_ids', ${`{${String(SNAPSHOT_COMPANY.entityId)}}`}, true),
                        set_config('app.permissions', 'inventory.stock.adjust:entity', true)`;
        await tx`select app.stock_move(${JSON.stringify([
          {
            reason: 'adjust_gain',
            entity_id: SNAPSHOT_COMPANY.entityId,
            item_id: itemId,
            to_bin_id: snapBin,
            qty: String(item.qty),
            unit_cost: item.cost,
            note: 'Snapshot stock',
          },
        ])}::jsonb)`;
      });
    }
  });
}
