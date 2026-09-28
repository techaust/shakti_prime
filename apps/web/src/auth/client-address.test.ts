import { describe, expect, it } from 'vitest';
import { platformRequestId } from './client-address';

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
});
