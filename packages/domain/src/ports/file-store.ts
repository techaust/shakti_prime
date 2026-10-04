import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Where uploaded bytes live (docs/DATABASE.md §6.10 `files`, docs/ARCHITECTURE.md §9). A `files`
 * row records `bucket` and `key`; the store holds the bytes. Hosted environments keep them in S3
 * in Mumbai (`s3FileStore` in apps/web), encrypted with the environment's KMS key and scanned by
 * GuardDuty; a developer's machine keeps them on local disk, and tests in memory. A browser
 * uploads and downloads on short-lived signed addresses, so the bytes never pass through the app.
 */
export interface FileStore {
  /** The name recorded as `files.bucket`. */
  readonly bucket: string;
  /** True when a malware scanner tags every object this store receives (S3 with GuardDuty). */
  readonly scanned: boolean;
  /**
   * Stores bytes under a key once. A key that already holds bytes is left as it is and the call
   * still succeeds: keys are named by their content (an import file's SHA-256) or by a file id.
   */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** The bytes under `key`, or undefined when nothing is stored there. */
  get(key: string): Promise<Uint8Array | undefined>;
  /**
   * A signed address that accepts one upload of exactly this type, length and SHA-256 for
   * `PRESIGN_SECONDS`, stored encrypted with the environment's key.
   */
  presignPut(request: PresignPutRequest): Promise<PresignedPut>;
  /** A signed address that reads the object for `PRESIGN_SECONDS`, under the name given. */
  presignGet(key: string, options: PresignGetOptions): Promise<PresignedGet>;
  /** The object's size, type and SHA-256 (hex) as the store recorded them; undefined when absent. */
  head(key: string): Promise<StoredObject | undefined>;
  /** The object's tags (the malware scanner writes its verdict there); empty when it has none. */
  tags(key: string): Promise<Record<string, string>>;
  /** Removes the object, with every earlier version the store kept of it. */
  delete(key: string): Promise<void>;
}

export interface PresignPutRequest {
  key: string;
  contentType: string;
  size: number;
  /** Lowercase hex. */
  sha256: string;
}

export interface PresignedPut {
  url: string;
  method: 'PUT';
  /** Headers the upload must send exactly (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignGetOptions {
  /** The name the browser saves the file under. */
  filename: string;
  disposition: 'inline' | 'attachment';
}

export interface PresignedGet {
  url: string;
  expiresAt: Date;
}

export interface StoredObject {
  size: number;
  contentType: string | undefined;
  /** Lowercase hex; undefined when the store did not record one. */
  sha256: string | undefined;
}

/** How long a signed upload or download address works (docs/API.md §3.2). */
export const PRESIGN_SECONDS = 15 * 60;

/** Keys are made by the app: segments of letters, digits, dots, dashes and underscores. */
const KEY = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*$/;

export function assertFileKey(key: string): void {
  if (key.length > 300 || !KEY.test(key)) throw new Error('file key is not a safe path');
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * A name as RFC 5987 writes an extended parameter: UTF-8, percent-encoded, keeping only its
 * attribute characters, so `'`, `(`, `)`, `*` and `!` are encoded as well.
 */
export function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** `Content-Disposition` with the name in both forms, so any browser saves it under its name. */
export function contentDisposition(options: PresignGetOptions): string {
  const ascii = options.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${options.disposition}; filename="${ascii}"; filename*=UTF-8''${rfc5987(options.filename)}`;
}

/** For tests: one map per store. */
export function memoryFileStore(bucket = 'memory'): FileStore & {
  objects: Map<string, { bytes: Uint8Array; contentType: string; tags: Record<string, string> }>;
} {
  const objects = new Map<
    string,
    { bytes: Uint8Array; contentType: string; tags: Record<string, string> }
  >();
  const expiresAt = () => new Date(Date.now() + PRESIGN_SECONDS * 1000);
  return {
    bucket,
    scanned: false,
    objects,
    put(key, bytes, contentType) {
      assertFileKey(key);
      if (!objects.has(key)) {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType, tags: {} });
      }
      return Promise.resolve();
    },
    get(key) {
      return Promise.resolve(objects.get(key)?.bytes);
    },
    presignPut(request) {
      assertFileKey(request.key);
      return Promise.resolve({
        url: `https://memory.invalid/${request.key}`,
        method: 'PUT',
        headers: { 'content-type': request.contentType },
        expiresAt: expiresAt(),
      });
    },
    presignGet(key) {
      assertFileKey(key);
      return Promise.resolve({ url: `https://memory.invalid/${key}`, expiresAt: expiresAt() });
    },
    head(key) {
      const object = objects.get(key);
      return Promise.resolve(
        object === undefined
          ? undefined
          : {
              size: object.bytes.length,
              contentType: object.contentType,
              sha256: sha256Hex(object.bytes),
            },
      );
    },
    tags(key) {
      return Promise.resolve({ ...(objects.get(key)?.tags ?? {}) });
    },
    delete(key) {
      objects.delete(key);
      return Promise.resolve();
    },
  };
}

