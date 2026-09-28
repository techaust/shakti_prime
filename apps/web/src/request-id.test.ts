import { describe, expect, it } from 'vitest';
import { platformRequestId as fromClientAddress } from './auth/client-address';
import { incomingRequestId, platformRequestId } from './request-id';

describe('platformRequestId', () => {
  it("prefers the platform's id to one the caller chose", () => {
    const headers = new Headers({
      'x-vercel-id': 'bom1::abcde-1727430000000',
      'x-request-id': 'mine',
    });
    expect(platformRequestId(headers)).toBe('bom1::abcde-1727430000000');
  });

  it("takes a caller's id only where the platform set none, and only when it is safe", () => {
    expect(platformRequestId(new Headers({ 'x-request-id': 'monitor-7.retry' }))).toBe(
      'monitor-7.retry',
    );
    for (const unsafe of ['has spaces', 'quote"d', 'x'.repeat(129), '<script>']) {
      expect(platformRequestId(new Headers({ 'x-request-id': unsafe }))).toBeUndefined();
    }
  });

  it("never falls back to the caller's id when the platform's is unusable", () => {
    const headers = new Headers({ 'x-vercel-id': 'not safe', 'x-request-id': 'chosen-by-caller' });
    expect(platformRequestId(headers)).toBeUndefined();
  });

  it('answers undefined with no headers at all', () => {
    expect(platformRequestId(undefined)).toBeUndefined();
    expect(platformRequestId(new Headers())).toBeUndefined();
  });

  it('is the same rule the auth module and the actions read', () => {
    expect(fromClientAddress).toBe(platformRequestId);
  });
});

describe('incomingRequestId', () => {
  it("keeps the caller's well-formed id where the platform set none", () => {
    const headers = new Headers({ 'x-request-id': 'qstash-msg_2x.retry-1' });
    expect(incomingRequestId(headers)).toBe('qstash-msg_2x.retry-1');
  });

  it("takes the platform's id over the caller's", () => {
    const headers = new Headers({ 'x-vercel-id': 'bom1::abcde-1', 'x-request-id': 'mine' });
    expect(incomingRequestId(headers)).toBe('bom1::abcde-1');
  });

  it('makes a new id when none is sent, or the one sent is not safe to echo', () => {
    const fresh = incomingRequestId(new Headers());
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(incomingRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    for (const given of ['has space', 'a/b', 'x'.repeat(129), '<script>', '']) {
      const id = incomingRequestId(new Headers({ 'x-request-id': given }));
      expect(id).not.toBe(given);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    const unusable = new Headers({ 'x-vercel-id': 'not safe', 'x-request-id': 'mine' });
    expect(incomingRequestId(unusable)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
