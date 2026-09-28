import { describe, expect, it } from 'vitest';
import { incomingRequestId } from './request-id';

describe('incomingRequestId', () => {
  it("keeps the caller's well-formed id", () => {
    const headers = new Headers({ 'x-request-id': 'qstash-msg_2x.retry-1' });
    expect(incomingRequestId(headers)).toBe('qstash-msg_2x.retry-1');
  });

  it('makes a new id when none is sent, or the one sent is not safe to echo', () => {
    const fresh = incomingRequestId(new Headers());
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    for (const given of ['has space', 'a/b', 'x'.repeat(129), '<script>', '']) {
      const id = incomingRequestId(new Headers({ 'x-request-id': given }));
      expect(id).not.toBe(given);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
