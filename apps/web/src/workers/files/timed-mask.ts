import { DomainError } from '@shakti/contracts';
import type { DocumentMasker, MaskOutcome } from '../ocr/mask-document';

export interface TimedMaskDeps {
  masker: () => Promise<DocumentMasker>;
  /** Closes the masking step `used`, which a mask ran out of time on (see `discardVaultMasker`). */
  discardMasker?: ((used: DocumentMasker) => Promise<void>) | undefined;
  /** How long a mask may run once its turn has begun. */
  maskMs: number;
  /** The delivery's time by which the mask's turn must have begun. */
  turnMs: number;
  /**
   * The delivery's time by which the mask must have ended (`PAGE_DELIVERY_LIMIT_MS`), so the
   * route keeps time to store what was masked; a mask is never given more than is left of it.
   */
  deliveryMs?: number | undefined;
  /** Milliseconds since the delivery began (the route's start). */
  elapsed: () => number;
}

/**
 * Below this much of the delivery's time left when the turn begins, the mask is not run at all:
 * it is handed back for a later delivery, which starts with the whole of its time.
 */
export const MASK_MIN_LEFT_MS = 5_000;

export type TimedMask = { kind: 'done'; outcome: MaskOutcome } | { kind: 'too_slow' };

const handedBack = () =>
  new DomainError('integration_unavailable', 'the delivery has too little time left to mask');

function deadline(ms: number): { late: Promise<'late'>; clear: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => {
      resolve('late');
    }, ms);
  });
  return {
    late,
    clear: () => {
      clearTimeout(timer);
    },
  };
}

/**
 * Masks `bytes` (which the masker wipes) under two limits. The wait for the mask's turn in the
 * masker's queue, which other checks in the same process may hold, is bounded by `turnMs` of the
 * delivery; a mask that cannot start by then is withdrawn and the delivery answers
 * `integration_unavailable`, so it is delivered again later and nothing is refused. Once the turn
 * begins the mask has `maskMs` of its own; past that the masking step is closed (only the one this
 * mask used) and the answer is `too_slow`. A masking step that fails is thrown.
 *
 * With `deliveryMs`, the mask is also bounded by what is left of the delivery's time when its turn
 * begins, so a turn that begins late cannot carry the delivery past its route's limit. When less
 * than `MASK_MIN_LEFT_MS` is left, or the mask runs out of that time before its own `maskMs`, the
 * masking step is closed and the delivery answers `integration_unavailable`: it is delivered again
 * with its whole time, and the file is not blamed for the delivery's lateness.
 */
export async function maskInTime(bytes: Buffer, deps: TimedMaskDeps): Promise<TimedMask> {
  const masker = await deps.masker();
  const controller = new AbortController();
  let begin: () => void = () => undefined;
  const began = new Promise<'began'>((resolve) => {
    begin = () => {
      resolve('began');
    };
  });
  const masking = masker.mask(bytes, { expect: [], onTurn: begin, signal: controller.signal });
  // A mask that outlives its limit is closed down below and fails on its own; nobody waits for it.
  masking.catch(() => undefined);

  const wait = deadline(Math.max(0, deps.turnMs - deps.elapsed()));
  const first = await Promise.race([
    began,
    masking.then(() => 'began' as const),
    wait.late,
  ]).finally(wait.clear);
  if (first === 'late') {
    controller.abort();
    throw new DomainError('integration_unavailable', 'the masking step is busy with other checks');
  }

  const left =
    deps.deliveryMs === undefined ? Number.POSITIVE_INFINITY : deps.deliveryMs - deps.elapsed();
  const discard = () => deps.discardMasker?.(masker).catch(() => undefined);
  if (left < MASK_MIN_LEFT_MS) {
    controller.abort();
    await discard();
    throw handedBack();
  }
  const cut = left < deps.maskMs;
  const run = deadline(cut ? left : deps.maskMs);
  const outcome = await Promise.race([masking, run.late]).finally(run.clear);
  if (outcome === 'late') {
    await discard();
    if (cut) throw handedBack();
    return { kind: 'too_slow' };
  }
  return { kind: 'done', outcome };
}
