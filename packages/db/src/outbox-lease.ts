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

/** A generous bound on the attempts an event may have, so a slip of a caller is refused. */
const MAX_ATTEMPTS_LIMIT = 100;

/**
 * The publisher's claim in two short transactions (docs/design/backend-weeks-3-5.md §4.2): lease
 * the due rows and commit, deliver with no transaction open, then record each outcome. Rows the
 * delivery gave no outcome are released at once; when the delivery fails as a whole or names a
 * row it did not claim, every claimed row is released unchanged and the error is raised. The
 * lease counts one attempt on every row it takes and a release gives it back, so only a run that
 * dies before it records anything leaves the attempt used; a row that has had `maxAttempts` is
 * dead-lettered by the next lease, and that claim answers its id so the run counts and logs it.
 * A run whose lease has run out records nothing, because another run owns the rows by then.
 */
export function leasedClaim(
  store: OutboxLeaseStore,
  leaseSeconds = OUTBOX_LEASE_SECONDS,
): ClaimOutbox {
  return async (limit, deliver, maxAttempts, onDeadLettered) => {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLAIM) {
      throw new Error(`the claim limit is between 1 and ${String(MAX_CLAIM)}`);
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS_LIMIT) {
      throw new Error(`the attempts allowed are between 1 and ${String(MAX_ATTEMPTS_LIMIT)}`);
    }
    const { lease, rows, deadLettered } = await store.lease(limit, leaseSeconds, maxAttempts);
    // Told before anything is delivered, so a delivery that throws cannot lose them.
    if (deadLettered.length > 0) onDeadLettered?.(deadLettered);
    if (rows.length === 0) return { claimed: 0, deadLettered };
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
    return { claimed: rows.length, deadLettered };
  };
}
