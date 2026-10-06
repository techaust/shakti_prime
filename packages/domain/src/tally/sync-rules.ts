/**
 * The BOS side of the Tally connector (BLUEPRINT §8.8, docs/06-api.md §3.5): which vouchers of a batch
 * move the cursor, which stored vouchers the daily GUID snapshot turns into tombstones, and when a
 * silent connector raises an alert. Pure functions; the Phase 5 tables that hold vouchers,
 * tombstones and heartbeats do not exist yet, so nothing here reads or writes the database.
 */

/** The connector sends a heartbeat every 5 minutes. */
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
/** Thirty minutes without one raises an alert (BLUEPRINT §8.8). */
export const HEARTBEAT_SILENCE_MS = 30 * 60_000;

// ---- Batches ----

export interface BatchVoucherRef {
  guid: string;
  alterId: number;
}

export interface BatchOutcome {
  /** The company's cursor after this batch: never moves backwards. */
  cursor: number;
  /** Vouchers newer than the cursor, one per GUID (the highest AlterID wins within the batch). */
  fresh: BatchVoucherRef[];
  /** GUIDs at or below the cursor: already applied at that version or later, so skipped. */
  stale: string[];
}

export type BatchCheck =
  | { ok: true; outcome: BatchOutcome }
  | { ok: false; problem: 'alter_id_above_batch_max' | 'batch_max_below_cursor' | 'empty_guid' };

/**
 * Applies the AlterID rule to one batch of a company. Tally raises a voucher's AlterID on every
 * change, so a GUID seen again with a higher AlterID is an edit, and one at or below the cursor is
 * a resend of something already applied. A batch whose `maxAlterId` is below the stored cursor is
 * refused: the connector's state went backwards (a restored Tally company or a copied data folder)
 * and needs a person to look.
 */
export function checkBatch(
  cursor: number,
  batch: { maxAlterId: number; vouchers: readonly BatchVoucherRef[] },
): BatchCheck {
  if (batch.maxAlterId < cursor) return { ok: false, problem: 'batch_max_below_cursor' };
  const latest = new Map<string, BatchVoucherRef>();
  for (const voucher of batch.vouchers) {
    if (voucher.guid.trim() === '') return { ok: false, problem: 'empty_guid' };
    if (voucher.alterId > batch.maxAlterId)
      return { ok: false, problem: 'alter_id_above_batch_max' };
    const seen = latest.get(voucher.guid);
    if (seen === undefined || voucher.alterId > seen.alterId) latest.set(voucher.guid, voucher);
  }
  const fresh: BatchVoucherRef[] = [];
  const stale: string[] = [];
  for (const voucher of latest.values()) {
    if (voucher.alterId > cursor) fresh.push(voucher);
    else stale.push(voucher.guid);
  }
  fresh.sort((a, b) => a.alterId - b.alterId);
  return { ok: true, outcome: { cursor: Math.max(cursor, batch.maxAlterId), fresh, stale } };
}

// ---- Daily GUID snapshot ----

export interface StoredVoucher {
  guid: string;
  /** When the BOS first stored the voucher; one stored after the snapshot was taken is kept. */
  receivedAt: Date;
  /** Already a tombstone. */
  tombstoned: boolean;
}

export interface SnapshotDiff {
  /** Stored, live, older than the snapshot and absent from it: deleted or cancelled in Tally. */
  tombstones: string[];
  /** In the snapshot but never received: the connector should send them again. */
  missing: string[];
  /** Tombstoned earlier but back in the snapshot: restored in Tally; goes to the review queue. */
  reappeared: string[];
}

export type SnapshotCheck =
  | { ok: true; diff: SnapshotDiff }
  | { ok: false; problem: 'snapshot_would_remove_too_much'; wouldRemove: number; live: number };

export interface SnapshotLimits {
  /** A snapshot that would tombstone more than this share of the live vouchers is refused. */
  maxShare: number;
  /** ... unless it would tombstone at most this many, which small companies may do on a busy day. */
  alwaysAllow: number;
}

/**
 * A snapshot that would wipe out most of a company is far more likely to be the wrong company, an
 * empty export or a Tally error than a real mass deletion; a person confirms it instead.
 */
export const DEFAULT_SNAPSHOT_LIMITS: SnapshotLimits = { maxShare: 0.1, alwaysAllow: 20 };

/** Compares the stored vouchers of a company with the GUIDs Tally holds at `asOf`. */
export function diffSnapshot(
  stored: readonly StoredVoucher[],
  snapshot: { voucherGuids: readonly string[]; asOf: Date },
  limits: SnapshotLimits = DEFAULT_SNAPSHOT_LIMITS,
): SnapshotCheck {
  const inTally = new Set(snapshot.voucherGuids);
  const known = new Set<string>();
  const tombstones: string[] = [];
  const reappeared: string[] = [];
  let live = 0;
  for (const voucher of stored) {
    known.add(voucher.guid);
    if (voucher.tombstoned) {
      if (inTally.has(voucher.guid)) reappeared.push(voucher.guid);
      continue;
    }
    live += 1;
    // A voucher that reached the BOS after Tally took the snapshot is simply newer than it.
    if (voucher.receivedAt > snapshot.asOf) continue;
    if (!inTally.has(voucher.guid)) tombstones.push(voucher.guid);
  }
  const missing = [...inTally].filter((guid) => !known.has(guid));
  if (tombstones.length > limits.alwaysAllow && tombstones.length > live * limits.maxShare) {
    return {
      ok: false,
      problem: 'snapshot_would_remove_too_much',
      wouldRemove: tombstones.length,
      live,
    };
  }
  return {
    ok: true,
    diff: { tombstones: tombstones.sort(), missing: missing.sort(), reappeared: reappeared.sort() },
  };
}

// ---- Heartbeat ----

export type ConnectorHealth = 'ok' | 'late' | 'silent' | 'never_seen';

/**
 * A connector is `late` after two missed heartbeats and `silent` after thirty minutes, which is
 * when the alert goes out.
 */
export function connectorHealth(lastHeartbeatAt: Date | undefined, now: Date): ConnectorHealth {
  if (lastHeartbeatAt === undefined) return 'never_seen';
  const quiet = now.getTime() - lastHeartbeatAt.getTime();
  if (quiet >= HEARTBEAT_SILENCE_MS) return 'silent';
  if (quiet > 2 * HEARTBEAT_INTERVAL_MS) return 'late';
  return 'ok';
}

/**
 * One alert per silence: raised when the connector has been silent for thirty minutes and no alert
 * has gone out since its last heartbeat. A connector that comes back and falls silent again gets a
 * new alert.
 */
export function shouldAlertSilence(
  lastHeartbeatAt: Date | undefined,
  lastAlertAt: Date | undefined,
  now: Date,
): boolean {
  if (connectorHealth(lastHeartbeatAt, now) !== 'silent' || lastHeartbeatAt === undefined) {
    return false;
  }
  return lastAlertAt === undefined || lastAlertAt < lastHeartbeatAt;
}
