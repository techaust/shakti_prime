// The reconciliation of one import (IMP-01, IMP-02): the lines the job page shows and the CSV the
// importer downloads, in one order, so the screen and the file always read the same. Pure, so the
// screen and its tests share it.

import type { ImportReconciliationDto, ImportRowErrorCode } from '@shakti/contracts';

/** What became of a row, in the order the screen lists them; each is a key under `imports.reconcile.lines`. */
export const RECONCILIATION_LINES = [
  'created',
  'attached',
  'skipped',
  'refused',
  'waiting',
  'undone',
] as const;
export type ReconciliationLine = (typeof RECONCILIATION_LINES)[number];

/** Every line, `rowsIn` first, those with no rows too, so the lines visibly add up. */
export function reconciliationLines(
  r: ImportReconciliationDto,
): { key: ReconciliationLine | 'rowsIn'; rows: number }[] {
  return [
    { key: 'rowsIn' as const, rows: r.rowsIn },
    ...RECONCILIATION_LINES.map((key) => ({ key, rows: r[key] })),
  ];
}

/** One CSV field: quoted when it holds a comma, a quote or a line break, and never read as a formula. */
function field(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The download: a heading row, every line, then each reason rows were not added for.
 * The words come from the message catalogue through `label`, so the file reads as the screen does.
 */
export function reconciliationCsv(
  r: ImportReconciliationDto,
  label: {
    heading: { line: string; rows: string };
    line: (key: ReconciliationLine | 'rowsIn') => string;
    reason: (reason: ImportRowErrorCode) => string;
  },
): string {
  const rows: [string, string][] = [
    [label.heading.line, label.heading.rows],
    ...reconciliationLines(r).map((line): [string, string] => [
      label.line(line.key),
      String(line.rows),
    ]),
    ...r.refusedByReason.map((x): [string, string] => [label.reason(x.reason), String(x.rows)]),
  ];
  return `${rows.map((row) => row.map(field).join(',')).join('\r\n')}\r\n`;
}
