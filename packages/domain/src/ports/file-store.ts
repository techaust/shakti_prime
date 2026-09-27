import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Where uploaded bytes live (docs/DATABASE.md §6.10 `files`). A `files` row records `bucket` and
 * `key`; the store holds the bytes. Development keeps them on local disk and tests in memory;
 * the hosted store (S3 in Mumbai, with pre-signed uploads) replaces both before files are
 * uploaded anywhere hosted.
 */
export interface FileStore {
  /** The name recorded as `files.bucket`. */
  readonly bucket: string;
  /**
   * Stores bytes under a key once. Keys are named by their content (an import file's SHA-256), so
   * a key that already holds bytes is left as it is and the call still succeeds.
   */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes under `key`, or undefined when nothing is stored there. */
  get(key: string): Promise<Uint8Array | undefined>;
}

/** Keys are made by the app: segments of letters, digits, dots, dashes and underscores. */
const KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;

export function assertFileKey(key: string): void {
  if (key.length > 300 || !KEY.test(key)) throw new Error('file key is not a safe path');
}

/** For tests: one map per store. */
export function memoryFileStore(bucket = 'memory'): FileStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    bucket,
    objects,
    put(key, bytes, contentType) {
      assertFileKey(key);
      if (!objects.has(key)) objects.set(key, { bytes: new Uint8Array(bytes), contentType });
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(objects.get(key)?.bytes);
    },
  };
}

/**
 * For local development: files under one folder, never outside it. The key's shape is checked
 * and the resolved path must stay inside the folder, so a key can never climb out of it.
 */
export function localDiskFileStore(root: string, bucket = 'local'): FileStore {
  const base = resolve(root);
  const pathFor = (key: string): string => {
    assertFileKey(key);
    const path = resolve(join(base, key));
    const inside = relative(base, path);
    if (inside === '' || inside.startsWith('..') || inside.includes(`..${sep}`)) {
      throw new Error('file key is not a safe path');
    }
    return path;
  };
  return {
    bucket,
    async put(key, bytes) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, bytes, { flag: 'wx' });
      } catch (e) {
        // Already stored: the key names the content, so the bytes there are these bytes.
        if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
      }
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (e) {
        if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return undefined;
        throw e;
      }
    },
  };
}
