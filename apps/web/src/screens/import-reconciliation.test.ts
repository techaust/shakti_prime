import type { ImportReconciliationDto } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import { reconciliationCsv, reconciliationLines } from './import-reconciliation';

const JOB: ImportReconciliationDto = {
  jobId: '01990000-0000-7000-8000-000000000001',
  entityId: 1,
  kind: 'leads',
  state: 'committed',
  fileRows: 10,
  rowsIn: 10,
  created: 6,
  attached: 1,
  skipped: 1,
  refused: 2,
  waiting: 0,
  undone: 0,
  refusedByReason: [
    { reason: 'required', rows: 1 },
    { reason: 'phone_invalid', rows: 1 },
  ],
};

const words = en.imports.reconcile;
const label = {
  heading: { line: words.csvLine, rows: words.csvRows },
  line: (key: keyof typeof words.lines) => words.lines[key],
  reason: (reason: keyof typeof words.reasons) => words.reasons[reason],
};

describe('the reconciliation of an import', () => {
  it('lists the rows in the file first and every line after, those with none too', () => {
    const lines = reconciliationLines(JOB);
    expect(lines.map((l) => l.key)).toEqual([
      'rowsIn',
      'created',
      'attached',
      'skipped',
      'refused',
      'waiting',
      'undone',
    ]);
    // The lines after the first add up to it.
    expect(lines.slice(1).reduce((sum, l) => sum + l.rows, 0)).toBe(lines[0]?.rows);
  });

  it('writes the same lines and the reasons as a CSV file, in the catalogue’s words', () => {
    expect(reconciliationCsv(JOB, label).split('\r\n')).toEqual([
      'What happened,Rows',
      'Rows in the file,10',
      'Added as new records,6',
      'Added to records already in the list,1',
      'Repeated in the file,1',
      'Not added,2',
      '"Checked, not added yet",0',
      '"Added, then taken back",0',
      'Something required was missing,1',
      'The phone number was wrong,1',
      '',
    ]);
  });

  it('never lets a spreadsheet read a field as a formula', () => {
    const csv = reconciliationCsv(JOB, { ...label, line: () => '=SUM(A1)' });
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).not.toMatch(/(^|\n)=/);
  });
});
