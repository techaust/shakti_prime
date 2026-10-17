import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentMasker, MaskOutcome } from '../ocr/mask-document';
import { MASK_MIN_LEFT_MS, maskInTime } from './timed-mask';

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

describe('masking under what is left of the delivery (a page whose turn begins late)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A masker whose turn begins `turnAt` ms into the delivery and whose mask then never ends. */
  function lateTurn(turnAt: number) {
    vi.useFakeTimers();
    const start = Date.now();
    const elapsed = () => Date.now() - start;
    const masker: DocumentMasker = {
      mask: (_p, request) =>
        new Promise<MaskOutcome>(() => {
          setTimeout(() => request?.onTurn?.(), turnAt);
        }),
      close: () => Promise.resolve(),
    };
    return { masker, elapsed };
  }

  it('gives a mask whose turn begins at 30 s only the 20 s left, then hands the delivery back', async () => {
    const { masker, elapsed } = lateTurn(30_000);
    const discard = vi.fn(() => Promise.resolve());
    const masking = maskInTime(photo(), {
      masker: () => Promise.resolve(masker),
      discardMasker: discard,
      maskMs: 45_000,
      turnMs: 40_000,
      deliveryMs: 50_000,
      elapsed,
    });
    const answer = masking.then(
      () => 'answered',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(49_999);
    expect(discard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    // Not refused as too slow: the delivery ran out, not the page, so it is delivered again.
    expect(await answer).toMatchObject({ code: 'integration_unavailable' });
    expect(discard).toHaveBeenCalledWith(masker);
    expect(elapsed()).toBe(50_000);
  });

  it('hands the delivery back at once when the turn begins with too little left', async () => {
    const turnAt = 50_000 - MASK_MIN_LEFT_MS + 1;
    const { masker, elapsed } = lateTurn(turnAt);
    const discard = vi.fn(() => Promise.resolve());
    const answer = maskInTime(photo(), {
      masker: () => Promise.resolve(masker),
      discardMasker: discard,
      maskMs: 45_000,
      turnMs: 50_000,
      deliveryMs: 50_000,
      elapsed,
    }).then(
      () => 'answered',
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(turnAt);
    expect(await answer).toMatchObject({ code: 'integration_unavailable' });
    expect(discard).toHaveBeenCalledWith(masker);
    expect(elapsed()).toBe(turnAt);
  });

  it('still refuses as too slow a mask that runs its own time out with the delivery to spare', async () => {
    const { masker, elapsed } = lateTurn(1_000);
    const answer = maskInTime(photo(), {
      masker: () => Promise.resolve(masker),
      discardMasker: () => Promise.resolve(),
      maskMs: 45_000,
      turnMs: 25_000,
      deliveryMs: 50_000,
      elapsed,
    });
    await vi.advanceTimersByTimeAsync(46_000);
    expect(await answer).toEqual({ kind: 'too_slow' });
    expect(elapsed()).toBe(46_000);
  });
});
