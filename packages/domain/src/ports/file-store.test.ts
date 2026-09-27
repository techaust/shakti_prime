import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertFileKey, localDiskFileStore, memoryFileStore } from './file-store';

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const bytes = Uint8Array.from([1, 2, 3]);

describe('file stores', () => {
  it('keeps bytes in memory for tests', async () => {
    const store = memoryFileStore();
    await store.put('imports/1/a.csv', bytes, 'text/csv');
    expect(await store.get('imports/1/a.csv')).toEqual(bytes);
    expect(await store.get('imports/1/b.csv')).toBeUndefined();
  });

  it('keeps bytes on disk, once per key, inside its folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shakti-files-'));
    dirs.push(dir);
    const store = localDiskFileStore(dir);
    await store.put('imports/1/a.csv', bytes, 'text/csv');
    expect(await store.get('imports/1/a.csv')).toEqual(bytes);
    expect(await store.get('imports/1/missing.csv')).toBeUndefined();
    // A second put of the same key keeps the first bytes and succeeds.
    await store.put('imports/1/a.csv', Uint8Array.from([9]), 'text/csv');
    expect(await store.get('imports/1/a.csv')).toEqual(bytes);
  });

  it.each(['../secret', '/etc/passwd', 'imports/../../x', 'a\\b', 'imports//x', '', 'a/.hidden'])(
    'refuses the key %j',
    (key) => {
      expect(() => {
        assertFileKey(key);
      }).toThrow('file key is not a safe path');
    },
  );
});
