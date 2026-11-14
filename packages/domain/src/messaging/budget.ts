import { createHash } from 'node:crypto';
import type { KeyValue } from '../ports/key-value';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

// The portfolio's WhatsApp messaging limit (BLUEPRINT §13, design phase2 §6.1): Meta counts
// business-initiated conversations to distinct customers in a rolling 24 hours across all four
// companies' numbers, against a limit it reports in `phone_number_quality_update`. Kept in the
// key-value store: an hour's bucket of new conversations, and a key per customer that holds for 24
// hours, so a customer counts once however many messages they get. Customers are keyed by a hash of
// their number, never the number.

const HOUR_MS = 3_600_000;
const DAY_SECONDS = 86_400;
const LIMIT_KEY = 'whatsapp:limit';

const customerKey = (waId: string): string =>
  `whatsapp:budget:customer:${createHash('sha256').update(waId).digest('hex').slice(0, 32)}`;
const hourKey = (hour: number): string => `whatsapp:budget:hour:${String(hour)}`;
const qualityKey = (entityId: number): string => `whatsapp:quality:${String(entityId)}`;

/** Meta's limit tiers as `current_limit` names them; an unlimited tier counts as a billion. */
export function tierLimit(tier: string | undefined): number | null {
  if (tier === undefined) return null;
  const match = /^TIER_(\d+)(K?)$/i.exec(tier.trim());
  if (match) return Number(match[1]) * (match[2] === '' ? 1 : 1000);
  return /^TIER_UNLIMITED$/i.test(tier.trim()) ? 1_000_000_000 : null;
}

/** The budget as the send checks read it (`SendBudget`). */
export async function readBudget(
  kv: KeyValue,
  waId: string,
  now: Date,
): Promise<{ used: number; limit: number; alreadyCounted: boolean }> {
  const stored = await kv.get(LIMIT_KEY);
  const limit = stored === null ? WORKSHOP_DEFAULTS.whatsapp.startingLimit : Number(stored);
  const hour = Math.floor(now.getTime() / HOUR_MS);
  const counts = await Promise.all(
    Array.from({ length: 24 }, (_, i) => kv.get(hourKey(hour - i))),
  );
  const used = counts.reduce((sum, c) => sum + (c === null ? 0 : Number(c)), 0);
  return { used, limit, alreadyCounted: (await kv.get(customerKey(waId))) !== null };
}

/** A business-initiated message was sent: its customer counts for the next 24 hours, once. */
export async function countConversation(kv: KeyValue, waId: string, now: Date): Promise<void> {
  if (await kv.setIfAbsent(customerKey(waId), '1', DAY_SECONDS)) {
    await kv.incr(hourKey(Math.floor(now.getTime() / HOUR_MS)), DAY_SECONDS + 3600);
  }
}

/** What Meta last reported of a company's number: its quality event and the portfolio's tier. */
export interface NumberQuality {
  event: string;
  at: string;
}

/** Records a `phone_number_quality_update`: the number's event and, when named, the limit. */
export async function recordQuality(
  kv: KeyValue,
  entityId: number,
  event: string,
  tier: string | undefined,
  now: Date,
): Promise<void> {
  const quality: NumberQuality = { event: event.slice(0, 40), at: now.toISOString() };
  await kv.set(qualityKey(entityId), JSON.stringify(quality), 90 * DAY_SECONDS);
  const limit = tierLimit(tier);
  if (limit !== null) await kv.set(LIMIT_KEY, String(limit), 90 * DAY_SECONDS);
}

/** Integration Health's view: each company's last quality event, the limit and the budget used. */
export async function readMessagingHealth(
  kv: KeyValue,
  entityIds: readonly number[],
  now: Date,
): Promise<{
  limit: number;
  limitReported: boolean;
  used: number;
  quality: { entityId: number; event: string | null; at: string | null }[];
}> {
  const stored = await kv.get(LIMIT_KEY);
  const { used } = await readBudget(kv, '', now);
  const quality = await Promise.all(
    entityIds.map(async (entityId) => {
      const raw = await kv.get(qualityKey(entityId));
      const parsed = raw === null ? null : (JSON.parse(raw) as NumberQuality);
      return { entityId, event: parsed?.event ?? null, at: parsed?.at ?? null };
    }),
  );
  return {
    limit: stored === null ? WORKSHOP_DEFAULTS.whatsapp.startingLimit : Number(stored),
    limitReported: stored !== null,
    used,
    quality,
  };
}
