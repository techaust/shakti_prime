import { percentile } from '@shakti/voice';

/**
 * The arithmetic of the G2 measures (docs/03-roadmap-appendix/phase2.md §8.1): percentiles by V1's
 * nearest-rank rule (`percentile` in `@shakti/voice`, which the speech benchmark uses), the verdict
 * against a target, the open-loop send times of a load run, the check that every delivery was
 * stored once, and the report's table. Pure functions, so they are unit tested
 * (`stats.test.ts`) and the measuring commands only time and count.
 */

export interface Percentiles {
  /** Samples taken. */
  n: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

/** Milliseconds rounded to one decimal place, so a table shows 0.4 ms rather than 0. */
function roundMs(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/** p50, p95 and p99 (nearest rank), the least and the most; NaN for each when there is no sample. */
export function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) {
    return {
      n: 0,
      p50: Number.NaN,
      p95: Number.NaN,
      p99: Number.NaN,
      min: Number.NaN,
      max: Number.NaN,
    };
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    n: values.length,
    p50: roundMs(percentile(values, 50)),
    p95: roundMs(percentile(values, 95)),
    p99: roundMs(percentile(values, 99)),
    min: roundMs(min),
    max: roundMs(max),
  };
}

/** The share of samples at or under `limitMs`, from 0 to 1; NaN with no sample. */
export function shareWithin(values: readonly number[], limitMs: number): number {
  if (values.length === 0) return Number.NaN;
  return values.filter((v) => v <= limitMs).length / values.length;
}

/** Which percentile a target is read at. */
export type TargetStat = 'p50' | 'p95' | 'p99' | 'max';

export interface Target {
  stat: TargetStat;
  /** Met when the stat is at or under this. */
  limitMs: number;
}

export type Verdict = 'met' | 'missed' | 'no samples';

/** Whether a measure met its target: the named stat at or under the limit. */
export function verdict(measured: Percentiles, target: Target): Verdict {
  const value = measured[target.stat];
  if (measured.n === 0 || Number.isNaN(value)) return 'no samples';
  return value <= target.limitMs ? 'met' : 'missed';
}

/**
 * When each delivery of an open-loop run starts, in ms from the run's start: `rate` a second for
 * `seconds`, evenly spaced. Open loop means a delivery goes at its time whether or not the earlier
 * ones were answered, as a provider's deliveries do, so a slow answer cannot hide by slowing the
 * load down.
 */
export function openLoopOffsets(rate: number, seconds: number): number[] {
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError('rate and seconds must be positive numbers');
  }
  const count = Math.round(rate * seconds);
  const gap = 1000 / rate;
  return Array.from({ length: count }, (_, i) => roundMs(i * gap));
}

/**
 * How late an open-loop run sent its deliveries: the send times it kept against those it planned.
 * A load generator that cannot keep its own rate measures itself, not the server, so a run whose
 * p99 lag is large is reported as such.
 */
export function sendLag(plannedMs: readonly number[], sentMs: readonly number[]): Percentiles {
  if (plannedMs.length !== sentMs.length) {
    throw new RangeError('one send time for each planned time');
  }
  return percentiles(sentMs.map((at, i) => Math.max(0, at - (plannedMs[i] ?? at))));
}

export interface StoredOnce {
  /** Distinct deliveries sent (a repeat counts once). */
  sent: number;
  /** Of those, how many the database holds. */
  stored: number;
  /** Event ids sent and not held. */
  missing: string[];
  /** Event ids held more than once (the unique key should make this empty). */
  repeated: string[];
  /** Rows held whose event id this run never sent: another writer, or a wrong key. */
  unexpected: string[];
  ok: boolean;
}

/**
 * Whether every delivery sent was stored exactly once: `sentIds` may name an id more than once (a
 * repeated delivery), `heldIds` is one entry per stored row.
 */
export function storedOnce(sentIds: readonly string[], heldIds: readonly string[]): StoredOnce {
  const sent = new Set(sentIds);
  const counts = new Map<string, number>();
  for (const id of heldIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const missing = [...sent].filter((id) => !counts.has(id));
  const repeated = [...counts].filter(([, n]) => n > 1).map(([id]) => id);
  const unexpected = [...counts.keys()].filter((id) => !sent.has(id));
  return {
    sent: sent.size,
    stored: [...sent].filter((id) => counts.has(id)).length,
    missing,
    repeated,
    unexpected,
    ok: missing.length === 0 && repeated.length === 0 && unexpected.length === 0,
  };
}

/** A figure for a table: whole milliseconds from 10 up, one decimal below; a dash for none. */
export function formatMs(ms: number): string {
  if (Number.isNaN(ms)) return '–';
  return ms >= 10 ? String(Math.round(ms)) : ms.toFixed(1);
}

export interface TableRow {
  measure: string;
  stats: Percentiles;
  target?: Target;
  note?: string;
}

/** A Markdown table of measures: n, p50, p95, p99, max, the target and whether it was met. */
export function markdownTable(rows: readonly TableRow[]): string {
  const lines = [
    '| Measure | n | p50 ms | p95 ms | p99 ms | max ms | Target | Result |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const s = row.stats;
    const target =
      row.target === undefined ? '–' : `${row.target.stat} ≤ ${formatMs(row.target.limitMs)} ms`;
    const result = row.target === undefined ? (row.note ?? '–') : verdict(s, row.target);
    lines.push(
      `| ${row.measure} | ${String(s.n)} | ${formatMs(s.p50)} | ${formatMs(s.p95)} | ${formatMs(s.p99)} | ${formatMs(s.max)} | ${target} | ${result}${row.target !== undefined && row.note !== undefined ? `; ${row.note}` : ''} |`,
    );
  }
  return lines.join('\n');
}
