import { PendingScreenPop } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';

/**
 * The ringing call waiting for its person (docs/03-roadmap-appendix/phase2.md §7.4): the
 * incoming-call handler holds it in the shared key-value store after the call is recorded, and the
 * person's own ringing route takes it once, so the screen-pop reads no database while it waits and
 * nobody reads another person's call. A later call to the same person replaces it.
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

/**
 * The person's ringing call, taken once: it is cleared as it is read. Anything that does not read
 * as a ringing call is cleared and answered as none.
 */
export async function takeRinging(
  keyValue: KeyValue,
  userId: string,
): Promise<PendingScreenPop | undefined> {
  const key = ringingKey(userId);
  const raw = await keyValue.get(key);
  if (raw === null) return undefined;
  await keyValue.del(key);
  try {
    const parsed = PendingScreenPop.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
