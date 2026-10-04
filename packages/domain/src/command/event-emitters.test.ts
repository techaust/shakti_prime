import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeEventCatalogue, isEventType } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { commands } from './registry';

/**
 * `emittedBy` in the event catalogue (`packages/contracts/src/events/catalogue.ts`) names the
 * commands that emit each type; `docs/data/EVENTS.md` prints it. The catalogue holds it because
 * the documents' generator lives in `packages/db`, which may not import the commands; this test
 * reads the command sources and fails when the two differ.
 *
 * A command emits a type when its own source calls `ctx.emit` with it, when it calls a module
 * function outside `commands/` that does (the set-based import batch), or when it runs another
 * command that does through `ctx.run`.
 */

const src = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const EMIT = /\bemit\(\{\s*type: '([a-z_.]+)'/g;

function emitted(text: string): string[] {
  return [...text.matchAll(EMIT)].map((m) => m[1] ?? '');
}

interface Segment {
  name: string;
  exportName: string;
  text: string;
}

/** Each `defineCommand` of a file, with its source up to the next one. */
function segments(path: string): { segments: Segment[]; before: string } {
  const text = readFileSync(path, 'utf8');
  const starts = [...text.matchAll(/export const (\w+) = defineCommand\(\{\s*name: '([a-z_.]+)'/g)];
  const result = starts.map((m, i) => ({
    exportName: m[1] ?? '',
    name: m[2] ?? '',
    text: text.slice(m.index, starts[i + 1]?.index ?? text.length),
  }));
  return { segments: result, before: text.slice(0, starts[0]?.index ?? text.length) };
}

function derivedEmitters(): Map<string, Set<string>> {
  const commandFiles = files(join(src, 'commands'));
  const all = commandFiles.flatMap((path) => segments(path).segments);

  // Modules outside `commands/` that emit, by the functions they export.
  const helpers = files(src)
    .filter((path) => !relative(src, path).startsWith('commands'))
    .flatMap((path) => {
      const text = readFileSync(path, 'utf8');
      const types = emitted(text);
      if (types.length === 0) return [];
      const exported = [...text.matchAll(/export (?:async )?function (\w+)/g)].map((m) => m[1]);
      return [{ exported, types }];
    });

  const byCommand = new Map<string, Set<string>>();
  for (const segment of all) {
    const types = new Set(emitted(segment.text));
    for (const helper of helpers) {
      if (helper.exported.some((fn) => new RegExp(`\\b${fn ?? ''}\\(`).test(segment.text))) {
        for (const type of helper.types) types.add(type);
      }
    }
    byCommand.set(segment.name, types);
  }

  // `ctx.run(other, …)` emits what the other command emits, until nothing more is added.
  const byExport = new Map(all.map((s) => [s.exportName, s.name]));
  let grew = true;
  while (grew) {
    grew = false;
    for (const segment of all) {
      const own = byCommand.get(segment.name) ?? new Set<string>();
      for (const m of segment.text.matchAll(/ctx\.run\((\w+)/g)) {
        const inner = byCommand.get(byExport.get(m[1] ?? '') ?? '') ?? new Set<string>();
        for (const type of inner) {
          if (!own.has(type)) {
            own.add(type);
            grew = true;
          }
        }
      }
    }
  }

  const byType = new Map<string, Set<string>>();
  for (const [command, types] of byCommand) {
    for (const type of types) {
      byType.set(type, (byType.get(type) ?? new Set()).add(command));
    }
  }
  return byType;
}

describe('emittedBy in the event catalogue', () => {
  const catalogue = describeEventCatalogue().events;

  it('names, for every type, exactly the commands whose sources emit it', () => {
    const derived = derivedEmitters();
    for (const entry of catalogue) {
      expect([...entry.emittedBy].sort(), entry.type).toEqual(
        [...(derived.get(entry.type) ?? [])].sort(),
      );
    }
  });

  it('names only registered commands, and every emitted type is in the catalogue', () => {
    const registered = new Set(Object.keys(commands));
    for (const entry of catalogue) {
      expect(entry.emittedBy.length, entry.type).toBeGreaterThan(0);
      for (const name of entry.emittedBy) expect(registered.has(name), name).toBe(true);
    }
    for (const type of derivedEmitters().keys()) expect(isEventType(type), type).toBe(true);
  });

  it('finds every emit inside a command, not in code before the first one', () => {
    for (const path of files(join(src, 'commands'))) {
      expect(emitted(segments(path).before), relative(src, path)).toEqual([]);
    }
  });

  it('gives every type a one-line meaning', () => {
    for (const entry of catalogue) {
      expect(entry.meaning.length, entry.type).toBeGreaterThan(10);
      expect(entry.meaning, entry.type).not.toContain('\n');
    }
  });
});
