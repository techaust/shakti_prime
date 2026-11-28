import { newId, type LineAvailabilityDto, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { readLineAvailability } from '../../src/queries/inventory/availability';
import { seededGenerator, type SeededGenerator } from '../../src/seeded-generator';
import {
  documentAvailability,
  fromThousandths,
  itemAvailability,
  lineAvailability,
  toThousandths,
  type BalanceFacts,
  type DocumentLine,
  type KitComponent,
} from '../../src/stock/atp';
import { draftOrder, reservationFixture, type ReservationFixture } from './reservation-fixture';
import { stockFixture, type StockFixture } from './stock-fixture';

afterAll(async () => {
  // The items go out of the catalogue's lists once the file is done (the suites never clean the
  // shared tables, and other files read the first 200 active items).
  await asMigrator(
    (m) =>
      m`update items set archived_at = now() where id = any (${[...stocked, service]}::uuid[])`,
  );
  await closeDb();
});

/**
 * atp.ts is the specification of availability (docs/03-roadmap-appendix/phase3.md §7.1): on
 * generated balances, kits and lines, `app.free_availability()` answers each line the status and
 * the free quantity `documentAvailability()` does, over the free stock `itemAvailability()` counts
 * (storage bins in use of godowns and factories in use); and a confirmed order's lines answer
 * `app.line_availability()` the status `lineAvailability()` gives what each line holds.
 *
 * The items are this file's own; each case writes its balances afresh as the table owner, and its
 * kits, which it removes after.
 */

const E = 2;
const CASES = 60;
let s: StockFixture;
let f: ReservationFixture;
let lc: Principal;
let manager: Principal;
let archivedHub: string;
let archivedHubBin: string;
/** Every bin a balance may sit in, with what makes its stock free or not. */
let bins: { binId: string; facts: Omit<BalanceFacts, 'onHand' | 'reserved'> }[];
/** Four items kept in stock and one kept out of it (a service). */
let stocked: string[];
let service: string;

beforeAll(async () => {
  const exec = await createTestPrincipal('executive');
  lc = await createTestPrincipal('tele_caller_lc', [E]);
  manager = await createTestPrincipal('inventory_manager', [E]);
  s = await stockFixture(exec.id);
  f = await reservationFixture(E, lc.id, '302035');
  archivedHub = newId();
  archivedHubBin = newId();
  stocked = [newId(), newId(), newId(), newId()];
  service = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${archivedHub}, ${`X${f.tag}`}, ${`Closed hub ${f.tag}`}, 'godown', '08', '302003', ${exec.id})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by)
        values (${archivedHubBin}, ${archivedHub}, 'A1', 'storage', ${exec.id})`;
      await tx`update warehouses set archived_at = now() where id = ${archivedHub}`;
      for (const [i, id] of [...stocked, service].entries()) {
        await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active, is_stocked)
          values (${id}, ${`AP-${f.tag}-${String(i)}`}, ${`Parity item ${f.tag} ${String(i)}`},
                  ${id === service ? 'other' : 'pump'}, '8413', 'nos', false, true, ${id !== service})`;
      }
    }),
  );
  const storage = { hubKind: 'godown', binKind: 'storage', inUse: true };
  bins = [
    { binId: s.binA, facts: { hubId: s.hub, ...storage } },
    { binId: s.binB, facts: { hubId: s.hub, ...storage } },
    { binId: s.receiving, facts: { hubId: s.hub, ...storage, binKind: 'receiving' } },
    { binId: s.dispatch, facts: { hubId: s.hub, ...storage, binKind: 'dispatch' } },
    { binId: s.archivedBin, facts: { hubId: s.hub, ...storage, inUse: false } },
    { binId: s.otherBin, facts: { hubId: s.otherHub, ...storage, hubKind: 'factory' } },
    {
      binId: s.transitBin,
      facts: { hubId: s.transitHub, hubKind: 'transit', binKind: 'transit', inUse: true },
    },
    { binId: archivedHubBin, facts: { hubId: archivedHub, ...storage, inUse: false } },
  ];
});

