import { describe, expect, it } from 'vitest';
import {
  checkBatch,
  connectorHealth,
  diffSnapshot,
  HEARTBEAT_SILENCE_MS,
  shouldAlertSilence,
  type StoredVoucher,
} from './sync-rules';

const guid = (n: number) => `a1b2c3d4-0000-0000-0000-${String(n).padStart(12, '0')}-00000001`;

describe('checkBatch', () => {
  it('moves the cursor to the batch maximum and keeps the newest version of each voucher', () => {
    const result = checkBatch(100, {
      maxAlterId: 130,
      vouchers: [
        { guid: guid(1), alterId: 120 },
        { guid: guid(2), alterId: 95 },
        { guid: guid(1), alterId: 125 },
        { guid: guid(3), alterId: 101 },
      ],
    });
    expect(result).toEqual({
      ok: true,
      outcome: {
        cursor: 130,
        fresh: [
          { guid: guid(3), alterId: 101 },
          { guid: guid(1), alterId: 125 },
        ],
        stale: [guid(2)],
      },
    });
  });

  it('treats a resent batch as all stale and leaves the cursor', () => {
    const vouchers = [{ guid: guid(1), alterId: 120 }];
    const result = checkBatch(130, { maxAlterId: 130, vouchers });
    expect(result).toEqual({ ok: true, outcome: { cursor: 130, fresh: [], stale: [guid(1)] } });
  });

  it('refuses a batch that goes backwards, or a voucher above the batch maximum or without a GUID', () => {
    expect(checkBatch(200, { maxAlterId: 150, vouchers: [] })).toEqual({
      ok: false,
      problem: 'batch_max_below_cursor',
    });
    expect(
      checkBatch(0, { maxAlterId: 10, vouchers: [{ guid: guid(1), alterId: 11 }] }),
    ).toMatchObject({ ok: false, problem: 'alter_id_above_batch_max' });
    expect(checkBatch(0, { maxAlterId: 10, vouchers: [{ guid: ' ', alterId: 5 }] })).toMatchObject({
      ok: false,
      problem: 'empty_guid',
    });
  });
});

describe('diffSnapshot', () => {
  const asOf = new Date('2026-09-28T18:30:00Z');
  const before = new Date('2026-09-27T10:00:00Z');
  const after = new Date('2026-09-28T19:00:00Z');
  const stored = (n: number, extra: Partial<StoredVoucher> = {}): StoredVoucher => ({
    guid: guid(n),
    receivedAt: before,
    tombstoned: false,
    ...extra,
  });

  it('tombstones stored vouchers Tally no longer holds, and lists what the BOS never received', () => {
    const result = diffSnapshot([stored(1), stored(2), stored(3)], {
      voucherGuids: [guid(1), guid(3), guid(9)],
      asOf,
    });
    expect(result).toEqual({
      ok: true,
      diff: { tombstones: [guid(2)], missing: [guid(9)], reappeared: [] },
    });
  });

  it('keeps a voucher that arrived after the snapshot was taken', () => {
    const result = diffSnapshot([stored(1), stored(2, { receivedAt: after })], {
      voucherGuids: [guid(1)],
      asOf,
    });
    expect(result).toMatchObject({ ok: true, diff: { tombstones: [] } });
  });

  it('does not tombstone twice, and reports a tombstoned voucher that came back', () => {
    const result = diffSnapshot(
      [stored(1), stored(2, { tombstoned: true }), stored(3, { tombstoned: true })],
      { voucherGuids: [guid(1), guid(3)], asOf },
    );
    expect(result).toEqual({
      ok: true,
      diff: { tombstones: [], missing: [], reappeared: [guid(3)] },
    });
  });

  it('refuses a snapshot that would remove most of the company', () => {
    const many = Array.from({ length: 200 }, (_, i) => stored(i + 1));
    const result = diffSnapshot(many, { voucherGuids: [], asOf });
    expect(result).toEqual({
      ok: false,
      problem: 'snapshot_would_remove_too_much',
      wouldRemove: 200,
      live: 200,
    });
  });

  it('lets a small company lose a handful of vouchers in a day', () => {
    const few = Array.from({ length: 10 }, (_, i) => stored(i + 1));
    const result = diffSnapshot(few, { voucherGuids: [guid(1)], asOf });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.diff.tombstones).toHaveLength(9);
  });
});

describe('heartbeat', () => {
  const now = new Date('2026-09-28T10:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it('is ok, late after two missed beats, silent at thirty minutes', () => {
    expect(connectorHealth(undefined, now)).toBe('never_seen');
    expect(connectorHealth(ago(4 * 60_000), now)).toBe('ok');
    expect(connectorHealth(ago(10 * 60_000), now)).toBe('ok');
    expect(connectorHealth(ago(11 * 60_000), now)).toBe('late');
    expect(connectorHealth(ago(HEARTBEAT_SILENCE_MS - 1), now)).toBe('late');
    expect(connectorHealth(ago(HEARTBEAT_SILENCE_MS), now)).toBe('silent');
  });

  it('alerts once per silence, and again after the connector returns and falls silent', () => {
    const last = ago(HEARTBEAT_SILENCE_MS + 60_000);
    expect(shouldAlertSilence(last, undefined, now)).toBe(true);
    expect(shouldAlertSilence(last, ago(30_000), now)).toBe(false);
    expect(shouldAlertSilence(last, ago(2 * HEARTBEAT_SILENCE_MS), now)).toBe(true);
    expect(shouldAlertSilence(ago(60_000), undefined, now)).toBe(false);
    expect(shouldAlertSilence(undefined, undefined, now)).toBe(false);
  });
});
