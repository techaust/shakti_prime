// H2's reservation journey fixtures (`e2e/reservations.spec.ts`), written by the seed on the host.
// Per project: an item of company 1 kept at least `freeQty` free in the stock journeys' first bin
// (topped up through the ledger's own definer), and three orders of it for a farm customer of the
// Lead Converter's, made afresh each run: one left a draft for the General Manager to confirm,
// one confirmed here through `sales.order.confirm` so its hold is on the item's stock card, and
// one left a draft for the Lead Converter to read. Every quantity is a test value for these
// journeys alone; the prices are zero.
import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { confirmSalesOrder, executeCommand } from '@shakti/domain';
import {
  PROJECTS,
  RESERVATION_JOURNEY,
  STOCK_JOURNEY,
  type ProjectName,
  type ReservationJourneySeed,
} from '../support/users';

type Sql = Parameters<Parameters<typeof asMigrator>[0]>[0];

const E = RESERVATION_JOURNEY.entityId;

async function ensureItem(m: Sql, sku: string, name: string): Promise<string> {
  const [item] = await m<{ id: string }[]>`select id from items where sku = ${sku}`;
  if (item) return item.id;
  const id = newId();
  await m`insert into items (id, sku, name, category, hsn, unit)
          values (${id}, ${sku}, ${name}, 'pump', '8413', 'nos')`;
  return id;
}

/** The item's tax rate the orders' lines name, made once. */
async function ensureRate(m: Sql, itemId: string): Promise<string> {
  const [rate] = await m<{ id: string }[]>`
    select id from tax_rates where item_id = ${itemId} and source_ref = 'reservation journey'`;
  if (rate) return rate.id;
  const id = newId();
  await m`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
          values (${id}, ${itemId}, 12.00, '2026-04-01', 'reservation journey')`;
  return id;
}

/** The farm customer of company 1, the Lead Converter's, with a site at the journeys' PIN code. */
async function ensureCustomer(
  m: Sql,
  converterId: string,
): Promise<{ accountId: string; siteId: string }> {
  const [found] = await m<{ accountId: string; siteId: string }[]>`
    select a.id as "accountId", s.id as "siteId"
      from accounts a join customer_sites s on s.account_id = a.id
     where a.name = ${RESERVATION_JOURNEY.customer} and a.archived_at is null
     limit 1`;
  if (found) return found;
  const accountId = newId();
  const siteId = newId();
  await m.begin(async (tx) => {
    await tx`insert into accounts (id, type, name, created_by)
             values (${accountId}, 'farm', ${RESERVATION_JOURNEY.customer}, ${converterId})`;
    await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
             values (${newId()}, ${accountId}, ${E}, ${converterId}, ${converterId})`;
    await tx`insert into customer_sites (id, account_id, type, pin, created_by)
             values (${siteId}, ${accountId}, 'borewell', ${RESERVATION_JOURNEY.sitePin}, ${converterId})`;
  });
  return { accountId, siteId };
}

/** Free stock of the item in the bin topped up to the journeys' quantity, as an Executive adds it. */
async function topUp(m: Sql, executiveId: string, itemId: string, binId: string): Promise<void> {
  const [held] = await m<{ free: string }[]>`
    select coalesce(sum(qty_on_hand - qty_reserved), 0)::text as free from stock_balances
     where entity_id = ${E} and item_id = ${itemId} and bin_id = ${binId}`;
  const short = RESERVATION_JOURNEY.freeQty - Number(held?.free ?? '0');
  if (short <= 0) return;
  await m.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${executiveId}, true),
                    set_config('app.entity_ids', ${`{${String(E)}}`}, true),
                    set_config('app.permissions', 'inventory.stock.adjust:entity', true)`;
    await tx`select app.stock_move(${tx.json([
      {
        reason: 'adjust_gain',
        entity_id: E,
        item_id: itemId,
        to_bin_id: binId,
        qty: String(short),
        unit_cost: '100.0000',
        note: 'Journey stock for orders',
      },
    ])})`;
  });
}

