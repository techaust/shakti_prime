// U2's journey fixtures (`e2e/purchase-orders.spec.ts`), written by the seed on the host as the
// table owner, after the vendors and the stock journeys: a pump tracked by serial that the
// journeys' cables vendor supplies, with its GST rate; per project, a purchase order of company 1
// for two pumps, approved and sent by the Executive, for the Inventory Manager to receive; and, in
// the snapshot company, one approved order with fixed ids and dates for the order sheet's
// screenshots. Every rate here is a test value for the journeys alone, never a client figure.
import { asMigrator } from '@shakti/db/testing';
import { PROJECTS, PURCHASE_ORDER_JOURNEY, SNAPSHOT_COMPANY, STOCK_JOURNEY } from '../support/users';
import { PROCUREMENT_IDS } from './procurement';
import { QUOTE_JOURNEY_IDS } from './quotes';

const id = (n: number) => `0199e2e0-0000-7000-8000-00000000f${n.toString(16).padStart(3, '0')}`;

export const PURCHASE_ORDER_IDS = {
  pump: id(0x001),
  pumpRate: id(0x002),
  pumpVendor: id(0x003),
  snapshotOrder: id(0x010),
  snapshotLine: id(0x011),
  orders: { 'desktop-light': id(0x020), 'desktop-dark': id(0x021), phone: id(0x022) },
  lines: { 'desktop-light': id(0x030), 'desktop-dark': id(0x031), phone: id(0x032) },
} as const;

/** The day the fixtures are stamped with, so no screenshot shows the day the seed ran. */
const SEEDED_AT = '2026-04-01T10:00:00+05:30';

export async function ensurePurchaseOrderJourneys(executiveId: string): Promise<void> {
  const ids = PURCHASE_ORDER_IDS;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, serial_pattern)
        values (${ids.pump}, ${PURCHASE_ORDER_JOURNEY.pump.sku}, ${PURCHASE_ORDER_JOURNEY.pump.name},
                'pump', '8413', 'nos', true, ${PURCHASE_ORDER_JOURNEY.pump.pattern})
        on conflict (id) do nothing`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
        values (${ids.pumpRate}, ${ids.pump}, 12.00, '2026-04-01', 'journeys')
        on conflict (id) do nothing`;
      await tx`insert into item_vendors (id, item_id, vendor_id, is_preferred, created_by, created_at, updated_at)
        values (${ids.pumpVendor}, ${ids.pump}, ${PROCUREMENT_IDS.cables}, true, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;

      const [hub] = await tx<{ id: string }[]>`
        select id from warehouses where code = ${STOCK_JOURNEY.hub.code}`;
      const [snapHub] = await tx<{ id: string }[]>`
        select id from warehouses where code = ${STOCK_JOURNEY.snapshot.hub.code}`;
      if (hub === undefined || snapHub === undefined) {
        throw new Error('the stock journeys make the hubs first');
      }

      // Per project: two pumps ordered in company 1, approved and sent, waiting to be received.
      for (const project of PROJECTS) {
        const order = ids.orders[project];
        await tx`insert into purchase_orders (id, entity_id, po_no, vendor_id, deliver_to_warehouse_id,
                   state, source, drafted_by, approved_by, approved_at, sent_at, sent_via,
                   vendor_state_code, place_of_supply_state_code, created_by, created_at, updated_at)
          values (${order}, ${STOCK_JOURNEY.entityId}, ${PURCHASE_ORDER_JOURNEY.receiveNo[project]},
                  ${PROCUREMENT_IDS.cables}, ${hub.id}, 'sent', 'manual', ${executiveId},
                  ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}, 'by_hand', '08', '08', ${executiveId},
                  ${SEEDED_AT}, ${SEEDED_AT})
          on conflict (id) do nothing`;
        await tx`insert into po_lines (id, po_id, entity_id, line_no, item_id, qty, purchase_unit,
                   unit_factor, hsn, tax_rate_id, tax_rate_pct, created_by, created_at, updated_at)
          values (${ids.lines[project]}, ${order}, ${STOCK_JOURNEY.entityId}, 1, ${ids.pump}, 2, 'nos',
                  1, '8413', ${ids.pumpRate}, 12.00, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
          on conflict (id) do nothing`;
        await tx`insert into po_line_rates (po_line_id, entity_id, unit_rate, amount, created_by)
          values (${ids.lines[project]}, ${STOCK_JOURNEY.entityId}, 15000, 30000.00, ${executiveId})
          on conflict (po_line_id) do nothing`;
      }

      // The snapshot company: one approved order of 300 metres of cable, never changed by a journey.
      await tx`insert into purchase_orders (id, entity_id, po_no, vendor_id, deliver_to_warehouse_id,
                 state, source, expected_at, drafted_by, approved_by, approved_at,
                 vendor_state_code, place_of_supply_state_code, created_by, created_at, updated_at)
        values (${ids.snapshotOrder}, ${SNAPSHOT_COMPANY.entityId}, ${PURCHASE_ORDER_JOURNEY.snapshotNo},
                ${PROCUREMENT_IDS.cables}, ${snapHub.id}, 'approved', 'manual', '2026-04-15',
                ${executiveId}, ${executiveId}, ${SEEDED_AT}, '08', '08', ${executiveId},
                ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      await tx`insert into po_lines (id, po_id, entity_id, line_no, item_id, qty, purchase_unit,
                 unit_factor, hsn, tax_rate_id, tax_rate_pct, created_by, created_at, updated_at)
        values (${ids.snapshotLine}, ${ids.snapshotOrder}, ${SNAPSHOT_COMPANY.entityId}, 1,
                ${QUOTE_JOURNEY_IDS.cable}, 300, 'metre', 1, '8544', ${QUOTE_JOURNEY_IDS.cableRate},
                18.00, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      await tx`insert into po_line_rates (po_line_id, entity_id, unit_rate, amount, created_by)
        values (${ids.snapshotLine}, ${SNAPSHOT_COMPANY.entityId}, 70.25, 21075.00, ${executiveId})
        on conflict (po_line_id) do nothing`;
    }),
  );
}
