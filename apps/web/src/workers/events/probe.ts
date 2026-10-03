import { DeliveryCheck, DomainError, type DeliveredEvent } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';

/** How long a delivery check's arrival is kept: the page asks within seconds. */
export const PROBE_TTL_SECONDS = 600;
/** How long the page remembers the last check it ran. */
export const LAST_PROBE_TTL_SECONDS = 24 * 60 * 60;
const LAST_PROBE_KEY = 'probe:last';

export const probeKey = (probeId: string): string => `probe:${probeId}`;

/** The string fields of a stored JSON object, or undefined when it is not one with all of them. */
function fields<K extends string>(
  text: string | null,
  keys: readonly K[],
): Record<K, string> | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field !== 'string') return undefined;
    out[key] = field;
  }
  return out;
}

/**
 * The worker for `platform.probe.requested`: records when the event arrived beside the moment the
 * command ran, for ten minutes. It writes no row, so it runs no command.
 */
export async function recordProbeArrival(
  event: DeliveredEvent,
  keyValue: KeyValue,
  now: Date,
): Promise<void> {
  const requestedAt = event.payload.requestedAt;
  if (typeof requestedAt !== 'string' || Number.isNaN(Date.parse(requestedAt))) {
    throw new DomainError('validation_failed', 'a delivery check carries the moment it was asked');
  }
  await keyValue.set(
    probeKey(event.aggregateId),
    JSON.stringify({ requestedAt, arrivedAt: now.toISOString() }),
    PROBE_TTL_SECONDS,
  );
}

/** Remembers the check the page ran last, so the page shows it again when opened. */
export async function rememberProbe(
  keyValue: KeyValue,
  probe: { probeId: string; requestedAt: string },
): Promise<void> {
  await keyValue.set(LAST_PROBE_KEY, JSON.stringify(probe), LAST_PROBE_TTL_SECONDS);
}

/**
 * Where a delivery check stands: `arrived` with the milliseconds from the command to the worker,
 * `waiting` while its ten minutes last, then `lost`. Undefined when no check is given and none
 * was run, or when the store holds nothing readable for it.
 */
export async function readDeliveryCheck(
  keyValue: KeyValue,
  now: Date,
  probe?: { probeId: string; requestedAt: string },
): Promise<DeliveryCheck | undefined> {
  const asked = probe ?? fields(await keyValue.get(LAST_PROBE_KEY), ['probeId', 'requestedAt']);
  if (asked === undefined) return undefined;
  const requested = Date.parse(asked.requestedAt);
  if (Number.isNaN(requested)) return undefined;
  const arrival = fields(await keyValue.get(probeKey(asked.probeId)), ['arrivedAt']);
  const arrived = arrival === undefined ? Number.NaN : Date.parse(arrival.arrivedAt);
  if (!Number.isNaN(arrived)) {
    return DeliveryCheck.parse({
      probeId: asked.probeId,
      state: 'arrived',
      requestedAt: new Date(requested).toISOString(),
      arrivedAt: new Date(arrived).toISOString(),
      milliseconds: Math.max(0, arrived - requested),
    });
  }
  const lost = now.getTime() - requested > PROBE_TTL_SECONDS * 1000;
  return DeliveryCheck.parse({
    probeId: asked.probeId,
    state: lost ? 'lost' : 'waiting',
    requestedAt: new Date(requested).toISOString(),
    arrivedAt: null,
    milliseconds: null,
  });
}
