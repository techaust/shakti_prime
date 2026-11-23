import { DomainError, newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { archiveBin, archiveHub } from '../../src/commands/inventory/hubs';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { seededGenerator } from '../../src/seeded-generator';
import { stockMove, type StockMoveLine } from '../../src/stock/move';
import { onHand, serialOf, stockFixture, type StockFixture } from './stock-fixture';

afterAll(closeDb);

/** A refusal's catalogue reason, else its code. */
function refusalOf(e: DomainError): string {
  const reason = e.details?.reason;
  return typeof reason === 'string' ? reason : e.code;
}

/**
 * Concurrent writers (docs/03-roadmap-appendix/phase3.md §6.2): two issues of the last unit leave
 * one refused; two moves of one serial leave it in one bin; writers crossing the same bins and
 * items in opposite orders never deadlock, since every path locks in one order; and a bin or hub
 * archived while a gain into it waits leaves one of the two refused, never an archived bin holding
 * stock.
 */

let f: StockFixture;
let manager: Principal;
let exec: Principal;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Posts `lines` in a transaction that stays open `holdMs` after the definer answers, so a second
 * writer started meanwhile has to wait for its locks.
 */
function postAndHold(lines: readonly StockMoveLine[], holdMs: number): Promise<string[]> {
  return asPrincipal(manager, async ({ tx }) => {
    const ids = await stockMove(tx, lines);
    await tx.execute(sql`select pg_sleep(${holdMs / 1000})`);
    return ids;
  });
}

function reasonOf(result: PromiseSettledResult<unknown>): string | undefined {
  if (result.status === 'fulfilled') return undefined;
  const e: unknown = result.reason;
  return e instanceof DomainError ? refusalOf(e) : String(e);
}

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager', [1]);
  exec = await createTestPrincipal('executive');
  f = await stockFixture(exec.id);
});

