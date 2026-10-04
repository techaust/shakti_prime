import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
