// H3's stock count journeys (`e2e/stock-counts.spec.ts`), written by the seed on the host as the
// table owner: per project a godown with two storage bins, a cable counted in metres and a pump
// tracked by serial, put back each run to the same stock through the ledger's own definer, and
// any count a run before left live cancelled, so every run counts the same shelves. Every
// quantity here is a test value for these journeys alone.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { PROJECTS, STOCK_COUNT_JOURNEY } from '../support/users';

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

async function ensureItem(
  m: Sql,
  item: { sku: string; name: string; tracked: boolean },
): Promise<string> {
  const [found] = await m<{ id: string }[]>`select id from items where sku = ${item.sku}`;
  if (found) return found.id;
  const id = newId();
  await m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked)
          values (${id}, ${item.sku}, ${item.name}, ${item.tracked ? 'pump' : 'cable'},
                  ${item.tracked ? '8413' : '8544'}, ${item.tracked ? 'nos' : 'metre'}, ${item.tracked})`;
  return id;
}

/** Posts movements through the ledger's definer, as an Executive adjusting stock would. */
async function move(m: Sql, executiveId: string, lines: Record<string, unknown>[]): Promise<void> {
  if (lines.length === 0) return;
  await m.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${executiveId}, true),
                    set_config('app.entity_ids', ${`{${String(STOCK_COUNT_JOURNEY.entityId)}}`}, true),
                    set_config('app.permissions', 'inventory.stock.adjust:entity,inventory.stock.move:entity', true)`;
    await tx`select app.stock_move(${tx.json(lines)})`;
  });
}

/** Makes the count journeys' shelves, and puts them back as each run starts. */
export async function ensureStockCountJourneys(executiveId: string): Promise<void> {
  const entityId = STOCK_COUNT_JOURNEY.entityId;
  await asMigrator(async (m) => {
    for (const project of PROJECTS) {
      const spec = STOCK_COUNT_JOURNEY.projects[project];
      const hub = await ensureHub(m, spec.hub.code, spec.hub.name, executiveId);
      const [first = '', second = ''] = await Promise.all(
        STOCK_COUNT_JOURNEY.bins.map((code) => ensureBin(m, hub, code, executiveId)),
      );
      const cable = await ensureItem(m, { ...spec.cable, tracked: false });
      const pump = await ensureItem(m, { ...spec.pump, tracked: true });

      // A count a run before left live is cancelled, so this run starts its own. The guard asks
      // for a person's grant, which the table owner is not.
      await m.begin(async (tx) => {
        await tx`alter table stock_counts disable trigger stock_counts_guard`;
        await tx`update stock_counts
                    set state = 'cancelled', state_changed_at = now(), cancelled_at = now(),
                        cancelled_by = ${executiveId}, cancel_reason = 'Journey run ended'
                  where entity_id = ${entityId} and warehouse_id = ${hub}
                    and state in ('open', 'counting', 'review')`;
        await tx`alter table stock_counts enable trigger stock_counts_guard`;
      });

      // The cable: the starting metres in each bin, by a gain or a loss of the difference.
      const lines: Record<string, unknown>[] = [];
      for (const [binId, target] of [
        [first, STOCK_COUNT_JOURNEY.cableQty[0]],
        [second, STOCK_COUNT_JOURNEY.cableQty[1]],
      ] as const) {
        const [held] = await m<{ q: string }[]>`
          select coalesce(sum(qty_on_hand), 0)::text as q from stock_balances
           where entity_id = ${entityId} and item_id = ${cable} and bin_id = ${binId}`;
        const diff = target - Number(held?.q ?? '0');
        if (diff > 0) {
          lines.push({
            reason: 'adjust_gain',
            entity_id: entityId,
            item_id: cable,
            to_bin_id: binId,
            qty: String(diff),
            unit_cost: '25.0000',
            note: 'Journey count stock',
          });
        } else if (diff < 0) {
          lines.push({
            reason: 'adjust_loss',
            entity_id: entityId,
            item_id: cable,
            from_bin_id: binId,
            qty: String(-diff),
            note: 'Journey count stock',
          });
        }
      }
      // The pump's serials, each back in the first bin: made, brought back, or moved home.
      for (const serialNo of spec.serials) {
        const [serial] = await m<{ id: string; state: string; binId: string | null }[]>`
          select id, state, bin_id as "binId" from serials
           where item_id = ${pump} and lower(serial_no) = lower(${serialNo})`;
        if (serial === undefined || serial.state === 'scrapped') {
          lines.push({
            reason: 'adjust_gain',
            entity_id: entityId,
            item_id: pump,
            serial_no: serialNo,
            to_bin_id: first,
            qty: '1',
            unit_cost: '9000.0000',
            note: 'Journey count stock',
          });
        } else if (serial.state === 'in_stock' && serial.binId !== first && serial.binId !== null) {
          lines.push({
            reason: 'transfer',
            entity_id: entityId,
            item_id: pump,
            serial_id: serial.id,
            from_bin_id: serial.binId,
            to_bin_id: first,
            qty: '1',
          });
        }
      }
      await move(m, executiveId, lines);
    }
  });
}
