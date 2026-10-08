import { describe, expect, it, vi } from 'vitest';
import type { DocumentMasker, MaskOutcome } from '../ocr/mask-document';
import { maskInTime } from './timed-mask';

// A mask is bounded twice: how long it may wait for its turn (then the delivery is delivered
// again) and how long it may run once the turn has begun (then it is refused as too slow).

const photo = () => Buffer.from([1, 2, 3]);
const done = { status: 'clean', image: Buffer.from([9]), rects: 0 } as unknown as MaskOutcome;

describe('masking a photo under a time limit', () => {
  it('answers the outcome of a mask that runs in time', async () => {
    const masker: DocumentMasker = {
      mask: (_p, request) => {
        request?.onTurn?.();
        return Promise.resolve(done);
      },
      close: () => Promise.resolve(),
    };
    expect(
      await maskInTime(photo(), {
        masker: () => Promise.resolve(masker),
        maskMs: 100,
        turnMs: 100,
        elapsed: () => 0,
      }),
    ).toEqual({ kind: 'done', outcome: done });
  });

  it('refuses nothing for a wait: a mask that gets no turn in time is withdrawn and delivered again', async () => {
    let aborted = false;
    const masker: DocumentMasker = {
      mask: (_p, request) =>
        new Promise<MaskOutcome>(() => {
          request?.signal?.addEventListener('abort', () => {
            aborted = true;
          });
        }),
      close: () => Promise.resolve(),
    };
    const discard = vi.fn(() => Promise.resolve());
    await expect(
      maskInTime(photo(), {
        masker: () => Promise.resolve(masker),
        discardMasker: discard,
        maskMs: 5_000,
        turnMs: 50,
        elapsed: () => 0,
      }),
    ).rejects.toMatchObject({ code: 'integration_unavailable' });
    expect(aborted).toBe(true);
    expect(discard).not.toHaveBeenCalled();
  });

  it('bounds a mask that hangs once it has its turn, and closes only the masking step it used', async () => {
    const masker: DocumentMasker = {
      mask: (_p, request) => {
        request?.onTurn?.();
        return new Promise<MaskOutcome>(() => undefined);
      },
      close: () => Promise.resolve(),
    };
    const discard = vi.fn(() => Promise.resolve());
    const started = Date.now();
    expect(
      await maskInTime(photo(), {
        masker: () => Promise.resolve(masker),
        discardMasker: discard,
        maskMs: 60,
        turnMs: 5_000,
        elapsed: () => 0,
      }),
    ).toEqual({ kind: 'too_slow' });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(discard).toHaveBeenCalledWith(masker);
  });
});