describe('concurrent writers', () => {
  it('two concurrent issues of the last unit leave one refused', async () => {
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '1' },
      ]),
    );
    const loss: StockMoveLine = {
      reason: 'adjust_loss',
      entityId: 1,
      itemId: f.cable,
      fromBinId: f.binA,
      qty: '1',
    };
    const results = await Promise.allSettled([
      postAndHold([loss], 400),
      pause(100).then(() => postAndHold([loss], 0)),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(results.map(reasonOf).filter(Boolean)).toEqual(['stock_insufficient']);
    expect(await onHand(1, f.binA, f.cable)).toBe('0.000');
  });

  it('two concurrent moves of one serial leave it in one bin', async () => {
    const serialNo = `CC-${f.tag}-1`;
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.pump, toBinId: f.binA, qty: '1', serialNo },
      ]),
    );
    const to = (bin: string): StockMoveLine => ({
      reason: 'transfer',
      entityId: 1,
      itemId: f.pump,
      fromBinId: f.binA,
      toBinId: bin,
      qty: '1',
      serialNo,
    });
    const results = await Promise.allSettled([
      postAndHold([to(f.binB)], 400),
      pause(100).then(() => postAndHold([to(f.dispatch)], 0)),
    ]);
    expect(results.map(reasonOf).filter(Boolean)).toEqual(['stock_serial_not_in_bin']);
    expect(await serialOf(f.pump, serialNo)).toMatchObject({ state: 'in_stock', binId: f.binB });
    expect(await onHand(1, f.binB, f.pump)).toBe('1.000');
    expect(await onHand(1, f.dispatch, f.pump)).toBe('0.000');
  });

  it('writers crossing the same bins in opposite orders never deadlock', async () => {
    await asPrincipal(manager, ({ tx }) =>
      stockMove(tx, [
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binA, qty: '500' },
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.binB, qty: '500' },
        { reason: 'adjust_gain', entityId: 1, itemId: f.cable, toBinId: f.receiving, qty: '500' },
      ]),
    );
    const bins = [f.binA, f.binB, f.receiving];
    const worker = async (seed: number) => {
      const random = seededGenerator(seed);
      const outcomes: string[] = [];
      for (let i = 0; i < 15; i += 1) {
        // Each batch walks the bins in its own order, both ways, so two batches cross.
        const order = random.chance() ? bins : [...bins].reverse();
        const batch: StockMoveLine[] = order.slice(0, -1).map((from, k) => ({
          reason: 'transfer',
          entityId: 1,
          itemId: f.cable,
          fromBinId: from,
          toBinId: order[k + 1] ?? from,
          qty: String(random.int(1, 30)),
        }));
        try {
          await asPrincipal(manager, ({ tx }) => stockMove(tx, batch));
          outcomes.push('ok');
        } catch (e) {
          outcomes.push(e instanceof DomainError ? refusalOf(e) : String(e));
        }
      }
      return outcomes;
    };
    const outcomes = (await Promise.all([1, 2, 3, 4, 5, 6].map(worker))).flat();
    expect(outcomes.filter((o) => o !== 'ok' && o !== 'stock_insufficient')).toEqual([]);
    expect(outcomes.filter((o) => o === 'ok').length).toBeGreaterThan(60);
    const differ = await asPrincipal(
      principalFor('system:workers'),
      async ({ tx }) =>
        (await tx.execute(sql`
        select count(*)::int as n from app.stock_balance_check() c where c.item_id = ${f.cable}`)) as unknown as {
          n: number;
        }[],
    );
    expect(differ[0]?.n).toBe(0);
    const total = (await Promise.all(bins.map((b) => onHand(1, b, f.cable)))).reduce(
      (sum, q) => sum + Number(q),
      0,
    );
    expect(total).toBe(1500);
  });

  describe('an archive while a gain into the bin waits (review probe A)', () => {
    /** A fresh godown with one storage bin whose balance of the cable exists at zero. */
    async function emptiedBin(): Promise<{ hubId: string; binId: string }> {
      const hubId = newId();
      const binId = newId();
      const hubCode = `AR${f.tag}${hubId.slice(-4).toUpperCase()}`;
      await asMigrator((m) =>
        m.begin(async (tx) => {
          await tx`insert into warehouses (id, code, name, kind, state_code, pin_code, created_by)
            values (${hubId}, ${hubCode}, ${`Archive race ${hubCode}`}, 'godown', '08', '302003', ${exec.id})`;
          await tx`insert into bins (id, warehouse_id, code, kind, created_by)
            values (${binId}, ${hubId}, 'S1', 'storage', ${exec.id})`;
        }),
      );
      await asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          {
            reason: 'adjust_gain',
            entityId: 1,
            itemId: f.cable,
            toBinId: binId,
            qty: '1',
            unitCost: '10.0000',
          },
        ]),
      );
      await asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          { reason: 'adjust_loss', entityId: 1, itemId: f.cable, fromBinId: binId, qty: '1' },
        ]),
      );
      return { hubId, binId };
    }

    /**
     * The probe: the item's average row is held, so a gain into the bin takes its hub and bin
     * locks and then waits; the archive starts meanwhile; the average is let go.
     */
    async function race(
      binId: string,
      archive: () => Promise<unknown>,
    ): Promise<[PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]> {
      let held: () => void = () => undefined;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const holder = asMigrator((m) =>
        m.begin(async (tx) => {
          await tx`select 1 from item_costs where entity_id = 1 and item_id = ${f.cable} for update`;
          held();
          await tx`select pg_sleep(0.6)`;
        }),
      );
      await holding;
      const gain = asPrincipal(manager, ({ tx }) =>
        stockMove(tx, [
          {
            reason: 'adjust_gain',
            entityId: 1,
            itemId: f.cable,
            toBinId: binId,
            qty: '4',
            unitCost: '10.0000',
          },
        ]),
      );
      const archived = pause(200).then(archive);
      const results = await Promise.allSettled([gain, archived]);
      await holder;
      return [results[0], results[1]] as [
        PromiseSettledResult<unknown>,
        PromiseSettledResult<unknown>,
      ];
    }

    function asExec(command: AnyCommand, input: unknown): Promise<unknown> {
      return asPrincipal(exec, (context) => runCommand(command, { context, audit, outbox }, input));
    }

    async function binState(binId: string): Promise<{ archived: boolean; hubArchived: boolean }> {
      const [row] = await asMigrator(
        (m) => m<{ archived: boolean; hubArchived: boolean }[]>`
          select b.archived_at is not null as archived, w.archived_at is not null as "hubArchived"
            from bins b join warehouses w on w.id = b.warehouse_id where b.id = ${binId}`,
      );
      return row ?? { archived: false, hubArchived: false };
    }

    it('archiving the bin: one of the two is refused, and no archived bin holds stock', async () => {
      const { binId } = await emptiedBin();
      const [gain, archive] = await race(binId, () => asExec(archiveBin, { binId }));
      const refused = [reasonOf(gain), reasonOf(archive)].filter(Boolean);
      expect(refused).toHaveLength(1);
      // The gain locked the bin first, so the archive waits for it and finds stock.
      expect(gain.status).toBe('fulfilled');
      expect(refused).toEqual(['bin_holds_stock']);
      const state = await binState(binId);
      expect(state.archived && Number(await onHand(1, binId, f.cable)) > 0).toBe(false);
      expect(await onHand(1, binId, f.cable)).toBe('4.000');
    });

    it('archiving the hub: one of the two is refused, and no archived hub holds stock', async () => {
      const { hubId, binId } = await emptiedBin();
      const [gain, archive] = await race(binId, () => asExec(archiveHub, { hubId }));
      const refused = [reasonOf(gain), reasonOf(archive)].filter(Boolean);
      expect(refused).toHaveLength(1);
      expect(gain.status).toBe('fulfilled');
      expect(refused).toEqual(['hub_holds_stock']);
      const state = await binState(binId);
      expect(
        (state.archived || state.hubArchived) && Number(await onHand(1, binId, f.cable)) > 0,
      ).toBe(false);
    });

    it('a gain into a bin archived while the gain waited is refused', async () => {
      const { binId } = await emptiedBin();
      // The archive holds the bin first; the gain waits for it and then finds the bin archived.
      const archived = asPrincipal(exec, async (context) => {
        const out = await runCommand(archiveBin, { context, audit, outbox }, { binId });
        await context.tx.execute(sql`select pg_sleep(0.4)`);
        return out;
      });
      const gain = pause(150).then(() =>
        asPrincipal(manager, ({ tx }) =>
          stockMove(tx, [
            {
              reason: 'adjust_gain',
              entityId: 1,
              itemId: f.cable,
              toBinId: binId,
              qty: '4',
              unitCost: '10.0000',
            },
          ]),
        ),
      );
      const results = await Promise.allSettled([archived, gain]);
      expect(results.map(reasonOf)).toEqual([undefined, 'stock_bin_archived']);
      expect(await binState(binId)).toMatchObject({ archived: true });
      expect(await onHand(1, binId, f.cable)).toBe('0.000');
    });
  });
});
