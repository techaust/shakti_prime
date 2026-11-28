import type { TallyConnectorAuth } from '@shakti/domain';

/**
 * What this function instance last read of each connector (TC2, docs/06-api.md §3.5): its opened
 * keys and mapped companies for a minute, so a connector's calls verify before any database
 * transaction, and a connector id the database did not know, for a minute, so a stream of calls
 * naming unknown ids reads nothing. Only in this process's memory, never logged. The Admin actions
 * forget a connector on the instance that changed it; another instance reads it again within the
 * minute, and every definer checks the live connector and its mapping again anyway.
 */

export const CONNECTOR_KNOWN_FOR_MS = 60_000;
const MAX_ENTRIES = 200;

export interface KnownConnector {
  auth: TallyConnectorAuth;
  /** The current key and, during a rotation, the next one, opened. */
  keys: readonly string[];
  readAt: number;
}

const known = new Map<string, KnownConnector>();
const unknown = new Map<string, number>();

function bounded<V>(map: Map<string, V>): Map<string, V> {
  if (map.size >= MAX_ENTRIES) map.clear();
  return map;
}

/** The connector as read within the last minute, or undefined. */
export function knownConnector(connectorId: string, now = Date.now()): KnownConnector | undefined {
  const hit = known.get(connectorId);
  if (hit === undefined || now - hit.readAt >= CONNECTOR_KNOWN_FOR_MS) return undefined;
  return hit;
}

export function rememberConnector(
  connectorId: string,
  entry: Omit<KnownConnector, 'readAt'>,
  now = Date.now(),
): void {
  unknown.delete(connectorId);
  bounded(known).set(connectorId, { ...entry, readAt: now });
}

/** True when the database did not know this id within the last minute. */
export function isUnknownConnector(connectorId: string, now = Date.now()): boolean {
  const until = unknown.get(connectorId);
  return until !== undefined && until > now;
}

export function rememberUnknownConnector(connectorId: string, now = Date.now()): void {
  known.delete(connectorId);
  bounded(unknown).set(connectorId, now + CONNECTOR_KNOWN_FOR_MS);
}

/** Drops what this instance holds of a connector, after an Executive changed it. */
export function forgetTallyConnector(connectorId: string): void {
  known.delete(connectorId);
  unknown.delete(connectorId);
}
