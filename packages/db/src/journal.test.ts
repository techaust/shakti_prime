import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { journalProblems, readJournal } from './journal';

const folder = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

describe('the migration journal (AUDIT M22)', () => {
  it('is contiguous, strictly ordered in time and matches the files on disk', () => {
    const files = new Set(readdirSync(folder).filter((f) => f.endsWith('.sql')));
    expect(journalProblems(readJournal(folder), files)).toEqual([]);
  });

  it('reports an out-of-order time, a gap and a missing or unlisted file', () => {
    const entries = [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 2, when: 90, tag: '0001_b' },
    ];
    expect(journalProblems(entries, new Set(['0000_a.sql', '0002_c.sql']))).toEqual([
      '0001_b: idx 2 should be 1',
      '0001_b: its time is not after 0000_a; rebase it with a new time',
      '0001_b: the .sql file is missing',
      '0002_c.sql: not in the journal',
    ]);
  });
});
