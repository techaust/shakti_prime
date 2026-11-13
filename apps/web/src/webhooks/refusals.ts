import type { WebhookProvider } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';

/**
 * Deliveries refused at their check are never stored, so they are counted in the key-value store
 * instead (docs/03-roadmap-appendix/phase2.md §5.1): one counter per provider and UTC hour, kept
 * a little over a day, which Integration Health sums over the last 24 hours.
 */
const KEEP_SECONDS = 25 * 60 * 60;

function hourOf(at: Date): string {
  return at.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

export function refusedKey(provider: WebhookProvider, at: Date): string {
  return `webhook:refused:${provider}:${hourOf(at)}`;
}

/** Counts one refused delivery. */
export async function countRefusal(
  keyValue: KeyValue,
  provider: WebhookProvider,
  at: Date,
): Promise<void> {
  await keyValue.incr(refusedKey(provider, at), KEEP_SECONDS);
}

/** The deliveries refused in the 24 hours up to `at`, by the hours they fell in. */
export async function refusedLastDay(
  keyValue: KeyValue,
  provider: WebhookProvider,
  at: Date,
): Promise<number> {
  const hours = Array.from({ length: 24 }, (_, i) => new Date(at.getTime() - i * 60 * 60 * 1000));
  const counts = await Promise.all(hours.map((h) => keyValue.get(refusedKey(provider, h))));
  return counts.reduce((sum, value) => sum + (value === null ? 0 : Number(value) || 0), 0);
}
