// Orders, items and a kit for the reservation tests (H2), written with the migrator connection
// beside H1's stock fixture. Every code carries the run's tag, since the suites never clean the
// shared tables. Values are test data, never copy or client figures.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';

export interface ReservationFixture {
  tag: string;
  entityId: number;
  /** A farm customer of the company, owned by `ownerId`, with a site at `sitePin`. */
  account: string;
  site: string;
  sitePin: string;
  /** Two untracked items, a kit of 2 × `panel` and 1 × `inverter`, and a service kept out of stock. */
  panel: string;
  inverter: string;
  kit: string;
  service: string;
  taxRate: string;
  tierId: string;
}

/** A customer, items, a kit and a tax rate for one test file, in company `entityId`. */
export async function reservationFixture(
  entityId: number,
  ownerId: string,
  sitePin: string,
): Promise<ReservationFixture> {
  const tag = newId().slice(-8).toUpperCase();
  const f: ReservationFixture = {
    tag,
    entityId,
    account: newId(),
    site: newId(),
    sitePin,
    panel: newId(),
    inverter: newId(),
    kit: newId(),
    service: newId(),
    taxRate: newId(),
    tierId: '',
  };
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const [tier] = await tx<{ id: string }[]>`select id from price_tiers order by code limit 1`;
      if (!tier) throw new Error('no price tier is seeded');
      f.tierId = tier.id;
      await tx`insert into accounts (id, type, name, created_by)
        values (${f.account}, 'farm', ${`Reservation farm ${tag}`}, ${ownerId})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
        values (${newId()}, ${f.account}, ${entityId}, ${ownerId}, ${ownerId})`;
      await tx`insert into customer_sites (id, account_id, type, pin, created_by)
        values (${f.site}, ${f.account}, 'borewell', ${sitePin}, ${ownerId})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active, is_stocked) values
        (${f.panel}, ${`RP-${tag}`}, ${`Reservation panel ${tag}`}, 'solar_module', '8541', 'nos', false, true, true),
        (${f.inverter}, ${`RI-${tag}`}, ${`Reservation inverter ${tag}`}, 'inverter', '8504', 'nos', false, true, true),
        (${f.service}, ${`RS-${tag}`}, ${`Reservation service ${tag}`}, 'other', '9987', 'nos', false, true, false)`;
      await tx`insert into kits (id, sku, name) values (${f.kit}, ${`RK-${tag}`}, ${`Reservation kit ${tag}`})`;
      await tx`insert into kit_components (id, kit_id, item_id, qty) values
        (${newId()}, ${f.kit}, ${f.panel}, 2),
        (${newId()}, ${f.kit}, ${f.inverter}, 1)`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        values (${f.taxRate}, ${f.panel}, 12.00, '2026-04-01', 'reservation test')`;
    }),
  );
  return f;
}

export interface OrderLineSpec {
  itemId?: string;
  kitId?: string;
  qty: string;
}

let orderSeq = 0;

/**
 * A draft order of the fixture's customer (no quote, as a dealer's order is made), at zero prices,
 * made by `createdBy`; confirmed through `sales.order.confirm` by the test.
 */
export async function draftOrder(
  f: ReservationFixture,
  createdBy: string,
  lines: readonly OrderLineSpec[],
): Promise<{ orderId: string; lineIds: string[] }> {
  const orderId = newId();
  const lineIds = lines.map(() => newId());
  orderSeq += 1;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, site_id, tier_id,
                 place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total, round_off,
                 grand_total, created_by)
        values (${orderId}, ${f.entityId}, ${`R${f.tag}/${String(orderSeq)}`}, '2098-99', ${f.account}, 'farm',
                ${f.site}, ${f.tierId}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${createdBy})`;
      for (const [i, line] of lines.entries()) {
        await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, kit_id, sku,
                   description, unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst,
                   sgst, igst, line_total)
          values (${lineIds[i] ?? ''}, ${f.entityId}, ${orderId}, ${i + 1}, ${line.itemId ?? null},
                  ${line.kitId ?? null}, ${`RL-${f.tag}`}, 'reservation test line', 'nos', ${line.qty}, 0,
                  '8541', ${f.taxRate}, 12.00, 0, 0, 0, 0, 0)`;
      }
    }),
  );
  return { orderId, lineIds };
}

/** What the table owner reads of a bin's balance of an item. */
export async function balanceOf(
  entityId: number,
  binId: string,
  itemId: string,
): Promise<{ onHand: string; reserved: string }> {
  const [row] = await asMigrator(
    (m) => m<{ onHand: string; reserved: string }[]>`
      select coalesce(max(qty_on_hand), 0)::numeric(12, 3)::text as "onHand",
             coalesce(max(qty_reserved), 0)::numeric(12, 3)::text as "reserved"
        from stock_balances
       where entity_id = ${entityId} and bin_id = ${binId} and item_id = ${itemId}`,
  );
  return row ?? { onHand: '0.000', reserved: '0.000' };
}

export interface ReservationRow {
  id: string;
  lineId: string;
  itemId: string;
  hubId: string;
  binId: string;
  qty: string;
  state: string;
  releaseKind: string | null;
  expiresAt: Date;
}

/** An order's reservations, as the table owner reads them, oldest first. */
export async function reservationsOf(orderId: string): Promise<ReservationRow[]> {
  return asMigrator(
    (m) => m<ReservationRow[]>`
      select id, sales_order_line_id as "lineId", item_id as "itemId", warehouse_id as "hubId",
             bin_id as "binId", qty::text as qty, state, release_kind as "releaseKind",
             expires_at as "expiresAt"
        from reservations where sales_order_id = ${orderId} order by created_at, id`,
  );
}

/** Each line's backorder, by position. */
export async function backordersOf(orderId: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) => m<{ q: string }[]>`
      select qty_backordered::text as q from sales_order_lines
       where sales_order_id = ${orderId} order by position`,
  );
  return rows.map((r) => r.q);
}
