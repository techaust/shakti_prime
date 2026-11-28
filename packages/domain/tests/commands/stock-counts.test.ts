import { newId, type PermissionGrant, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeQuery } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import {
  cancelStockCount,
  recordStockCount,
  recountStockCount,
  startStockCount,
  submitStockCount,
} from '../../src/commands/inventory/counts';
import { postStockCount } from '../../src/commands/inventory/counts-post';
import { adjustStock, transferStock } from '../../src/commands/inventory/stock';
import { getStockCard, listStockBalances } from '../../src/queries/inventory/stock';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  getStockCountReview,
  getStockCountSheet,
  listStockCounts,
} from '../../src/queries/inventory/counts';
import { transition } from '../../src/state-machines/define-machine';
import { serialMachine } from '../../src/state-machines/machines/serial';
import { onHand, serialOf } from '../stock/stock-fixture';

/**
 * H3's commands (docs/03-roadmap-appendix/phase3.md §7.3): a count started by the Inventory
 * Manager, counted blind by a counter, asked again, reviewed and posted, so the ledger then equals
 * what was counted, movements during the count included; serials found and missing; each command
 * refused without its grant and in another company.
 */

/** One godown of this file's own, with a receiving bin and two storage bins, and two items. */
interface CountFixture {
  tag: string;
  hub: string;
  receiving: string;
  binA: string;
  binB: string;
  /** Counted in metres, and tracked by serial. */
  cable: string;
  pump: string;
}

/** The hubs this file made, archived once it ends so no later hub is paired with them. */
const hubsMade: string[] = [];

/**
 * A fresh godown per test, written by the table owner. No transit hub, so H1's hub commands, which
 * pair every new hub with each one in use, are not slowed by this file's hubs.
 */
async function countFixture(): Promise<CountFixture> {
  const tag = newId().slice(-8).toUpperCase();
  const f: CountFixture = {
    tag,
    hub: newId(),
    receiving: newId(),
    binA: newId(),
    binB: newId(),
    cable: newId(),
    pump: newId(),
  };
  hubsMade.push(f.hub);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
        values (${f.hub}, ${`H${tag}`}, ${`Count hub ${tag}`}, 'godown', '08', '302001', ${exec.id})`;
      await tx`insert into bins (id, warehouse_id, code, kind, created_by) values
        (${f.receiving}, ${f.hub}, 'RECEIVING', 'receiving', ${exec.id}),
        (${f.binA}, ${f.hub}, 'A1', 'storage', ${exec.id}),
        (${f.binB}, ${f.hub}, 'B1', 'storage', ${exec.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked) values
        (${f.cable}, ${`CC-${tag}`}, ${`Count cable ${tag}`}, 'cable', '8544', 'metre', false),
        (${f.pump}, ${`CP-${tag}`}, ${`Count pump ${tag}`}, 'pump', '8413', 'nos', true)`;
    }),
  );
  return f;
}

afterAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table warehouses disable trigger warehouses_guard`;
      await tx`update warehouses set archived_at = now() where id = any(${hubsMade}::uuid[])`;
      await tx`alter table warehouses enable trigger warehouses_guard`;
    }),
  );
  await closeDb();
});

let exec: Principal;
let manager: Principal;
let counter: Principal;
let blindCounter: Principal;

interface CountOut {
  id: string;
  state: string;
}

