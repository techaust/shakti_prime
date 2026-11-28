import type { KeyValue } from '../ports/key-value';
import type { Logger } from '../ports/logger';

/**
 * The Redis front of `idempotency_keys` (docs/06-api.md §1, the STATUS follow-up "Mobile tokens
 * and the Redis front"): after a call with a key commits, its answer is kept in the key-value store
 * for a day, so the field app's retry of a call whose answer it lost is answered without a
 * transaction. The table stays the authority: the front answers only a repeat of the same command
 * with the same input by the same caller, after the runner's own guard, and anything else (another
 * input, a miss, the store not answering) goes to the table as before.
 */

/** How long an answer stays in front of the table, which keeps its keys for 7 days. */
export const IDEMPOTENCY_FRONT_SECONDS = 24 * 60 * 60;

export interface FrontEntry {
  command: string;
  inputHash: string;
  response: unknown;
}

const frontKey = (principalId: string, key: string) => `idem:${principalId}:${key}`;

function parseEntry(raw: string): FrontEntry | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const entry = value as Partial<FrontEntry>;
    if (typeof entry.command !== 'string' || typeof entry.inputHash !== 'string') return undefined;
    return { command: entry.command, inputHash: entry.inputHash, response: entry.response };
  } catch {
    return undefined;
  }
}

/** The answer kept for this caller and key; undefined on a miss or when the store fails. */
export async function readFront(
  store: KeyValue,
  principalId: string,
  key: string,
  logger: Logger,
): Promise<FrontEntry | undefined> {
  try {
    const raw = await store.get(frontKey(principalId, key));
    return raw === null ? undefined : parseEntry(raw);
  } catch (error) {
    logger.log('warn', 'idempotency.front_miss', { note: 'key-value store unavailable', error });
    return undefined;
  }
}

/** Keeps a committed answer in front of the table; a failure is logged, never the caller's. */
export async function writeFront(
  store: KeyValue,
  principalId: string,
  key: string,
  entry: FrontEntry,
  logger: Logger,
): Promise<void> {
  try {
    await store.set(frontKey(principalId, key), JSON.stringify(entry), IDEMPOTENCY_FRONT_SECONDS);
  } catch (error) {
    logger.log('warn', 'idempotency.front_write_failed', { error });
  }
}
