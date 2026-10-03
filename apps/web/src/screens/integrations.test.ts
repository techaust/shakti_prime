import { describe, expect, it } from 'vitest';
import { heldReason } from './integrations';

describe('heldReason', () => {
  it('names the delivery service for its refusals and timeouts', () => {
    for (const code of ['queue_refused', 'no_answer', 'TimeoutError', 'http_503']) {
      expect(heldReason(code)).toBe('queue');
    }
  });

  it('names the worker for the codes a worker answers', () => {
    for (const code of ['worker_failed', 'worker_refused', 'internal', 'forbidden']) {
      expect(heldReason(code)).toBe('worker');
    }
  });

  it('tells a retired kind and an interrupted run apart', () => {
    expect(heldReason('not_in_catalogue')).toBe('retired');
    expect(heldReason('no_outcome')).toBe('interrupted');
  });

  it('falls back to a general sentence for anything else', () => {
    for (const code of [null, 'other', 'http_5031', 'something_new']) {
      expect(heldReason(code)).toBe('other');
    }
  });
});
