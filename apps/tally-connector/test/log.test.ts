import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileLog, errorKind, logId } from '../src/log';
import { tempDir } from './harness';

let dir: ReturnType<typeof tempDir> = { dir: '', remove: () => undefined };
afterEach(() => {
  dir.remove();
});

describe('the log', () => {
  it('lets ids through and withholds anything else', () => {
    expect(logId('5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a11')).toBe(
      '5f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b-00000a11',
    );
    expect(logId('RCREF')).toBe('RCREF');
    expect(logId('cursor_mismatch')).toBe('cursor_mismatch');
    expect(logId('partyGstin')).toBe('partyGstin');
    expect(logId('ECONNREFUSED')).toBe('ECONNREFUSED');
    for (const data of [
      'Kisan Agro Traders & Sons',
      '126500.00',
      'SS/SO/2026-27/0042',
      'a key with spaces',
    ]) {
      expect(logId(data)).toBe('withheld');
    }
    const failed = Object.assign(new Error('Kisan Agro owes 126500.00'), { code: 'ECONNRESET' });
    expect(errorKind(failed)).toBe('ECONNRESET');
    expect(errorKind(new TypeError('fetch failed to Kisan Agro'))).toBe('TypeError');
    expect(errorKind('Kisan')).toBe('unknown');
  });

  it('writes a file per India day and keeps the last thirty days', () => {
    dir = tempDir();
    let now = new Date('2026-11-27T18:29:00Z'); // 23:59 in India
    writeFileSync(join(dir.dir, 'connector-2026-10-28.log'), 'old\n');
    writeFileSync(join(dir.dir, 'connector-2026-10-29.log'), 'removed the next day\n');
    writeFileSync(join(dir.dir, 'connector-2026-10-30.log'), 'kept\n');
    writeFileSync(join(dir.dir, 'notes.txt'), 'not ours\n');
    const log = createFileLog({ dir: dir.dir, keepDays: 30, now: () => now });
    log.info('batch_sent', { entity: logId('SS'), new: 3 });
    now = new Date('2026-11-27T18:31:00Z'); // 00:01 on the 28th in India
    log.warn('bos_unavailable', { kind: logId('ECONNREFUSED') });

    // Thirty days counting today: 30 October to 28 November.
    expect(readdirSync(dir.dir).sort()).toEqual([
      'connector-2026-10-30.log',
      'connector-2026-11-27.log',
      'connector-2026-11-28.log',
      'notes.txt',
    ]);
    expect(JSON.parse(readFileSync(join(dir.dir, 'connector-2026-11-27.log'), 'utf8'))).toEqual({
      at: '2026-11-27T18:29:00.000Z',
      level: 'info',
      event: 'batch_sent',
      entity: 'SS',
      new: 3,
    });
  });
});
