import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MACHINES } from './registry';
import { renderAll, renderMachine } from './render';

const docs = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/state-machines');

describe('the committed state-machine documents', () => {
  const files = renderAll();

  it('are exactly the generated set (run `pnpm --filter @shakti/domain machines:docs`)', () => {
    const committed = readdirSync(docs).filter((name) => name.endsWith('.md'));
    expect(committed.sort()).toEqual([...files.keys()].sort());
  });

  it.each([...files.keys()])('%s is up to date', (name) => {
    expect(readFileSync(join(docs, name), 'utf8')).toBe(files.get(name));
  });
});

describe('renderMachine', () => {
  it('draws every transition and every terminal state', () => {
    for (const machine of MACHINES) {
      const doc = renderMachine(machine);
      expect(doc).toContain('stateDiagram-v2');
      expect(doc).toContain(machine.illegalReason);
      for (const t of machine.transitions) {
        const froms = t.from === 'new' ? ['[*]'] : t.from;
        for (const from of froms) expect(doc).toContain(`  ${from} --> ${t.to} : ${t.event}`);
      }
      for (const state of machine.terminal) expect(doc).toContain(`  ${state} --> [*]`);
    }
  });
});