function run<T = CountOut>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  entityIds?: readonly number[],
): Promise<T> {
  const who = entityIds === undefined ? principal : { ...principal, entityIds: [...entityIds] };
  return asPrincipal(who, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

function sheet(principal: Principal, countId: string) {
  return asPrincipal(principal, (ctx) => getStockCountSheet(ctx, { countId }));
}

function review(principal: Principal, countId: string) {
  return asPrincipal(principal, (ctx) => getStockCountReview(ctx, { countId }));
}

/** A gain of an untracked quantity, or of new serials, into a bin of company 1. */
async function gain(binId: string, itemId: string, what: { qty?: string; serialNos?: string[] }) {
  await run(exec, adjustStock, {
    entityId: 1,
    itemId,
    binId,
    adjustment: 'gain',
    note: 'Stock for the count',
    ...what,
  });
}

const serialNos = (f: CountFixture, ...n: number[]) => n.map((i) => `CT-${f.tag}-${String(i)}`);

/** Every key of a value, at any depth. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]);
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  // Someone who counts and does nothing else.
  const permissions: PermissionGrant[] = [
    { key: 'inventory.count.record', scope: 'entity' },
    { key: 'inventory.stock.read', scope: 'entity' },
  ];
  counter = await createTestPrincipal('store_manager', [1], { permissions });
  // The design's counter: inventory.count.record alone, reading no stock.
  blindCounter = await createTestPrincipal('store_manager', [1], {
    permissions: [{ key: 'inventory.count.record', scope: 'entity' }],
  });
});

describe('inventory.count.*: who may', () => {
  it('refuses each command without its grant, to an agent, and in another company', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '10' });
    const start = { entityId: 1, hubId: f.hub, scope: 'hub' };
    for (const who of [
      counter,
      principalFor('general_manager', [1]),
      principalFor('accounts', [1]),
    ]) {
      await expect(run(who, startStockCount, start), who.roleKey).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(
      run(principalFor('agent:chief', [1]), startStockCount, start),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // The Inventory Manager of company 1 cannot start one for company 2.
    await expect(run(manager, startStockCount, { ...start, entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });

    const count = await run(manager, startStockCount, start);
    const record = { countId: count.id, binId: f.binA, itemId: f.cable, qty: '10' };
    // Counting needs inventory.count.record; a reader of stock cannot count.
    await expect(
      run(principalFor('general_manager', [1]), recordStockCount, record),
    ).rejects.toMatchObject({ code: 'forbidden' });
    // Asking again, posting and cancelling need inventory.stock.adjust.
    for (const [command, input] of [
      [recountStockCount, { countId: count.id, binId: f.binA, itemId: f.cable }],
      [postStockCount, { countId: count.id, note: 'Year-end count' }],
      [cancelStockCount, { countId: count.id, cancelReason: 'Started by mistake' }],
    ] as const) {
      await expect(run(counter, command, input), command.name).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    // Acting in company 2, the count of company 1 is not there to see.
    const otherCounter = { ...counter, entityIds: [2] };
    await expect(run(otherCounter, recordStockCount, record)).rejects.toMatchObject({
      code: 'not_found',
    });
    const otherManager = principalFor('inventory_manager', [2], { id: manager.id });
    for (const [command, input] of [
      [submitStockCount, { countId: count.id }],
      [cancelStockCount, { countId: count.id, cancelReason: 'Not ours' }],
    ] as const) {
      await expect(run(otherManager, command, input), command.name).rejects.toMatchObject({
        code: 'not_found',
      });
    }
    await run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Test over' });
  });

  it('keeps one live count per company and hub, and counts no goods in transit', async () => {
    const f = await countFixture();
    const first = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });
    await expect(
      run(manager, startStockCount, {
        entityId: 1,
        hubId: f.hub,
        scope: 'bins',
        binIds: [f.binB],
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stock_count_live' } });
    // Another company counts the same hub at the same time.
    const other = await run(
      exec,
      startStockCount,
      { entityId: 2, hubId: f.hub, scope: 'hub' },
      [2],
    );
    expect(other.state).toBe('open');
    // A transit hub, out of use at once so no hub made later is paired with it.
    const transit = newId();
    await asMigrator(
      (m) => m`insert into warehouses (id, code, name, kind, created_by, archived_at)
        values (${transit}, ${`T${f.tag}`}, ${`Transit ${f.tag}`}, 'transit', ${exec.id}, now())`,
    );
    await expect(
      run(manager, startStockCount, { entityId: 1, hubId: transit, scope: 'hub' }),
    ).rejects.toMatchObject({ details: { reason: 'stock_count_hub_transit' } });
    await expect(
      run(manager, startStockCount, {
        entityId: 1,
        hubId: f.hub,
        scope: 'bins',
        binIds: [newId()],
      }),
    ).rejects.toMatchObject({ details: { reason: 'stock_count_bin_outside' } });
    const cancelled = await run(manager, cancelStockCount, {
      countId: first.id,
      cancelReason: 'Started twice',
    });
    expect(cancelled.state).toBe('cancelled');
    await expect(
      run(manager, recordStockCount, {
        countId: first.id,
        binId: f.binA,
        itemId: f.cable,
        qty: '1',
      }),
    ).rejects.toMatchObject({ details: { reason: 'stock_count_not_counting' } });
    await run(exec, cancelStockCount, { countId: other.id, cancelReason: 'Test over' }, [2]);
  });
});

describe('a counter counts blind', () => {
  it('never sees the expected quantity, a difference or how many serials to find', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '40' });
    await gain(f.binA, f.pump, { serialNos: serialNos(f, 1, 2, 3) });
    const count = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });

    const before = await sheet(counter, count.id);
    expect(before.rows).toHaveLength(2);
    expect(before.progress).toEqual({ itemsInBins: 2, toCount: 2, recountOpen: 0 });
    expect(keysOf(before).filter((k) => /expected|variance|difference|value/i.test(k))).toEqual([]);
    expect(before.rows.every((r) => r.countedQty === null && r.serialNos === null)).toBe(true);
    // No value in the sheet is 40 or 3.
    const values = before.rows.flatMap((r) => Object.values(r).map(String));
    expect(values.filter((v) => /^(40|3)(\.0+)?$/.test(v))).toEqual([]);

    const answer = await run<Record<string, unknown>>(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '37',
    });
    expect(keysOf(answer).filter((k) => /expected|variance|value/i.test(k))).toEqual([]);
    expect(Object.values(answer).map(String)).not.toContain('40.000');
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.pump,
      serialNos: serialNos(f, 1),
    });
    const after = await sheet(counter, count.id);
    expect(after.count.state).toBe('counting');
    expect(after.rows.map((r) => [r.state, r.countedQty, r.serialNos])).toEqual([
      ['counted', '37.000', null],
      ['counted', '1.000', serialNos(f, 1)],
    ]);
    // A serial the company does not have is refused by its number alone.
    await expect(
      run(counter, recordStockCount, {
        countId: count.id,
        binId: f.binB,
        itemId: f.pump,
        serialNos: ['NOT-A-SERIAL'],
      }),
    ).rejects.toMatchObject({
      details: { reason: 'stock_count_serial_unknown', serialNo: 'NOT-A-SERIAL' },
    });
    // A serial counted in A1 is not counted in B1 as well.
    await expect(
      run(counter, recordStockCount, {
        countId: count.id,
        binId: f.binB,
        itemId: f.pump,
        serialNos: serialNos(f, 1),
      }),
    ).rejects.toMatchObject({
      details: { reason: 'stock_count_serial_counted_elsewhere', binCode: 'A1' },
    });
    // The counter reads no review, and the audit rows carry no expected quantity.
    await expect(review(counter, count.id)).rejects.toMatchObject({ code: 'forbidden' });
    const rows = await asMigrator(
      (m) => m<{ after: unknown }[]>`
        select after_json as after from audit_logs
         where aggregate_id = ${count.id} and command = 'inventory.count.record'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toMatch(/"40(\.0+)?"|:40[,}]/);
    await run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Test over' });
  });

  it('is counted by someone who does not read stock, who sees no balance, movement or serial', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '40' });
    await gain(f.binA, f.pump, { serialNos: serialNos(f, 1, 2) });
    const count = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });

    // The list, with the hub's name, and the sheet with the bins to count in.
    const page = await asPrincipal(blindCounter, (ctx) =>
      listStockCounts(ctx, { entityId: 1, state: 'open', limit: 100 }),
    );
    expect(page.items.find((c) => c.id === count.id)).toMatchObject({
      hubCode: `H${f.tag}`,
      hubName: `Count hub ${f.tag}`,
    });
    const before = await sheet(blindCounter, count.id);
    expect(before.count.hubCode).toBe(`H${f.tag}`);
    expect(before.bins.map((b) => b.code)).toEqual(['A1', 'B1', 'RECEIVING']);
    expect(before.rows).toHaveLength(2);
    expect(
      keysOf(before).filter((k) => /expected|variance|difference|value|qty_on/i.test(k)),
    ).toEqual([]);

    await run(blindCounter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '39',
    });
    await run(blindCounter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.pump,
      serialNos: serialNos(f, 1, 2),
    });
    const submitted = await run(blindCounter, submitStockCount, { countId: count.id });
    expect(submitted.state).toBe('review');

    // Nothing of the stock itself, on either pool: no balance, movement, serial, hub or bin.
    for (const reader of [false, true]) {
      const seen = await executeQuery(
        blindCounter,
        { entityIds: [1] },
        async ({ tx }) => {
          const [n] = (await tx.execute(sql`
          select (select count(*)::int from stock_balances where bin_id = ${f.binA}) as balances,
                 (select count(*)::int from stock_movements where to_bin_id = ${f.binA}) as movements,
                 (select count(*)::int from serials where item_id = ${f.pump}) as serials,
                 (select count(*)::int from warehouses where id = ${f.hub}) as hubs,
                 (select count(*)::int from bins where warehouse_id = ${f.hub}) as bins`)) as unknown as Record<
            string,
            number
          >[];
          return n;
        },
        { name: 'blindCounterReads', pool: reader ? 'reader' : 'app_user' },
      );
      expect({ reader, ...seen }).toEqual({
        reader,
        balances: 0,
        movements: 0,
        serials: 0,
        hubs: 0,
        bins: 0,
      });
    }
    // The review stays the Inventory Manager's.
    await expect(review(blindCounter, count.id)).rejects.toMatchObject({ code: 'forbidden' });
    await run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Test over' });
  });
});

describe('blind counting (owner, question B)', () => {
  it('lets the Store Manager count, with no stock of the counted bin to read until it posts', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '40' });
    await gain(f.binB, f.cable, { qty: '5' });
    const storeManager = await createTestPrincipal('store_manager', [1]);
    const count = await run(manager, startStockCount, {
      entityId: 1,
      hubId: f.hub,
      scope: 'bins',
      binIds: [f.binA],
    });
    /** What the Store Manager reads of the cable in the hub: the bins listed, the card. */
    const reads = async (who: Principal) =>
      asPrincipal(who, async (ctx) => {
        const list = await listStockBalances(ctx, { entityId: 1, hubId: f.hub, limit: 50 });
        const card = await getStockCard(ctx, { entityId: 1, itemId: f.cable, hubId: f.hub });
        return {
          bins: list.items.filter((r) => r.itemId === f.cable).map((r) => r.binId),
          onHand: card.byHub.find((h) => h.hubId === f.hub)?.onHand ?? null,
          moved: card.movements.map((m) => m.to?.id ?? m.from?.id).sort(),
          // What the screens say instead of "holds none" (`app.stock_count_hides()`).
          hidden: { list: list.hiddenByCount, card: card.hiddenByCount },
        };
      });
    expect(await reads(storeManager)).toEqual({
      bins: [f.binB],
      onHand: '5.000',
      moved: [f.binB],
      hidden: { list: true, card: true },
    });
    // The Inventory Manager reads the counted bin throughout, and is told of nothing hidden.
    expect(await reads(manager)).toMatchObject({
      onHand: '45.000',
      hidden: { list: false, card: false },
    });

    await run(storeManager, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '38',
    });
    await run(storeManager, submitStockCount, { countId: count.id });
    expect((await reads(storeManager)).onHand).toBe('5.000');
    // Posting, starting and cancelling stay with inventory.stock.adjust.
    await expect(
      run(storeManager, postStockCount, { countId: count.id, note: 'Month-end count' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await run(manager, postStockCount, { countId: count.id, note: 'Month-end count' });
    const after = await reads(storeManager);
    expect(after.onHand).toBe('43.000');
    expect(after.hidden.card).toBe(false);
    expect(after.bins.sort()).toEqual([f.binA, f.binB].sort());
  });
});