// --- the development store --------------------------------------------------------------------

/** What a development upload or download address allows, signed with the store's secret. */
export type LocalGrant =
  | {
      op: 'put';
      key: string;
      contentType: string;
      size: number;
      sha256: string;
      /** Seconds since the epoch. */
      exp: number;
    }
  | {
      op: 'get';
      key: string;
      filename: string;
      disposition: 'inline' | 'attachment';
      exp: number;
    };

function hmac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** `<payload>.<signature>`, both base64url: the whole grant travels in the address. */
export function signLocalGrant(secret: string, grant: LocalGrant): string {
  const payload = Buffer.from(JSON.stringify(grant), 'utf8').toString('base64url');
  return `${payload}.${hmac(secret, payload)}`;
}

/** The grant a token carries when its signature holds and it has not expired; else undefined. */
export function verifyLocalGrant(
  secret: string,
  token: string,
  now: Date = new Date(),
): LocalGrant | undefined {
  const [payload, signature, extra] = token.split('.');
  if (payload === undefined || signature === undefined || extra !== undefined) return undefined;
  const expected = Buffer.from(hmac(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
  let grant: LocalGrant;
  try {
    grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalGrant;
  } catch {
    return undefined;
  }
  if (typeof grant.exp !== 'number' || grant.exp * 1000 <= now.getTime()) return undefined;
  try {
    assertFileKey(grant.key);
  } catch {
    return undefined;
  }
  return grant;
}

export interface LocalDiskOptions {
  bucket?: string;
  /**
   * For signed addresses: the secret that signs them and the address of the development route
   * (`/api/v1/files/local/<token>`) that takes the upload and serves the download.
   */
  signing?: { secret: string; url: (token: string) => string };
  now?: () => Date;
}

/**
 * For local development: files under one folder, never outside it. The key's shape is checked
 * and the resolved path must stay inside the folder, so a key can never climb out of it. Each
 * object's type sits beside it in `<name>.type`. Nothing scans these files, so the worker marks
 * them `not_scanned`, which only a local environment accepts.
 */
export function localDiskFileStore(
  root: string,
  bucketOrOptions: string | LocalDiskOptions = {},
): FileStore {
  const options: LocalDiskOptions =
    typeof bucketOrOptions === 'string' ? { bucket: bucketOrOptions } : bucketOrOptions;
  const now = options.now ?? (() => new Date());
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
  const read = async (path: string): Promise<Buffer | undefined> => {
    try {
      return await readFile(path);
    } catch (e) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return undefined;
      throw e;
    }
  };
  const signing = () => {
    if (options.signing === undefined) throw new Error('this store signs no addresses');
    return options.signing;
  };
  const expiry = () => Math.floor(now().getTime() / 1000) + PRESIGN_SECONDS;
  return {
    bucket: options.bucket ?? 'local',
    scanned: false,
    async put(key, bytes, contentType) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, bytes, { flag: 'wx' });
      } catch (e) {
        // Already stored: the key names the content, so the bytes there are these bytes.
        if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e;
        return;
      }
      await writeFile(`${path}.type`, contentType);
    },
    async get(key) {
      const bytes = await read(pathFor(key));
      return bytes === undefined ? undefined : new Uint8Array(bytes);
    },
    presignPut(request) {
      pathFor(request.key);
      const { secret, url } = signing();
      const exp = expiry();
      const token = signLocalGrant(secret, { op: 'put', ...request, exp });
      return Promise.resolve({
        url: url(token),
        method: 'PUT',
        headers: { 'content-type': request.contentType },
        expiresAt: new Date(exp * 1000),
      });
    },
    presignGet(key, get) {
      pathFor(key);
      const { secret, url } = signing();
      const exp = expiry();
      const token = signLocalGrant(secret, { op: 'get', key, ...get, exp });
      return Promise.resolve({ url: url(token), expiresAt: new Date(exp * 1000) });
    },
    async head(key) {
      const path = pathFor(key);
      const bytes = await read(path);
      if (bytes === undefined) return undefined;
      const type = await read(`${path}.type`);
      return {
        size: bytes.length,
        contentType: type?.toString('utf8'),
        sha256: sha256Hex(bytes),
      };
    },
    tags() {
      return Promise.resolve({});
    },
    async delete(key) {
      const path = pathFor(key);
      await rm(path, { force: true });
      await rm(`${path}.type`, { force: true });
    },
  };
}
