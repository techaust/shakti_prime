import type { ClaimOutbox, OutboxLeaseStore, OutboxUpdate } from './outbox-types';

/**
 * How long a run holds the rows it claimed. A run claims, calls the queue once (answered or
 * abandoned within 5 seconds) and records the outcomes, and its route may run for 60 seconds at
 * most, so a live run never outlasts its lease; a run that dies leaves rows that are due again
 * two minutes later, well inside the five minutes readiness allows.
 */
export const OUTBOX_LEASE_SECONDS = 120;

/** Rows one claim may take: the queue's batch call carries them all. */
const MAX_CLAIM = 500;

/**
 * The publisher's claim in two short transactions (docs/design/backend-weeks-3-5.md §4.2): lease
 * the due rows and commit, deliver with no transaction open, then record each outcome. Rows the
 * delivery gave no outcome are released at once; when the delivery fails as a whole or names a
 * row it did not claim, every claimed row is released unchanged and the error is raised. A run
 * whose lease has run out records nothing, because another run owns the rows by then.
 */
export function leasedClaim(
  store: OutboxLeaseStore,
  leaseSeconds = OUTBOX_LEASE_SECONDS,
): ClaimOutbox {
  return async (limit, deliver) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM) {
      throw new Error(`the claim limit is between 1 and ${String(MAX_CLAIM)}`);
    }
    const { lease, rows } = await store.lease(limit, leaseSeconds);
    if (rows.length === 0) return 0;
    const claimed = rows.map((r) => r.id);
    // The error that stopped the run matters more than a failed release; the lease runs out anyway.
    const releaseAll = () => store.record(lease, [], claimed).catch(() => 0);

    let updates: readonly OutboxUpdate[];
    try {
      updates = await deliver(rows);
    } catch (error) {
      await releaseAll();
      throw error;
    }

    const answered = new Set<string>();
    for (const u of updates) {
      const problem = !claimed.includes(u.id)
        ? 'a delivery result names a row it did not claim'
        : answered.has(u.id)
          ? 'a delivery result names a row twice'
          : undefined;
      if (problem !== undefined) {
        await releaseAll();
        throw new Error(problem);
      }
      answered.add(u.id);
    }
    await store.record(
      lease,
      updates,
      claimed.filter((id) => !answered.has(id)),
    );
    return rows.length;
  };
}
