import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schema } from '@shakti/db';
import { getTableColumns, getTableName, isTable, type Table } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { MACHINES, MACHINES_IN_USE } from './registry';

const commands = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');

function sources(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [readFileSync(path, 'utf8')] : [];
  });
}

/** The machine modules a command imports values from, beside `transition()` itself. */
function drivenMachines(): Set<string> {
  const driven = new Set<string>();
  for (const text of sources(commands)) {
    if (
      !/import \{[^}]*\btransition\b[^}]*\} from '[./]+\/state-machines\/define-machine'/.test(text)
    ) {
      continue;
    }
    for (const m of text.matchAll(
      /import \{[^}]*\} from '[./]+\/state-machines\/machines\/([a-z-]+)'/g,
    )) {
      driven.add((m[1] ?? '').replaceAll('-', '_'));
    }
  }
  return driven;
}

describe('MACHINES_IN_USE', () => {
  it('names exactly the machines whose module a command imports to call transition()', () => {
    expect([...drivenMachines()].sort()).toEqual([...MACHINES_IN_USE].sort());
  });

  it('names only registered machines', () => {
    const names = new Set(MACHINES.map((m) => m.name));
    for (const name of MACHINES_IN_USE) expect(names.has(name)).toBe(true);
  });
});

/** The column names of every table in the schema, by the table's SQL name. */
function schemaColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!isTable(value)) continue;
    const columns = Object.values(getTableColumns(value as Table)).map((c) => c.name);
    tables.set(getTableName(value as Table), new Set(columns));
  }
  return tables;
}

describe('where a built machine keeps its state', () => {
  const tables = schemaColumns();

  it('is named exactly for the machines a command drives', () => {
    const stored = MACHINES.filter((m) => m.stored !== undefined).map((m) => m.name);
    expect(stored.sort()).toEqual([...MACHINES_IN_USE].sort());
  });

  it.each(MACHINES.filter((m) => m.stored !== undefined).map((m) => [m.name, m] as const))(
    '%s names a table and columns the schema has',
    (_name, machine) => {
      const stored = machine.stored;
      if (stored === undefined) throw new Error('unreachable');
      const columns = tables.get(stored.table);
      expect(columns, stored.table).toBeDefined();
      expect(columns?.has(stored.stateColumn)).toBe(true);
      if (stored.changedAtColumn !== undefined) {
        expect(columns?.has(stored.changedAtColumn)).toBe(true);
      }
    },
  );

  it('leaves the change time out only where the table has no state_changed_at', () => {
    for (const machine of MACHINES) {
      const stored = machine.stored;
      if (stored === undefined) continue;
      const hasColumn = tables.get(stored.table)?.has('state_changed_at') === true;
      expect(stored.changedAtColumn === 'state_changed_at', machine.name).toBe(hasColumn);
    }
  });
});
