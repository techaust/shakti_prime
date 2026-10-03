import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assertFileKey,
  contentDisposition,
  localDiskFileStore,
  memoryFileStore,
  sha256Hex,
  signLocalGrant,
  verifyLocalGrant,
} from './file-store';

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

describe('signed development addresses', () => {
  const SECRET = 'development signing phrase for the tests';
  const grant = {
    op: 'put' as const,
    key: 'imports/1/a.png',
    contentType: 'image/png',
    size: 3,
    sha256: sha256Hex(bytes),
    exp: Math.floor(Date.now() / 1000) + 60,
  };

  it('verifies what it signed', () => {
    expect(verifyLocalGrant(SECRET, signLocalGrant(SECRET, grant))).toEqual(grant);
  });

  it('refuses another secret, an altered grant, an expired one and junk', () => {
    const token = signLocalGrant(SECRET, grant);
    expect(verifyLocalGrant('another phrase', token)).toBeUndefined();
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...grant, size: 99 })).toString('base64url');
    expect(verifyLocalGrant(SECRET, `${forged}.${signature ?? ''}`)).toBeUndefined();
    const old = signLocalGrant(SECRET, { ...grant, exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyLocalGrant(SECRET, old)).toBeUndefined();
    expect(verifyLocalGrant(SECRET, 'x')).toBeUndefined();
    expect(verifyLocalGrant(SECRET, `${token}.x`)).toBeUndefined();
  });

  it('refuses a grant for an unsafe key even when signed', () => {
    expect(
      verifyLocalGrant(SECRET, signLocalGrant(SECRET, { ...grant, key: '../x' })),
    ).toBeUndefined();
  });

  it('signs uploads and downloads for the development route, and reads objects back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'shakti-files-'));
    dirs.push(dir);
    const store = localDiskFileStore(dir, {
      signing: { secret: SECRET, url: (t) => `http://localhost:3000/api/v1/files/local/${t}` },
    });
    expect(store.scanned).toBe(false);
    const put = await store.presignPut({
      key: 'logos/1.png',
      contentType: 'image/png',
      size: 3,
      sha256: sha256Hex(bytes),
    });
    expect(put.headers).toEqual({ 'content-type': 'image/png' });
    const token = put.url.split('/').pop() ?? '';
    expect(verifyLocalGrant(SECRET, token)).toMatchObject({ op: 'put', key: 'logos/1.png' });
    expect(put.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);

    expect(await store.head('logos/1.png')).toBeUndefined();
    await store.put('logos/1.png', bytes, 'image/png');
    expect(await store.head('logos/1.png')).toEqual({
      size: 3,
      contentType: 'image/png',
      sha256: sha256Hex(bytes),
    });
    expect(await store.tags('logos/1.png')).toEqual({});
    const get = await store.presignGet('logos/1.png', {
      filename: 'Logo.png',
      disposition: 'inline',
    });
    expect(verifyLocalGrant(SECRET, get.url.split('/').pop() ?? '')).toMatchObject({
      op: 'get',
      filename: 'Logo.png',
    });
    await store.delete('logos/1.png');
    expect(await store.get('logos/1.png')).toBeUndefined();
    expect(await store.head('logos/1.png')).toBeUndefined();
  });

  it('encodes the extended name as RFC 5987 does, apostrophes and brackets too', () => {
    expect(
      contentDisposition({ filename: "Ramu's quote (1)*!.pdf", disposition: 'attachment' }),
    ).toBe(
      `attachment; filename="Ramu's quote (1)*!.pdf"; filename*=UTF-8''Ramu%27s%20quote%20%281%29%2A%21.pdf`,
    );
    expect(contentDisposition({ filename: 'Rāmu.pdf', disposition: 'inline' })).toBe(
      `inline; filename="R_mu.pdf"; filename*=UTF-8''R%C4%81mu.pdf`,
    );
  });

  it('writes a download name any browser keeps', () => {
    expect(contentDisposition({ filename: 'Logo "new".png', disposition: 'inline' })).toBe(
      `inline; filename="Logo _new_.png"; filename*=UTF-8''Logo%20%22new%22.png`,
    );
  });

  it('keeps tags and removes objects in memory', async () => {
    const store = memoryFileStore();
    await store.put('a/b.png', bytes, 'image/png');
    const object = store.objects.get('a/b.png');
    if (object) object.tags.GuardDutyMalwareScanStatus = 'NO_THREATS_FOUND';
    expect(await store.tags('a/b.png')).toEqual({ GuardDutyMalwareScanStatus: 'NO_THREATS_FOUND' });
    await store.delete('a/b.png');
    expect(await store.head('a/b.png')).toBeUndefined();
  });
});
