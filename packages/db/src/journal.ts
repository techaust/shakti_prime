import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export function readJournal(migrationsFolder: string): JournalEntry[] {
  const raw = JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };
  return raw.entries;
}

/**
 * Problems that would make the migrator skip or misapply a migration (AUDIT M22): Drizzle
 * applies an entry only when its `when` is newer than the last one applied, so an entry that
 * sorts out of order, a gap in the numbering or a missing file would pass CI on a fresh
 * database and be skipped on every existing one.
 */
export function journalProblems(
  entries: readonly JournalEntry[],
  files: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  entries.forEach((entry, i) => {
    if (entry.idx !== i)
      problems.push(`${entry.tag}: idx ${String(entry.idx)} should be ${String(i)}`);
    const previous = entries[i - 1];
    if (previous !== undefined && entry.when <= previous.when) {
      problems.push(
        `${entry.tag}: its time is not after ${previous.tag}; rebase it with a new time`,
      );
    }
    if (!files.has(`${entry.tag}.sql`)) problems.push(`${entry.tag}: the .sql file is missing`);
  });
  for (const file of files) {
    if (!entries.some((e) => `${e.tag}.sql` === file)) problems.push(`${file}: not in the journal`);
  }
  return problems;
}

/** The hash Drizzle records for an applied migration: SHA-256 of the file's text. */
export function migrationHash(migrationsFolder: string, tag: string): string {
  return createHash('sha256')
    .update(readFileSync(join(migrationsFolder, `${tag}.sql`), 'utf8'))
    .digest('hex');
}
