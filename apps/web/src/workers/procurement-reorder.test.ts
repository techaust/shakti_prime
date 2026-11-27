import { EVENT_VERSION, newId, type DeliveredEvent } from '@shakti/contracts';
import { memoryKeyValue } from '@shakti/domain';
import { describe, expect, it, vi } from 'vitest';
import { handleStockMovedReorder, REORDER_COMMIT_LAG_MS } from './procurement-reorder';

/** A UUIDv7 made at `ms`: its first 48 bits are the time. */
function idAt(ms: number): string {
  const hex = ms.toString(16).padStart(12, '0');
  const id = newId();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}${id.slice(13)}`;
}

const BIN = newId();
const PUMP = newId();
const CABLE = newId();

function moved(at: number, lines: { itemId: string; out: boolean }[]): DeliveredEvent {
  return {
    id: idAt(at),
    sequence: '1',
    type: 'inventory.stock.moved',
    entityId: 2,
    aggregateType: 'stock_batch',
    aggregateId: newId(),
    payload: {
      v: EVENT_VERSION,
      count: lines.length,
      movements: lines.map((l) => ({
        movementId: newId(),
        itemId: l.itemId,
        fromBinId: BIN,
        toBinId: l.out ? null : newId(),
        qty: '1.000',
        reason: l.out ? 'adjust_loss' : 'transfer',
      })),
    },
  };
}

const DONE = { companies: 1, drafted: 0, itemsWithoutVendor: 0, done: true };

describe('the reorder check on a stock issue (review finding 5)', () => {
  it('runs the company’s check when an item leaves its stock, and not for a move between bins', async () => {
    const keyValue = memoryKeyValue();
    const run = vi.fn().mockResolvedValue(DONE);
    const t0 = Date.now();
    expect(
      await handleStockMovedReorder(
        moved(t0, [{ itemId: PUMP, out: false }]),
        { keyValue, requestId: 'r1' },
        run,
      ),
    ).toBe('no_issue');
    expect(run).not.toHaveBeenCalled();
    expect(
      await handleStockMovedReorder(
        moved(t0, [{ itemId: PUMP, out: true }]),
        { keyValue, requestId: 'r2' },
        run,
        () => t0 + 100,
      ),
    ).toBe('ran');
    expect(run).toHaveBeenCalledWith({ entityId: 2, requestId: 'r2' });
  });

  it('skips an event a check began after, and runs again for an issue after the check', async () => {
    const keyValue = memoryKeyValue();
    const run = vi.fn().mockResolvedValue(DONE);
    const t0 = Date.now();
    const check = (event: DeliveredEvent, at: number) =>
      handleStockMovedReorder(event, { keyValue, requestId: 'r' }, run, () => at);
    // A check begins well after the first issue was written.
    const first = moved(t0, [{ itemId: PUMP, out: true }]);
    expect(await check(first, t0 + REORDER_COMMIT_LAG_MS + 1_000)).toBe('ran');
    // The same event again (a redelivery), and an older issue of the pump: that check read them.
    expect(await check(first, t0 + 20_000)).toBe('seen');
    expect(await check(moved(t0 - 3_000, [{ itemId: PUMP, out: true }]), t0 + 20_000)).toBe('seen');
    // An issue written after the check began, or so close before it that it may not have
    // committed yet, runs the check again; so does an item no check has seen.
    expect(await check(moved(t0 + 2_000, [{ itemId: PUMP, out: true }]), t0 + 30_000)).toBe('ran');
    expect(await check(moved(t0, [{ itemId: CABLE, out: true }]), t0 + 40_000)).toBe('ran');
    expect(run).toHaveBeenCalledTimes(3);
  });
});
