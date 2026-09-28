import { describe, expect, it } from 'vitest';
import { declaredTooLarge, readTextWithin } from './request-body';

const URL_ = 'http://localhost/api/v1/workers/outbox/publish';

/** A body sent in pieces with no declared length, as a chunked upload arrives. */
function streamed(pieces: string[], headers: Record<string, string> = {}): Request {
  const encoder = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const piece = pieces[pulled];
      pulled += 1;
      if (piece === undefined) controller.close();
      else controller.enqueue(encoder.encode(piece));
    },
  });
  return new Request(URL_, { method: 'POST', headers, body, duplex: 'half' } as RequestInit);
}

describe('declaredTooLarge', () => {
  it('refuses a declared length over the cap, or one that is not a number', () => {
    expect(declaredTooLarge(new Headers({ 'content-length': '10' }), 10)).toBe(false);
    expect(declaredTooLarge(new Headers({ 'content-length': '11' }), 10)).toBe(true);
    expect(declaredTooLarge(new Headers({ 'content-length': '1e9' }), 10)).toBe(true);
    expect(declaredTooLarge(new Headers({ 'content-length': '-1' }), 10)).toBe(true);
    expect(declaredTooLarge(new Headers(), 10)).toBe(false);
  });
});

describe('readTextWithin', () => {
  it('reads a body within the cap, and an absent one as empty text', async () => {
    const small = new Request(URL_, { method: 'POST', body: '{"a":1}' });
    await expect(readTextWithin(small, 64)).resolves.toBe('{"a":1}');
    await expect(readTextWithin(new Request(URL_, { method: 'POST' }), 64)).resolves.toBe('');
    await expect(readTextWithin(streamed(['ab', 'cd']), 4)).resolves.toBe('abcd');
  });

  it('reads nothing of a body declared over the cap', async () => {
    const declared = new Request(URL_, {
      method: 'POST',
      headers: { 'content-length': '999999' },
      body: '{}',
    });
    await expect(readTextWithin(declared, 64)).resolves.toBeUndefined();
    expect(declared.bodyUsed).toBe(false);
  });

  it('stops at the cap when the body carries no length, or a false one', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const request = new Request(URL_, {
      method: 'POST',
      body: endless,
      duplex: 'half',
    } as RequestInit);
    await expect(readTextWithin(request, 4096)).resolves.toBeUndefined();
    // The fifth kilobyte passes the cap; the stream is not read on after it.
    expect(pulled).toBeLessThan(10);

    const lying = streamed(['x'.repeat(40), 'y'.repeat(40)], { 'content-length': '2' });
    await expect(readTextWithin(lying, 64)).resolves.toBeUndefined();
  });
});
