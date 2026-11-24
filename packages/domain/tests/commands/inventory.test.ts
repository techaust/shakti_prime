import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  archiveBin,
  archiveHub,
  createBin,
  createHub,
  updateBin,
  updateHub,
} from '../../src/commands/inventory/hubs';
import { adjustStock, reverseStock, transferStock } from '../../src/commands/inventory/stock';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { onHand, serialOf, stockFixture, type StockFixture } from '../stock/stock-fixture';

afterAll(closeDb);

/**
 * H1's commands (docs/03-roadmap-appendix/phase3.md §6.2): hubs and bins for the Executive alone,
 * stock moved by hand with its grant in the caller's company, each audited and announced with
 * ids and quantities, never a cost.
 */

let exec: Principal;
let manager: Principal;
let f: StockFixture;
const tag = newId().slice(-6).toUpperCase();
let seq = 0;
const code = (prefix: string) => `${prefix}${tag}${String((seq += 1))}`;

function run<T = Record<string, unknown>>(
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

interface HubOut {
  id: string;
  code: string;
  kind: string;
  bins: { id: string; code: string; kind: string; pairHubIds: [string, string] | null }[];
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  manager = await createTestPrincipal('inventory_manager', [1]);
  f = await stockFixture(exec.id);
});

describe('inventory.hub.* and inventory.bin.*', () => {
  const godown = () => ({
    code: code('G'),
    name: 'Jaipur godown',
    kind: 'godown',
    address: 'Plot 4, Sitapura',
    stateCode: '08',
    pinCode: '302022',
  });

  it('are refused to every role without inventory.stock.adjust for every company', async () => {
    for (const roleKey of ['inventory_manager', 'general_manager', 'accounts'] as const) {
      const who = await createTestPrincipal(roleKey, [1]);
      await expect(run(who, createHub, godown()), roleKey).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(run(principalFor('agent:chief', [1]), createHub, godown())).rejects.toMatchObject({
      code: 'forbidden',
    });
    // Every hub and bin command, for the Inventory Manager, whose grant is for one company.
    const hubId = newId();
    const binId = newId();
    const inputs: [AnyCommand, unknown][] = [
      [updateHub, { hubId, code: code('U'), name: 'Hub', stateCode: '08', pinCode: '302022' }],
      [archiveHub, { hubId }],
      [createBin, { hubId, code: 'A-1', kind: 'storage' }],
      [updateBin, { binId, code: 'A-2' }],
      [archiveBin, { binId }],
    ];
    for (const [command, input] of inputs) {
      await expect(run(manager, command, input), command.name).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('make a godown with its receiving and dispatch bins, audited for no one company', async () => {
    const recorded = memoryAuditSink();
    const input = godown();
    const hub = (await asPrincipal(exec, (context) =>
      runCommand(createHub, { context, audit: recorded, outbox: memoryOutboxSink() }, input),
    )) as HubOut;
    expect(hub).toMatchObject({ code: input.code, kind: 'godown' });
    expect(hub.bins.map((b) => b.kind).sort()).toEqual(['dispatch', 'receiving']);
    expect(recorded.records.every((r) => r.entityId === null)).toBe(true);
    // A code is a hub's, in any case.
    await expect(
      run(exec, createHub, { ...godown(), code: input.code.toLowerCase() }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'hub_code_taken' } });
    // A godown has its state and PIN code.
    await expect(
      run(exec, createHub, { ...godown(), stateCode: null, pinCode: null }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('give the transit hub one bin per pair, and a later hub its pairs', async () => {
    const a = await run<HubOut>(exec, createHub, godown());
    const transit = await run<HubOut>(exec, createHub, {
      code: code('T'),
      name: 'Between the sites',
      kind: 'transit',
    });
    expect(transit.bins.length).toBeGreaterThan(0);
    expect(transit.bins.every((b) => b.kind === 'transit' && b.pairHubIds !== null)).toBe(true);
    expect(transit.bins.some((b) => b.pairHubIds?.includes(a.id))).toBe(true);
    const later = await run<HubOut>(exec, createHub, godown());
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from bins
         where warehouse_id = ${transit.id}
           and (pair_a_warehouse_id = ${later.id} or pair_b_warehouse_id = ${later.id})`,
    );
    expect(row?.n).toBeGreaterThan(0);
  });

  it('give two pairs whose codes join to the same text two transit bin codes (review probe C)', async () => {
    const [live] = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from warehouses where kind = 'transit' and archived_at is null limit 1`,
    );
    const transitId =
      live?.id ??
      (
        await run<HubOut>(exec, createHub, {
          code: code('T'),
          name: 'Between the sites',
          kind: 'transit',
        })
      ).id;
    // `P` with `Q-R` and `P-Q` with `R` both join to `P-Q-R`.
    const [p, q, r] = [`P${tag}`, `Q${tag}`, `R${tag}`];
    const site = (hubCode: string) => run<HubOut>(exec, createHub, { ...godown(), code: hubCode });
    const hubP = await site(p);
    const hubQR = await site(`${q}-${r}`);
    const hubPQ = await site(`${p}-${q}`);
    const hubR = await site(r);
    const codeOf = async (a: string, b: string) => {
      const [row] = await asMigrator(
        (m) => m<{ code: string }[]>`
          select code from bins where warehouse_id = ${transitId}
             and pair_a_warehouse_id = least(${a}::uuid, ${b}::uuid)
             and pair_b_warehouse_id = greatest(${a}::uuid, ${b}::uuid)`,
      );
      return row?.code;
    };
    expect(await codeOf(hubP.id, hubQR.id)).toBe(`${p}-${q}-${r}`);
    expect(await codeOf(hubPQ.id, hubR.id)).toBe(`${p}-${q}-${r}-2`);
  });

  it('update, add, rename, archive and keep the bins a hub needs', async () => {
    const hub = await run<HubOut>(exec, createHub, godown());
    const updated = await run<HubOut>(exec, updateHub, {
      hubId: hub.id,
      code: hub.code,
      name: 'Jaipur main godown',
      address: null,
      stateCode: '08',
      pinCode: '302022',
    });
    expect(updated).toMatchObject({ id: hub.id });
    const bin = await run<{ id: string; kind: string }>(exec, createBin, {
      hubId: hub.id,
      code: 'A-01',
      kind: 'storage',
    });
    await expect(
      run(exec, createBin, { hubId: hub.id, code: 'a-01', kind: 'storage' }),
    ).rejects.toMatchObject({ details: { reason: 'bin_code_taken' } });
    const quarantine = await run<{ kind: string }>(exec, updateBin, {
      binId: bin.id,
      code: 'Q-01',
      kind: 'quarantine',
    });
    expect(quarantine.kind).toBe('quarantine');
    const receiving = hub.bins.find((b) => b.kind === 'receiving');
    await expect(run(exec, archiveBin, { binId: receiving?.id })).rejects.toMatchObject({
      details: { reason: 'bin_required' },
    });
    await expect(
      run(exec, updateBin, { binId: receiving?.id, code: 'RECEIVING', kind: 'storage' }),
    ).rejects.toMatchObject({ details: { reason: 'bin_kind_fixed' } });
    await run(exec, archiveBin, { binId: bin.id });
    const archived = await run<{ archivedAt: string | null }>(exec, archiveHub, { hubId: hub.id });
    expect(archived.archivedAt).not.toBeNull();
    await expect(
      run(exec, createBin, { hubId: hub.id, code: 'B-01', kind: 'storage' }),
    ).rejects.toMatchObject({ details: { reason: 'bin_hub_unavailable' } });
  });

  it('never archive a hub or bin that holds stock of any company', async () => {
    const hub = await run<HubOut>(exec, createHub, godown());
    const bin = await run<{ id: string }>(exec, createBin, {
      hubId: hub.id,
      code: 'S-01',
      kind: 'storage',
    });
    await run(
      exec,
      adjustStock,
      {
        entityId: 3,
        itemId: f.cable,
        binId: bin.id,
        adjustment: 'gain',
        qty: '2',
        note: 'found on the shelf',
      },
      [3],
    );
    // Acting for company 1, whose stock this is not.
    await expect(run(exec, archiveBin, { binId: bin.id }, [1])).rejects.toMatchObject({
      details: { reason: 'bin_holds_stock' },
    });
    await expect(run(exec, archiveHub, { hubId: hub.id }, [1])).rejects.toMatchObject({
      details: { reason: 'hub_holds_stock' },
    });
  });
});

describe('inventory.stock.adjust', () => {
  const gain = (qty: string) => ({
    entityId: 1,
    itemId: f.cable,
    binId: f.binA,
    adjustment: 'gain',
    qty,
    note: 'Found in the yard',
  });

  it('is refused without inventory.stock.adjust, and in another company', async () => {
    for (const roleKey of ['general_manager', 'store_manager', 'accounts'] as const) {
      await expect(run(principalFor(roleKey, [1]), adjustStock, gain('1'))).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
    await expect(
      run(principalFor('agent:sizing', [1]), adjustStock, gain('1')),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(manager, adjustStock, { ...gain('1'), entityId: 2 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('posts a gain and a loss with their reason, audited and announced without a cost', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const before = Number(await onHand(1, f.binA, f.cable));
    const out = await asPrincipal(manager, (context) =>
      runCommand(adjustStock, { context, audit: recorded, outbox: emitted }, gain('5.5')),
    );
    expect(out.movementIds).toHaveLength(1);
    expect(Number(await onHand(1, f.binA, f.cable))).toBe(before + 5.5);
    expect(recorded.records[0]).toMatchObject({
      command: 'inventory.stock.adjust',
      after: { stockReason: 'adjust_gain', quantity: 5.5, adjustNote: 'Found in the yard' },
    });
    const [event] = emitted.records;
    expect(event).toMatchObject({
      type: 'inventory.stock.moved',
      entityId: 1,
      payload: {
        count: 1,
        movements: [{ itemId: f.cable, toBinId: f.binA, qty: '5.500', reason: 'adjust_gain' }],
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/cost/i);
    const [note] = await asMigrator(
      (m) =>
        m<
          { note: string }[]
        >`select note from stock_movements where id = ${out.movementIds[0] ?? ''}`,
    );
    expect(note?.note).toBe('Found in the yard');
    await run(manager, adjustStock, { ...gain('0.5'), adjustment: 'damage', note: 'Rat bite' });
    expect(Number(await onHand(1, f.binA, f.cable))).toBe(before + 5);
  });

  it('names serials for a tracked item, and fires each through the serial machine', async () => {
    const serialNos = [`AD-${tag}-1`, `AD-${tag}-2`];
    await expect(run(manager, adjustStock, { ...gain('1'), itemId: f.pump })).rejects.toMatchObject(
      { details: { reason: 'stock_serial_required' } },
    );
    await run(manager, adjustStock, { ...gain('1'), qty: undefined, itemId: f.pump, serialNos });
    expect(await serialOf(f.pump, serialNos[0] ?? '')).toMatchObject({ state: 'in_stock' });
    await expect(
      run(manager, adjustStock, { ...gain('1'), qty: undefined, itemId: f.pump, serialNos }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stock_serial_exists' } });
    // Lost from a bin it is not in: the machine refuses before the ledger is asked.
    await expect(
      run(manager, adjustStock, {
        ...gain('1'),
        qty: undefined,
        itemId: f.pump,
        binId: f.binB,
        adjustment: 'loss',
        serialNos: [serialNos[0]],
      }),
    ).rejects.toMatchObject({ details: { reason: 'stock_serial_not_in_bin' } });
    await run(manager, adjustStock, {
      ...gain('1'),
      qty: undefined,
      itemId: f.pump,
      adjustment: 'loss',
      serialNos: [serialNos[0]],
    });
    expect(await serialOf(f.pump, serialNos[0] ?? '')).toMatchObject({ state: 'scrapped' });
  });

  it('a replay with the same key posts once', async () => {
    const key = newId();
    const before = await onHand(1, f.binB, f.cable);
    const input = { ...gain('1'), binId: f.binB };
    const first = await asPrincipal(manager, (context) =>
      runCommand(adjustStock, { context, audit, outbox, idempotencyKey: key }, input),
    );
    const again = await asPrincipal(manager, (context) =>
      runCommand(adjustStock, { context, audit, outbox, idempotencyKey: key }, input),
    );
    expect(again).toEqual(first);
    expect(Number(await onHand(1, f.binB, f.cable))).toBe(Number(before) + 1);
  });
});

describe('inventory.stock.transfer', () => {
  it('is refused without inventory.stock.move for the company, and in another company', async () => {
    const input = {
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      toBinId: f.binB,
      qty: '1',
    };
    await expect(
      run(principalFor('field_engineer', [1]), transferStock, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run(principalFor('general_manager', [1]), transferStock, input),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(manager, transferStock, { ...input, entityId: 3 })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('moves between two bins of one hub, never across hubs', async () => {
    await run(manager, adjustStock, {
      entityId: 1,
      itemId: f.cable,
      binId: f.binA,
      adjustment: 'gain',
      qty: '10',
      note: 'Opening shelf',
    });
    const a = Number(await onHand(1, f.binA, f.cable));
    const out = await run<{ movementIds: string[] }>(manager, transferStock, {
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      toBinId: f.dispatch,
      qty: '3',
    });
    expect(out.movementIds).toHaveLength(1);
    expect(Number(await onHand(1, f.binA, f.cable))).toBe(a - 3);
    await expect(
      run(manager, transferStock, {
        entityId: 1,
        itemId: f.cable,
        fromBinId: f.binA,
        toBinId: f.otherBin,
        qty: '1',
      }),
    ).rejects.toMatchObject({ details: { reason: 'stock_transfer_hubs_differ' } });
    await expect(
      run(manager, transferStock, {
        entityId: 1,
        itemId: f.cable,
        fromBinId: f.binA,
        toBinId: f.binB,
        qty: '99999',
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'stock_insufficient' } });
  });
});

describe('inventory.stock.reverse', () => {
  it('undoes a movement within the window, once, and never one too old', async () => {
    const posted = await run<{ movementIds: string[] }>(manager, adjustStock, {
      entityId: 1,
      itemId: f.cable,
      binId: f.binB,
      adjustment: 'gain',
      qty: '4',
      note: 'Counted twice',
    });
    const id = posted.movementIds[0] ?? '';
    const before = Number(await onHand(1, f.binB, f.cable));
    await expect(
      run(principalFor('general_manager', [1]), reverseStock, { entityId: 1, movementId: id }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(run(manager, reverseStock, { entityId: 2, movementId: id })).rejects.toMatchObject(
      { code: 'forbidden' },
    );
    await run(manager, reverseStock, { entityId: 1, movementId: id, note: 'Entered in error' });
    expect(Number(await onHand(1, f.binB, f.cable))).toBe(before - 4);
    await expect(run(manager, reverseStock, { entityId: 1, movementId: id })).rejects.toMatchObject(
      { code: 'conflict', details: { reason: 'stock_already_reversed' } },
    );
    // A movement of eight days ago (the window is seven).
    const old = await run<{ movementIds: string[] }>(manager, adjustStock, {
      entityId: 1,
      itemId: f.cable,
      binId: f.binB,
      adjustment: 'gain',
      qty: '1',
      note: 'An old gain',
    });
    const oldId = old.movementIds[0] ?? '';
    await asMigrator(async (m) => {
      await m`alter table stock_movements disable trigger stock_movements_append_only`;
      await m`update stock_movements set moved_at = now() - interval '8 days' where id = ${oldId}`;
      await m`alter table stock_movements enable trigger stock_movements_append_only`;
    });
    await expect(
      run(manager, reverseStock, { entityId: 1, movementId: oldId }),
    ).rejects.toMatchObject({ details: { reason: 'stock_reversal_too_old', days: 7 } });
  });
});

describe('events', () => {
  it('reach the outbox as inventory.stock.moved, never with a cost', async () => {
    const out = await run<{ movementIds: string[] }>(manager, adjustStock, {
      entityId: 1,
      itemId: f.cable,
      binId: f.binA,
      adjustment: 'gain',
      qty: '1',
      note: 'Event check',
    });
    const events = await asOutboxPublisher(
      (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events where aggregate_id = ${out.movementIds[0] ?? ''}`,
    );
    expect(events.map((e) => e.type)).toEqual(['inventory.stock.moved']);
    expect(JSON.stringify(events[0]?.payload_json)).not.toMatch(/cost|Event check/i);
  });
});