/** A quantity of up to `max` units in thousandths, a whole number of units half the time. */
function quantity(r: SeededGenerator, max: number): number {
  return r.chance() ? r.int(0, max) * 1_000 : r.int(0, max * 1_000);
}

interface Case {
  balances: Map<string, BalanceFacts[]>;
  kits: Map<string, KitComponent[]>;
}

/** Each stocked item's balances, written afresh, and two kits of the case's items. */
async function writeCase(r: SeededGenerator): Promise<Case> {
  const balances = new Map<string, BalanceFacts[]>(stocked.map((id) => [id, []]));
  const rows: { binId: string; itemId: string; onHand: number; reserved: number }[] = [];
  for (const itemId of stocked) {
    const used = new Set<string>();
    for (let i = r.int(0, 4); i > 0; i -= 1) {
      const bin = r.pick(bins);
      if (used.has(bin.binId)) continue;
      used.add(bin.binId);
      const onHand = quantity(r, 20);
      const reserved = r.chance() ? 0 : r.int(0, onHand);
      rows.push({ binId: bin.binId, itemId, onHand, reserved });
      balances.get(itemId)?.push({ ...bin.facts, onHand, reserved });
    }
  }
  const kits = new Map<string, KitComponent[]>();
  for (let k = 0; k < 2; k += 1) {
    const parts = [...stocked, service]
      .filter(() => r.int(0, 2) === 0)
      .map((itemId) => ({ itemId, perKit: r.pick([500, 1_000, 2_000, 3_000, 250]) }));
    kits.set(newId(), parts);
  }
  const hubOf = new Map(bins.map((b) => [b.binId, b.facts.hubId]));
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from stock_balances where entity_id = ${E} and item_id = any (${[...stocked, service]}::uuid[])`;
      for (const row of rows) {
        await tx`insert into stock_balances (id, entity_id, warehouse_id, bin_id, item_id, qty_on_hand, qty_reserved)
          values (${newId()}, ${E}, ${hubOf.get(row.binId) ?? ''}, ${row.binId}, ${row.itemId},
                  ${fromThousandths(row.onHand)}, ${fromThousandths(row.reserved)})`;
      }
      for (const [kitId, parts] of kits) {
        await tx`insert into kits (id, sku, name)
          values (${kitId}, ${`APK-${kitId.slice(-12)}`}, ${`Parity kit ${kitId.slice(-12)}`})`;
        for (const p of parts) {
          await tx`insert into kit_components (id, kit_id, item_id, qty)
            values (${newId()}, ${kitId}, ${p.itemId}, ${fromThousandths(p.perKit)})`;
        }
      }
    }),
  );
  return { balances, kits };
}

async function removeKits(c: Case): Promise<void> {
  const ids = [...c.kits.keys()];
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`delete from kit_components where kit_id = any (${ids}::uuid[])`;
      await tx`delete from kits where id = any (${ids}::uuid[])`;
    }),
  );
}

interface SpecLine {
  lineId: string;
  itemId: string | null;
  kitId: string | null;
  qty: number;
}

/** What atp.ts answers each line: null for a line with nothing kept in stock. */
function specOf(c: Case, lines: readonly SpecLine[]) {
  const free = new Map(
    stocked.map((id) => [id, itemAvailability(c.balances.get(id) ?? [])] as const),
  );
  const docLines: DocumentLine[] = lines.map((l) =>
    l.kitId === null
      ? {
          parts: l.itemId === service ? [] : [{ itemId: l.itemId ?? '', perKit: 1_000 }],
          kit: false,
          qty: l.qty,
        }
      : {
          parts: (c.kits.get(l.kitId) ?? []).filter((p) => p.itemId !== service),
          kit: true,
          qty: l.qty,
        },
  );
  return documentAvailability(docLines, free);
}

describe('app.free_availability() and atp.ts', () => {
  it(`answer every line alike on ${String(CASES)} generated documents`, async () => {
    const r = seededGenerator(0xa7f);
    for (let n = 0; n < CASES; n += 1) {
      const c = await writeCase(r);
      try {
        const kitIds = [...c.kits.keys()];
        const lines: SpecLine[] = Array.from({ length: r.int(1, 8) }, () =>
          r.int(0, 2) === 0
            ? {
                lineId: newId(),
                itemId: null,
                kitId: r.pick(kitIds),
                qty: r.chance() ? r.int(1, 5) * 1_000 : r.int(1, 5_000),
              }
            : {
                lineId: newId(),
                itemId: r.pick([...stocked, service]),
                kitId: null,
                qty: r.int(1, 25_000),
              },
        );
        const expected = specOf(c, lines);
        const json = lines.map((l, i) => ({
          line_id: l.lineId,
          position: i + 1,
          item_id: l.itemId,
          kit_id: l.kitId,
          qty: fromThousandths(l.qty),
        }));
        const rows = await asMigrator(
          (m) => m<{ line_id: string; status: string; qty_free: string | null }[]>`
            select line_id, status, qty_free::text as qty_free
              from app.free_availability(${E}::smallint, ${m.json(json)}, true)`,
        );
        const got = new Map(rows.map((row) => [row.line_id, row]));
        const label = `case ${String(n)}`;
        for (const [i, line] of lines.entries()) {
          const want = expected[i];
          const row = got.get(line.lineId);
          if (want === null || want === undefined) {
            expect(row, `${label}, line ${String(i + 1)}`).toBeUndefined();
            continue;
          }
          expect(
            {
              status: row?.status,
              free: row?.qty_free == null ? null : toThousandths(row.qty_free),
            },
            `${label}, line ${String(i + 1)}`,
          ).toEqual({ status: want.status, free: want.available });
        }
        expect(rows.length, label).toBe(expected.filter((a) => a !== null).length);
        // Without counts, the statuses alone.
        const bare = await asMigrator(
          (m) => m<{ status: string; qty_free: string | null }[]>`
            select status, qty_free::text as qty_free
              from app.free_availability(${E}::smallint, ${m.json(json)}, false)`,
        );
        expect(bare.map((b) => b.status)).toEqual(rows.map((row) => row.status));
        expect(bare.every((b) => b.qty_free === null)).toBe(true);
      } finally {
        await removeKits(c);
      }
    }
  });
});

describe('app.line_availability() of a confirmed order and atp.ts', () => {
  it('answer each line by what it holds, kits by whole kits', async () => {
    const r = seededGenerator(0xa80);
    for (let n = 0; n < 8; n += 1) {
      const c = await writeCase(r);
      try {
        const kitIds = [...c.kits.keys()];
        const specs = Array.from({ length: r.int(1, 4) }, () =>
          r.chance()
            ? { kitId: r.pick(kitIds), qty: String(r.int(1, 4)) }
            : { itemId: r.pick(stocked), qty: String(r.int(1, 12)) },
        );
        const { orderId } = await draftOrder(f, lc.id, specs);
        await asPrincipal(lc, (context) =>
          runCommand(confirmSalesOrder, { context, audit, outbox }, { entityId: E, orderId }),
        );
        const view: LineAvailabilityDto = await asPrincipal(manager, (ctx) =>
          readLineAvailability(ctx, { entityId: E, kind: 'order', id: orderId }),
        );
        const lines = await asMigrator(
          (m) => m<{ id: string; qty: string; qty_backordered: string; needs: number }[]>`
            select l.id, l.qty::text as qty, l.qty_backordered::text as qty_backordered,
                   (select count(*)::int from reservation_needs rn where rn.sales_order_line_id = l.id)
                     as needs
              from sales_order_lines l where l.sales_order_id = ${orderId} order by l.position`,
        );
        const answered = new Map(
          view.withCounts ? view.lines.map((l) => [l.lineId, l] as const) : [],
        );
        for (const line of lines) {
          const answer = answered.get(line.id);
          if (line.needs === 0) {
            expect(answer).toBeUndefined();
            continue;
          }
          const qty = toThousandths(line.qty);
          const held = qty - toThousandths(line.qty_backordered);
          expect(answer?.status, `case ${String(n)}`).toBe(lineAvailability(qty, held).status);
        }
      } finally {
        // The order's lines name the kits, so they stay; only kits no line names go.
        await removeKits(c).catch(() => undefined);
      }
    }
  });
});
