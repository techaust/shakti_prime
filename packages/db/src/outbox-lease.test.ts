import { describe, expect, it } from 'vitest';
import { leasedClaim, OUTBOX_LEASE_SECONDS } from './outbox-lease';
import type { OutboxLeaseStore, OutboxRow, OutboxUpdate } from './outbox-types';

let sequence = 0;
function row(): OutboxRow {
  sequence += 1;
  return {
    id: `00000000-0000-7000-8000-${String(sequence).padStart(12, '0')}`,
    sequence: String(sequence),
    entityId: 1,
    type: 'crm.lead.created',
    aggregateType: 'opportunity',
    aggregateId: 'a',
    payload: { v: 1 },
    attempts: 0,
    createdAt: new Date(),
  };
}

/**
 * A store that records each call in order and whether a transaction was open, so a test can see
 * that nothing was held while the rows were being delivered.
 */
function memoryStore(rows: OutboxRow[], options: { failRecord?: boolean } = {}) {
  const log: string[] = [];
  const recorded: { lease: string; updates: readonly OutboxUpdate[]; release: string[] }[] = [];
  let open = false;
  let leases = 0;
  const seen: { limit?: number; leaseSeconds?: number; maxAttempts?: number } = {};
  const store: OutboxLeaseStore = {
    async lease(limit, leaseSeconds, maxAttempts) {
      open = true;
      log.push('lease');
      seen.limit = limit;
      seen.leaseSeconds = leaseSeconds;
      seen.maxAttempts = maxAttempts;
      await Promise.resolve();
      open = false;
      leases += 1;
      return { lease: `lease-${String(leases)}`, rows: rows.slice(0, limit) };
    },
    async record(lease, updates, release) {
      open = true;
      log.push('record');
      await Promise.resolve();
      open = false;
      if (options.failRecord === true) throw new Error('the database went away');
      recorded.push({ lease, updates, release: [...release] });
      return updates.length + release.length;
    },
  };
  return { store, log, recorded, seen, isOpen: () => open };
}

/** The publisher's allowance of attempts (OUTBOX_MAX_ATTEMPTS in @shakti/domain). */
const MAX_ATTEMPTS = 10;

/** The claim as the publisher calls it, with its allowance of attempts. */
function claimWith(store: OutboxLeaseStore, leaseSeconds?: number) {
  const claim = leasedClaim(store, leaseSeconds);
  return (limit: number, deliver: Parameters<typeof claim>[1]) =>
    claim(limit, deliver, MAX_ATTEMPTS);
}

const publishedAll = (rows: readonly OutboxRow[]): OutboxUpdate[] =>
  rows.map((r) => ({ id: r.id, outcome: 'published' }));

describe('leasedClaim: the publisher run in two short transactions', () => {
  it('commits the lease, delivers with nothing open, then records every outcome under that lease', async () => {
    const rows = [row(), row()];
    const m = memoryStore(rows);
    let openWhileDelivering: boolean | undefined;
    const claimed = await claimWith(m.store)(100, (given) => {
      m.log.push('deliver');
      openWhileDelivering = m.isOpen();
      return Promise.resolve(publishedAll(given));
    });
    expect(claimed).toBe(2);
    expect(m.log).toEqual(['lease', 'deliver', 'record']);
    expect(openWhileDelivering).toBe(false);
    expect(m.seen).toEqual({
      limit: 100,
      leaseSeconds: OUTBOX_LEASE_SECONDS,
      maxAttempts: MAX_ATTEMPTS,
    });
    expect(m.recorded).toEqual([{ lease: 'lease-1', updates: publishedAll(rows), release: [] }]);
  });

  it('records a failure with its backoff and releases a row given no outcome', async () => {
    const rows = [row(), row()];
    const [failed, silent] = rows;
    const m = memoryStore(rows);
    const failure: OutboxUpdate = {
      id: failed?.id ?? '',
      outcome: 'failed',
      attempts: 1,
      lastError: 'http_503',
      deadLetter: false,
      retryInSeconds: 60,
    };
    await claimWith(m.store)(10, () => Promise.resolve([failure]));
    expect(m.recorded).toEqual([{ lease: 'lease-1', updates: [failure], release: [silent?.id] }]);
  });

  it('neither delivers nor records when nothing is due', async () => {
    const m = memoryStore([]);
    let delivered = false;
    const claimed = await claimWith(m.store)(10, () => {
      delivered = true;
      return Promise.resolve([]);
    });
    expect(claimed).toBe(0);
    expect(delivered).toBe(false);
    expect(m.log).toEqual(['lease']);
  });

  it('releases every claimed row unchanged and raises when the delivery fails as a whole', async () => {
    const rows = [row(), row()];
    const m = memoryStore(rows);
    await expect(
      claimWith(m.store)(10, () => Promise.reject(new Error('the run was cut short'))),
    ).rejects.toThrow('the run was cut short');
    expect(m.recorded).toEqual([{ lease: 'lease-1', updates: [], release: rows.map((r) => r.id) }]);
  });

  it('keeps the delivery error when the release fails too; the lease runs out on its own', async () => {
    const m = memoryStore([row()], { failRecord: true });
    await expect(
      claimWith(m.store)(10, () => Promise.reject(new Error('the run was cut short'))),
    ).rejects.toThrow('the run was cut short');
  });

  it('refuses an outcome for a row it did not claim, or two for one row, and records none', async () => {
    const rows = [row()];
    const m1 = memoryStore(rows);
    await expect(
      claimWith(m1.store)(10, () =>
        Promise.resolve([{ id: 'someone-else', outcome: 'published' as const }]),
      ),
    ).rejects.toThrow(/did not claim/);
    expect(m1.recorded).toEqual([{ lease: 'lease-1', updates: [], release: [rows[0]?.id] }]);

    const m2 = memoryStore(rows);
    await expect(
      claimWith(m2.store)(10, (given) =>
        Promise.resolve([...publishedAll(given), ...publishedAll(given)]),
      ),
    ).rejects.toThrow(/twice/);
    expect(m2.recorded).toEqual([{ lease: 'lease-1', updates: [], release: [rows[0]?.id] }]);
  });

  it('refuses a limit outside 1 to 500 before touching the store', async () => {
    const m = memoryStore([row()]);
    const claim = claimWith(m.store);
    for (const limit of [0, 501, 1.5]) {
      await expect(claim(limit, () => Promise.resolve([]))).rejects.toThrow(/between 1 and 500/);
    }
    expect(m.log).toEqual([]);
  });

  it('refuses an allowance of attempts outside 1 to 100 before touching the store', async () => {
    const m = memoryStore([row()]);
    const claim = leasedClaim(m.store);
    for (const maxAttempts of [0, 101, 2.5, Number.NaN]) {
      await expect(claim(1, () => Promise.resolve([]), maxAttempts)).rejects.toThrow(
        /between 1 and 100/,
      );
    }
    expect(m.log).toEqual([]);
  });

  it('passes its own lease length to the store', async () => {
    const m = memoryStore([row()]);
    await claimWith(m.store, 5)(1, (given) => Promise.resolve(publishedAll(given)));
    expect(m.seen.leaseSeconds).toBe(5);
  });
});