/** A draft order of one line of the item, made by the Lead Converter, at zero prices. */
async function draftOrder(
  m: Sql,
  facts: {
    project: ProjectName;
    mark: string;
    converterId: string;
    accountId: string;
    siteId: string;
    tierId: string;
    itemId: string;
    rateId: string;
  },
): Promise<{ orderId: string; soNo: string }> {
  const orderId = newId();
  const soNo = `JRN-RSV/${facts.project}/${String(Date.now())}${facts.mark}`;
  const sku = RESERVATION_JOURNEY.items[facts.project].sku;
  const name = RESERVATION_JOURNEY.items[facts.project].name;
  await m.begin(async (tx) => {
    await tx`insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, site_id,
               tier_id, place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst, tax_total,
               round_off, grand_total, created_by)
             values (${orderId}, ${E}, ${soNo}, '2026-27', ${facts.accountId}, 'farm', ${facts.siteId},
                     ${facts.tierId}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${facts.converterId})`;
    await tx`insert into sales_order_lines (id, entity_id, sales_order_id, position, item_id, sku,
               description, unit, qty, unit_price, hsn, tax_rate_id, tax_rate_pct, taxable_value, cgst,
               sgst, igst, line_total)
             values (${newId()}, ${E}, ${orderId}, 1, ${facts.itemId}, ${sku}, ${name}, 'nos',
                     ${RESERVATION_JOURNEY.orderQty}, 0, '8413', ${facts.rateId}, 12.00, 0, 0, 0, 0, 0)`;
  });
  return { orderId, soNo };
}

/** Makes the reservation fixtures and answers what the journeys need of them. */
export async function ensureReservationJourneys(
  executiveId: string,
  converterId: string,
): Promise<ReservationJourneySeed> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  const seed: ReservationJourneySeed = {
    items: {} as ReservationJourneySeed['items'],
    confirmOrders: {} as ReservationJourneySeed['confirmOrders'],
    heldOrders: {} as ReservationJourneySeed['heldOrders'],
    viewOrders: {} as ReservationJourneySeed['viewOrders'],
  };
  const held: string[] = [];
  await asMigrator(async (m) => {
    const [hub] = await m<{ id: string }[]>`
      select id from warehouses where code = ${STOCK_JOURNEY.hub.code}`;
    const [bin] = await m<{ id: string }[]>`
      select id from bins where warehouse_id = ${hub?.id ?? ''} and code = ${STOCK_JOURNEY.bins[0]}`;
    const [tier] = await m<{ id: string }[]>`select id from price_tiers order by code limit 1`;
    if (!bin || !tier) throw new Error('the stock journeys and a price tier come first');
    const { accountId, siteId } = await ensureCustomer(m, converterId);
    for (const project of PROJECTS) {
      const spec = RESERVATION_JOURNEY.items[project];
      const itemId = await ensureItem(m, spec.sku, spec.name);
      const rateId = await ensureRate(m, itemId);
      await topUp(m, executiveId, itemId, bin.id);
      const facts = { project, converterId, accountId, siteId, tierId: tier.id, itemId, rateId };
      seed.items[project] = itemId;
      seed.confirmOrders[project] = (await draftOrder(m, { ...facts, mark: 'C' })).orderId;
      seed.heldOrders[project] = await draftOrder(m, { ...facts, mark: 'H' });
      seed.viewOrders[project] = (await draftOrder(m, { ...facts, mark: 'V' })).orderId;
      held.push(seed.heldOrders[project].orderId);
    }
  });
  // Confirmed as a person would, so the hold is made by the reservation definers themselves.
  for (const orderId of held) {
    await executeCommand(executive, { entityIds: [E] }, confirmSalesOrder, {
      entityId: E,
      orderId,
    });
  }
  // The confirmations took some of each item's stock: topped up again for the journeys' drafts.
  await asMigrator(async (m) => {
    const [bin] = await m<{ id: string }[]>`
      select b.id from bins b join warehouses w on w.id = b.warehouse_id
       where w.code = ${STOCK_JOURNEY.hub.code} and b.code = ${STOCK_JOURNEY.bins[0]}`;
    for (const project of PROJECTS) await topUp(m, executiveId, seed.items[project], bin?.id ?? '');
  });
  return seed;
}
