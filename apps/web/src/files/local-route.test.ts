import {
  localDiskFileStore,
  memoryFileStore,
  sha256Hex,
  signLocalGrant,
  type LocalGrant,
} from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import { localDownload, localUpload } from './local-route';

const SECRET = 'local files phrase for the route tests';
const bytes = new TextEncoder().encode('%PDF-1.7 hello');
const exp = () => Math.floor(Date.now() / 1000) + 60;
const putGrant: LocalGrant = {
  op: 'put',
  key: '1/quote_pdf/a.pdf',
  contentType: 'application/pdf',
  size: bytes.length,
  sha256: sha256Hex(bytes),
  exp: exp(),
};

function put(_token: string, body: Uint8Array, type = 'application/pdf'): Request {
  return new Request('http://localhost:3000/api/v1/files/local/x', {
    method: 'PUT',
    headers: { 'content-type': type },
    body: Buffer.from(body),
  });
}

describe('the development upload route', () => {
  it('stores exactly the bytes the grant names', async () => {
    const store = memoryFileStore();
    const token = signLocalGrant(SECRET, putGrant);
    const res = await localUpload(put(token, bytes), token, {
      store,
      secret: SECRET,
      hosted: false,
    });
    expect(res.status).toBe(200);
    expect(await store.get(putGrant.key)).toEqual(bytes);
  });

  it('is not there on a hosted deployment', async () => {
    const token = signLocalGrant(SECRET, putGrant);
    const res = await localUpload(put(token, bytes), token, {
      store: memoryFileStore(),
      secret: SECRET,
      hosted: true,
    });
    expect(res.status).toBe(404);
  });

  it('refuses a forged or expired address, and a download address', async () => {
    const store = memoryFileStore();
    for (const token of [
      signLocalGrant('another phrase', putGrant),
      signLocalGrant(SECRET, { ...putGrant, exp: 1 }),
      signLocalGrant(SECRET, {
        op: 'get',
        key: putGrant.key,
        filename: 'a.pdf',
        disposition: 'inline',
        exp: exp(),
      }),
    ]) {
      const res = await localUpload(put(token, bytes), token, {
        store,
        secret: SECRET,
        hosted: false,
      });
      expect(res.status).toBe(403);
    }
    expect(store.objects.size).toBe(0);
  });

  it('refuses another type, another length and other bytes', async () => {
    const store = memoryFileStore();
    const token = signLocalGrant(SECRET, putGrant);
    const other = new TextEncoder().encode('%PDF-1.7 hellp');
    for (const request of [
      put(token, bytes, 'image/png'),
      put(token, bytes.subarray(1)),
      put(token, new Uint8Array([...bytes, 0])),
      put(token, other),
    ]) {
      const res = await localUpload(request, token, { store, secret: SECRET, hosted: false });
      expect(res.status).toBe(400);
    }
    expect(store.objects.size).toBe(0);
  });
});

describe('the development download route', () => {
  it('serves the bytes under their name, and nothing for a forged address', async () => {
    const store = memoryFileStore();
    await store.put(putGrant.key, bytes, 'application/pdf');
    const token = signLocalGrant(SECRET, {
      op: 'get',
      key: putGrant.key,
      filename: 'Quote.pdf',
      disposition: 'attachment',
      exp: exp(),
    });
    const res = await localDownload(new Request('http://localhost/x'), token, {
      store,
      secret: SECRET,
      hosted: false,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="Quote.pdf"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    const forged = await localDownload(new Request('http://localhost/x'), `${token}x`, {
      store,
      secret: SECRET,
      hosted: false,
    });
    expect(forged.status).toBe(403);
    const hosted = await localDownload(new Request('http://localhost/x'), token, {
      store,
      secret: SECRET,
      hosted: true,
    });
    expect(hosted.status).toBe(404);
  });

  it('answers 404 for a key with nothing stored', async () => {
    const token = signLocalGrant(SECRET, {
      op: 'get',
      key: '1/none.pdf',
      filename: 'x.pdf',
      disposition: 'inline',
      exp: exp(),
    });
    const res = await localDownload(new Request('http://localhost/x'), token, {
      store: localDiskFileStore('.data/never-created'),
      secret: SECRET,
      hosted: false,
    });
    expect(res.status).toBe(404);
  });
});
