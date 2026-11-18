import { PendingScreenPop } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';

/**
 * The ringing call waiting for its person (docs/03-roadmap-appendix/phase2.md §7.4): the
 * incoming-call handler holds it in the shared key-value store after the call is recorded, and the
 * person's own ringing route reads it, checks the session is the person's, and only then takes it
 * once, so the screen-pop reads no database while it waits and nobody reads another person's
 * call. A later call to the same person replaces it.
 */

/** Seconds a ringing call waits to be taken: a call not picked up by then has stopped ringing. */
export const RINGING_TTL_SECONDS = 60;

/** The key of one person's ringing call. */
export function ringingKey(userId: string): string {
  return `ringing:${userId}`;
}

/** Holds a ringing call for its person. */
export async function holdRinging(
  keyValue: KeyValue,
  userId: string,
  pop: PendingScreenPop,
): Promise<void> {
  await keyValue.set(
    ringingKey(userId),
    JSON.stringify(PendingScreenPop.parse(pop)),
    RINGING_TTL_SECONDS,
  );
}

/** A ringing call as read from the store, with the exact value read, for its claim. */
export interface HeldRinging {
  pop: PendingScreenPop;
  raw: string;
}

/**
 * The person's ringing call, read without taking it, so a screen whose session turns out not to be
 * the person's leaves it for the right one. Anything that does not read as a ringing call is
 * cleared (only while it is still the value read) and answered as none.
 */
export async function peekRinging(
  keyValue: KeyValue,
  userId: string,
): Promise<HeldRinging | undefined> {
  const key = ringingKey(userId);
  const raw = await keyValue.get(key);
  if (raw === null) return undefined;
  let pop: PendingScreenPop | undefined;
  try {
    const parsed = PendingScreenPop.safeParse(JSON.parse(raw));
    pop = parsed.success ? parsed.data : undefined;
  } catch {
    pop = undefined;
  }
  if (pop === undefined) {
    await keyValue.delIfValue(key, raw);
    return undefined;
  }
  return { pop, raw };
}

/**
 * Takes the call read by `peekRinging`, in one step: it is cleared only while the store still
 * holds that very call, so of two screens of the person only the first gets it, and a newer call
 * held in between is never cleared (the next ask finds it). True for the screen that took it.
 */
export async function claimRinging(
  keyValue: KeyValue,
  userId: string,
  held: HeldRinging,
): Promise<boolean> {
  return keyValue.delIfValue(ringingKey(userId), held.raw);
}

/** The person's ringing call, read and taken at once (the suites' way to take a held call). */
export async function takeRinging(
  keyValue: KeyValue,
  userId: string,
): Promise<PendingScreenPop | undefined> {
  const held = await peekRinging(keyValue, userId);
  if (held === undefined) return undefined;
  return (await claimRinging(keyValue, userId, held)) ? held.pop : undefined;
}
