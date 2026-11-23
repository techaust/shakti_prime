// Hubs, bins and items for the stock ledger's tests (H1), written with the migrator connection.
// Every code carries the run's tag, since the suites never clean the shared tables. Values are
// test data, never copy.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';

export interface StockFixture {
  tag: string;
  /** A godown with its receiving and dispatch bins and two storage bins. */
  hub: string;
  receiving: string;
  dispatch: string;
  binA: string;
  binB: string;
  /** A second godown with one storage bin, and the transit hub's bin pairing the two. */
  otherHub: string;
  otherBin: string;
  transitHub: string;
  transitBin: string;
  /** A bin archived after it was made. */
  archivedBin: string;
  /** Items: counted in metres, tracked by serial, inactive, archived. */
  cable: string;
  pump: string;
  inactive: string;
  archived: string;
}

/** A fresh set of hubs, bins and items for one test file. */
export async function stockFixture(createdBy: string): Promise<StockFixture> {
  const tag = newId().slice(-8).toUpperCase();
  const f: StockFixture = {
    tag,
    hub: newId(),
    receiving: newId(),
    dispatch: newId(),
    binA: newId(),
    binB: newId(),
    otherHub: newId(),
    otherBin: newId(),
    transitHub: newId(),
    transitBin: newId(),
    archivedBin: newId(),
    cable: newId(),
    pump: newId(),
    inactive: newId(),
    archived: newId(),
  };
  const [pairA, pairB] = [f.hub, f.otherHub].sort();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by) values
        (${f.hub}, ${`H${tag}`}, ${`Hub ${tag}`}, 'godown', '08', '302001', ${createdBy}),
        (${f.otherHub}, ${`O${tag}`}, ${`Other hub ${tag}`}, 'factory', '08', '302002', ${createdBy})`;
      await tx`insert into warehouses (id, code, name, kind, created_by)
        values (${f.transitHub}, ${`T${tag}`}, ${`Transit ${tag}`}, 'transit', ${createdBy})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
        (${f.receiving}, ${f.hub}, 'RECEIVING', 'receiving', ${createdBy}),
        (${f.dispatch}, ${f.hub}, 'DISPATCH', 'dispatch', ${createdBy}),
        (${f.binA}, ${f.hub}, 'A1', 'storage', ${createdBy}),
        (${f.binB}, ${f.hub}, 'B1', 'storage', ${createdBy}),
        (${f.archivedBin}, ${f.hub}, 'Z9', 'storage', ${createdBy}),
        (${f.otherBin}, ${f.otherHub}, 'A1', 'storage', ${createdBy})`;
      await tx`insert into bins (id, warehouse_id, code, kind, pair_a_warehouse_id, pair_b_warehouse_id, created_by)
        values (${f.transitBin}, ${f.transitHub}, ${`P${tag}`}, 'transit', ${pairA ?? ''}, ${pairB ?? ''}, ${createdBy})`;
      await tx`update bins set archived_at = now() where id = ${f.archivedBin}`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active, archived_at) values
        (${f.cable}, ${`SC-${tag}`}, ${`Stock cable ${tag}`}, 'cable', '8544', 'metre', false, true, null),
        (${f.pump}, ${`SP-${tag}`}, ${`Stock pump ${tag}`}, 'pump', '8413', 'nos', true, true, null),
        (${f.inactive}, ${`SI-${tag}`}, ${`Stock inactive ${tag}`}, 'pipe', '3917', 'metre', false, false, null),
        (${f.archived}, ${`SA-${tag}`}, ${`Stock archived ${tag}`}, 'pipe', '3917', 'metre', false, true, now())`;
    }),
  );
  return f;
}

/** A company's on-hand quantity of an item in a bin, as the table owner reads it. */
export async function onHand(entityId: number, binId: string, itemId: string): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ q: string }[]>`
      select coalesce((select qty_on_hand::text from stock_balances
                        where entity_id = ${entityId} and bin_id = ${binId} and item_id = ${itemId}), '0') as q`,
  );
  return row?.q ?? '0';
}

/** A company's moving average of an item, as the table owner reads it. */
export async function averageOf(
  entityId: number,
  itemId: string,
): Promise<{ avg: string | null; last: string | null }> {
  const [row] = await asMigrator(
    (m) => m<{ avg: string | null; last: string | null }[]>`
      select moving_avg_cost::text as avg, last_positive_avg_cost::text as last
        from item_costs where entity_id = ${entityId} and item_id = ${itemId}`,
  );
  return row ?? { avg: null, last: null };
}

/** The unit cost recorded beside a movement. */
export async function costOf(movementId: string): Promise<string | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ c: string }[]>`
      select unit_cost::text as c from stock_movement_costs where movement_id = ${movementId}`,
  );
  return row?.c;
}

/** A serial's state and bin, by its number. */
export async function serialOf(
  itemId: string,
  serialNo: string,
): Promise<{ id: string; state: string; binId: string | null } | undefined> {
  const [row] = await asMigrator(
    (m) => m<{ id: string; state: string; binId: string | null }[]>`
      select id, state, bin_id as "binId" from serials
       where item_id = ${itemId} and lower(serial_no) = lower(${serialNo})`,
  );
  return row;
}
