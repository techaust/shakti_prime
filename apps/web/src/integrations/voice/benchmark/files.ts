import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ListenerMark } from './measures';
import { parseRecordedTurn, type RecordedTurn } from './replay';
import { parseMarks, parseStandInSet, type StandInSet } from './stand-in-set';

/**
 * Reading a set's folder: `set.json`, `marks.json` when the listeners have marked the turns, and
 * for a replay `turns/<item id>.json` (or another folder of recorded turns).
 */

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function readSetFolder(folder: string): { set: StandInSet; marks: ListenerMark[] } {
  const set = parseStandInSet(readJson(join(folder, 'set.json')));
  const marksPath = join(folder, 'marks.json');
  return { set, marks: existsSync(marksPath) ? parseMarks(readJson(marksPath), set) : [] };
}

export function readRecordedTurns(set: StandInSet, folder: string): Map<string, RecordedTurn> {
  return new Map(
    set.items.map((item) => [
      item.id,
      parseRecordedTurn(readJson(join(folder, `${item.id}.json`)), item.id),
    ]),
  );
}