describe('a posted count', () => {
  it('leaves the ledger equal to what was counted, with movements during the count folded in', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '100' });
    await gain(f.binB, f.cable, { qty: '20' });
    const count = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });
    // Before A1 is counted: 10 metres move from A1 to B1. The counter then finds 88 in A1
    // (the ledger held 90 when they counted: 2 metres short).
    await run(manager, transferStock, {
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      toBinId: f.binB,
      qty: '10',
    });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '88',
    });
    // B1 counted at 30 (as the ledger holds); then, after B1's count, 5 more arrive in B1.
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binB,
      itemId: f.cable,
      qty: '30',
    });
    await gain(f.binB, f.cable, { qty: '5' });
    // Stock found where none was listed: the cable in the receiving bin.
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.receiving,
      itemId: f.cable,
      qty: '4',
    });
    await run(counter, submitStockCount, { countId: count.id });

    const seen = await review(manager, count.id);
    const line = (binId: string) => seen.lines.find((l) => l.binId === binId);
    expect(line(f.binA)).toMatchObject({
      expectedAtStart: '100.000',
      movedDuringCount: '-10.000',
      expectedAtCount: '90.000',
      counted: '88.000',
      variance: '-2.000',
      value: null,
    });
    expect(line(f.binB)).toMatchObject({ expectedAtCount: '30.000', variance: '0.000' });
    expect(line(f.receiving)).toMatchObject({ expectedAtStart: '0.000', variance: '4.000' });
    // The movements during the count are listed: the move and the later gain.
    expect(seen.movements.map((m) => m.reason).sort()).toEqual(['adjust_gain', 'transfer']);
    expect(seen.showsValues).toBe(false);
    expect(seen.netValue).toBeNull();

    const posted = await run<{ count: CountOut; movementIds: string[] }>(manager, postStockCount, {
      countId: count.id,
      note: 'Year-end count',
    });
    expect(posted.count.state).toBe('posted');
    expect(posted.movementIds).toHaveLength(2);
    expect(await onHand(1, f.binA, f.cable)).toBe('88.000');
    // B1: counted 30, and 5 arrived after its count.
    expect(await onHand(1, f.binB, f.cable)).toBe('35.000');
    expect(await onHand(1, f.receiving, f.cable)).toBe('4.000');
    const moves = await asMigrator(
      (m) => m<{ reason: string; ref: string; note: string }[]>`
        select reason, ref_type as ref, note from stock_movements where ref_id = ${count.id}`,
    );
    expect(moves.every((m) => m.reason === 'count' && m.ref === 'stock_count')).toBe(true);
    expect(moves.every((m) => m.note === 'Year-end count')).toBe(true);
    // The review after posting still shows the variances that posted.
    const after = await review(manager, count.id);
    expect(after.lines.find((l) => l.binId === f.binA)?.variance).toBe('-2.000');
    // One event announces the movements.
    const events = await asOutboxPublisher(
      (p) => p<{ n: number }[]>`
        select count(*)::int as n from outbox_events
         where type = 'inventory.stock.moved' and aggregate_id = ${posted.movementIds[0] ?? ''}`,
    );
    expect(events[0]?.n).toBe(1);
  });

  it('stays right over a busy bin, with movements committing while it posts', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '50' });
    await gain(f.binB, f.cable, { qty: '50' });
    const count = await run(manager, startStockCount, {
      entityId: 1,
      hubId: f.hub,
      scope: 'bins',
      binIds: [f.binA],
    });
    // Before A1 is counted, some moves; then the count (48: two short of the ledger's 50 less 3).
    await run(manager, transferStock, {
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      toBinId: f.binB,
      qty: '3',
    });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '45',
    });
    await run(counter, submitStockCount, { countId: count.id });
    // The post and twelve movements in and out of A1 at once, in no set order.
    const busy = Array.from({ length: 12 }, (_, i) =>
      i % 3 === 0
        ? run(manager, transferStock, {
            entityId: 1,
            itemId: f.cable,
            fromBinId: f.binB,
            toBinId: f.binA,
            qty: '2',
          })
        : i % 3 === 1
          ? run(manager, transferStock, {
              entityId: 1,
              itemId: f.cable,
              fromBinId: f.binA,
              toBinId: f.binB,
              qty: '1',
            })
          : gain(f.binA, f.cable, { qty: '0.5' }),
    );
    const results = await Promise.allSettled([
      run(manager, postStockCount, { countId: count.id, note: 'Count over a busy bin' }),
      ...busy,
    ]);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    // A1 holds what was counted plus what moved after its count, whichever order they committed.
    const [after] = await asMigrator(
      (m) => m<{ moved: string }[]>`
        select coalesce(sum(case when m.to_bin_id = ${f.binA} then m.qty else -m.qty end), 0)::numeric(12, 3)::text as moved
          from stock_movements m
          join stock_count_lines l on l.count_id = ${count.id} and l.bin_id = ${f.binA}
         where (m.to_bin_id = ${f.binA} or m.from_bin_id = ${f.binA})
           and m.item_id = ${f.cable} and m.moved_at > l.counted_at
           and m.ref_id is distinct from ${count.id}`,
    );
    const expected = (45 + Number(after?.moved ?? 'NaN')).toFixed(3);
    expect(await onHand(1, f.binA, f.cable)).toBe(expected);
    const [posted] = await asMigrator(
      (m) => m<{ qty: string; out: boolean }[]>`
        select qty::text as qty, from_bin_id is not null as out
          from stock_movements where ref_id = ${count.id}`,
    );
    expect(posted).toEqual({ qty: '2.000', out: true });
  });

  it('writes off a serial missing and brings back a serial found', async () => {
    const f = await countFixture();
    const [s1, s2, s3, s4] = serialNos(f, 1, 2, 3, 4);
    await gain(f.binA, f.pump, { serialNos: [s1 ?? '', s2 ?? ''] });
    await gain(f.binB, f.pump, { serialNos: [s3 ?? ''] });
    // s4 was written off before the count.
    await gain(f.binB, f.pump, { serialNos: [s4 ?? ''] });
    await run(exec, adjustStock, {
      entityId: 1,
      itemId: f.pump,
      binId: f.binB,
      adjustment: 'loss',
      note: 'Not found last month',
      serialNos: [s4],
    });
    const count = await run(manager, startStockCount, {
      entityId: 1,
      hubId: f.hub,
      scope: 'items',
      itemIds: [f.pump],
    });
    // A1 holds s1 and s3 (s3 is in B1 by the ledger); s2 is missing. B1 holds s4, written off.
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.pump,
      serialNos: [s1, s3],
    });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binB,
      itemId: f.pump,
      serialNos: [s4?.toLowerCase()],
    });
    // Posting is refused while anything is uncounted: nothing else here, so send it.
    await run(counter, submitStockCount, { countId: count.id });
    const seen = await review(manager, count.id);
    const lines = seen.lines.filter((l) => l.serialId !== null);
    const bySerial = (no: string | undefined, binId: string) =>
      lines.find((l) => l.serialNo === no && l.binId === binId);
    expect(bySerial(s2, f.binA)?.variance).toBe('-1.000');
    expect(bySerial(s3, f.binA)?.variance).toBe('1.000');
    expect(bySerial(s3, f.binB)?.variance).toBe('-1.000');
    expect(bySerial(s4, f.binB)?.variance).toBe('1.000');
    const s2Line = bySerial(s2, f.binA);
    await run(manager, postStockCount, {
      countId: count.id,
      note: 'Quarterly count',
      serialNotes: [{ lineId: s2Line?.lineId, note: 'Not on the shelf; asked the site team' }],
    });
    expect(await serialOf(f.pump, s1 ?? '')).toMatchObject({ state: 'in_stock', binId: f.binA });
    expect(await serialOf(f.pump, s2 ?? '')).toMatchObject({ state: 'scrapped', binId: null });
    expect(await serialOf(f.pump, s3 ?? '')).toMatchObject({ state: 'in_stock', binId: f.binA });
    expect(await serialOf(f.pump, s4 ?? '')).toMatchObject({ state: 'in_stock', binId: f.binB });
    expect(await onHand(1, f.binA, f.pump)).toBe('2.000');
    expect(await onHand(1, f.binB, f.pump)).toBe('1.000');
    const [note] = await asMigrator(
      (m) => m<{ note: string }[]>`
        select m.note from stock_movements m join serials s on s.id = m.serial_id
         where m.ref_id = ${count.id} and s.serial_no = ${s2 ?? ''}`,
    );
    expect(note?.note).toBe('Not on the shelf; asked the site team');
  });

  it('refuses a faulty serial missing, on the review and at the post, before any movement', async () => {
    const f = await countFixture();
    const [s1, s2] = serialNos(f, 1, 2);
    await gain(f.binA, f.pump, { serialNos: [s1 ?? '', s2 ?? ''] });
    // s2 went to a customer as a replacement and came back faulty into A1, as R3 will record it:
    // each step through the serial machine, then written as the ledger would leave it.
    const actor = { kind: 'principal' as const, principal: exec };
    const out = transition(serialMachine, { state: 'in_stock', binId: f.binA }, 'replace', {
      actor,
      now: new Date(),
      params: { fromBinId: f.binA },
    });
    const back = transition(serialMachine, { state: out.to, binId: null }, 'return_faulty', {
      actor,
      now: new Date(),
      params: {},
    });
    expect(back.to).toBe('faulty');
    await asMigrator(
      (m) => m`update serials set state = ${back.to}
                where item_id = ${f.pump} and serial_no = ${s2 ?? ''}`,
    );
    const count = await run(manager, startStockCount, {
      entityId: 1,
      hubId: f.hub,
      scope: 'items',
      itemIds: [f.pump],
    });
    // The faulty unit is not on the shelf.
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.pump,
      serialNos: [s1],
    });
    await run(counter, submitStockCount, { countId: count.id });
    const seen = await review(manager, count.id);
    expect(seen.lines.find((l) => l.serialNo === s2)).toMatchObject({
      variance: '-1.000',
      postRefusal: 'stock_count_serial_faulty',
    });
    expect(seen.lines.find((l) => l.serialNo === s1)?.postRefusal).toBeNull();
    await expect(
      run(manager, postStockCount, { countId: count.id, note: 'Quarterly count' }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'stock_count_serial_faulty', serialNo: s2 },
    });
    const [moved] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from stock_movements where ref_id = ${count.id}`,
    );
    expect(moved?.n).toBe(0);
    expect(await serialOf(f.pump, s2 ?? '')).toMatchObject({ state: 'faulty', binId: f.binA });
    expect((await review(manager, count.id)).count.state).toBe('review');
    await run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Test over' });
  });

  it('waits for every item to be counted and every recount to be taken', async () => {
    const f = await countFixture();
    await gain(f.binA, f.cable, { qty: '12' });
    await gain(f.binB, f.cable, { qty: '6' });
    const count = await run(manager, startStockCount, {
      entityId: 1,
      hubId: f.hub,
      scope: 'bins',
      binIds: [f.binA, f.binB],
    });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '15',
    });
    await expect(run(counter, submitStockCount, { countId: count.id })).rejects.toMatchObject({
      details: { reason: 'stock_count_uncounted' },
    });
    await expect(
      run(manager, postStockCount, { countId: count.id, note: 'Too early' }),
    ).rejects.toMatchObject({ code: 'conflict' });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binB,
      itemId: f.cable,
      qty: '6',
    });
    await run(counter, submitStockCount, { countId: count.id });
    // 15 against 12 looks wrong: ask for A1 again. The count goes back to counting.
    const asked = await run(manager, recountStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
    });
    expect(asked.state).toBe('counting');
    const blind = await sheet(counter, count.id);
    expect(blind.rows.find((r) => r.binId === f.binA)).toMatchObject({
      state: 'recount',
      countedQty: null,
    });
    await expect(run(counter, submitStockCount, { countId: count.id })).rejects.toMatchObject({
      details: { reason: 'stock_count_recount_open' },
    });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '12',
    });
    await run(counter, submitStockCount, { countId: count.id });
    const seen = await review(manager, count.id);
    expect(seen.lines.find((l) => l.binId === f.binA)).toMatchObject({
      firstCount: '15.000',
      recount: '12.000',
      counted: '12.000',
      variance: '0.000',
    });
    const posted = await run<{ movementIds: string[] }>(manager, postStockCount, {
      countId: count.id,
      note: 'Cycle count',
    });
    expect(posted.movementIds).toEqual([]);
    expect(await onHand(1, f.binA, f.cable)).toBe('12.000');
    await expect(
      run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Too late' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('shows each variance’s value only to a holder of finance.cost.read', async () => {
    const f = await countFixture();
    await run(exec, adjustStock, {
      entityId: 1,
      itemId: f.cable,
      binId: f.binA,
      adjustment: 'gain',
      qty: '10',
      note: 'Opening for the count',
    });
    const count = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });
    await run(counter, recordStockCount, {
      countId: count.id,
      binId: f.binA,
      itemId: f.cable,
      qty: '7',
    });
    await run(counter, submitStockCount, { countId: count.id });
    const valuer = { ...exec, entityIds: [1] };
    // An item with no average has no value, not a value of nothing.
    await asMigrator(
      (m) => m`update item_costs set moving_avg_cost = null
                where entity_id = 1 and item_id = ${f.cable}`,
    );
    const noCost = await review(valuer, count.id);
    expect(noCost.lines.find((l) => l.binId === f.binA)?.value).toBeNull();
    expect(noCost.netValue).toBe('0.00');
    await asMigrator(
      (m) => m`update item_costs set moving_avg_cost = 12.5000, last_positive_avg_cost = 12.5000
                where entity_id = 1 and item_id = ${f.cable}`,
    );
    const withCost = await review(valuer, count.id);
    expect(withCost.showsValues).toBe(true);
    expect(withCost.lines.find((l) => l.binId === f.binA)?.value).toBe('-37.50');
    expect(withCost.netValue).toBe('-37.50');
    const without = await review(manager, count.id);
    expect(without.lines.every((l) => l.value === null)).toBe(true);

    // Posted, the value is what the movement posted at, whatever the average does later.
    await run(manager, postStockCount, { countId: count.id, note: 'Quarterly count' });
    await asMigrator(
      (m) => m`update item_costs set moving_avg_cost = 99.0000
                where entity_id = 1 and item_id = ${f.cable}`,
    );
    const posted = await review(valuer, count.id);
    expect(posted.count.state).toBe('posted');
    expect(posted.lines.find((l) => l.binId === f.binA)?.value).toBe('-37.50');
    expect(posted.netValue).toBe('-37.50');
    expect((await review(manager, count.id)).netValue).toBeNull();
  });

  it('lists a company’s counts by state for counters and readers of stock', async () => {
    const f = await countFixture();
    const count = await run(manager, startStockCount, { entityId: 1, hubId: f.hub, scope: 'hub' });
    const page = await asPrincipal(counter, (ctx) =>
      listStockCounts(ctx, { entityId: 1, state: 'open', limit: 100 }),
    );
    expect(page.items.some((c) => c.id === count.id && c.hubCode === `H${f.tag}`)).toBe(true);
    await expect(
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        listStockCounts(ctx, { entityId: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await run(manager, cancelStockCount, { countId: count.id, cancelReason: 'Test over' });
  });
});
