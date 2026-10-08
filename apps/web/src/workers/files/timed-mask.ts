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
  /** Milliseconds since the delivery began. */
  elapsed: () => number;
}

export type TimedMask = { kind: 'done'; outcome: MaskOutcome } | { kind: 'too_slow' };

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

  const run = deadline(deps.maskMs);
  const outcome = await Promise.race([masking, run.late]).finally(run.clear);
  if (outcome === 'late') {
    await deps.discardMasker?.(masker).catch(() => undefined);
    return { kind: 'too_slow' };
  }
  return { kind: 'done', outcome };
}
