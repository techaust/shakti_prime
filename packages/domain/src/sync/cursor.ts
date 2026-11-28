import { CursorSchema } from '@shakti/contracts';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The field app's pull cursor (docs/03-roadmap-appendix/phase4.md §7.4, ADR 0012): opaque to the
 * app, signed by the server for one person and their companies, and versioned.
 *
 * It holds no row of anyone's and no timestamp the app could edit: a cursor changed by hand, made
 * for another person or for another set of companies, or of another version, fails its signature
 * and is answered as an expired one (the app starts a full pull, which reads under the person's own
 * row security like every pull).
 *
 * What it holds:
 * - `base`: the last round of pulls that finished. Its start is every covered collection's
 *   high-water mark (less the overlap the pull allows for transactions still open then), its
 *   membership hash is what the next round compares the person's working set with, and `covered`
 *   names the collections (by their versioned codes) the marks are for. A collection added or
 *   versioned since is read from its start.
 * - `round`: a round still paging: its start, its membership hash, and where its last page stopped.
 */

export const SYNC_CURSOR_VERSION = 1;

export interface CursorRound {
  /** The round's start, the database's time in milliseconds since 1970. */
  at: number;
  /** The membership hash of the person's working set at the round's start. */
  membership: string;
}

export interface CursorPosition {
  /** The collection the last page stopped in, by its code. */
  code: string;
  /** The last row's change time in microseconds since 1970, as decimal digits. */
  changedUs: string;
  id: string;
}

export interface SyncCursorState {
  base?: CursorRound & { covered: readonly string[] };
  round?: CursorRound & { position: CursorPosition };
}

/** Who a cursor is for: the person and the companies of the pull. */
export interface CursorOwner {
  personId: string;
  entityIds: readonly number[];
}

/** The signature's length in bytes: 128 bits, ample for a value nobody may forge. */
const SIGNATURE_BYTES = 16;
const CODE = /^[a-z]{2}[0-9]{1,3}$/;
const HASH = /^[A-Za-z0-9_-]{8,32}$/;
const DIGITS = /^[0-9]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function signature(key: Uint8Array, owner: CursorOwner, payload: string): Buffer {
  const companies = [...owner.entityIds].sort((a, b) => a - b).join(',');
  return createHmac('sha256', key)
    .update(`sync-cursor\n${owner.personId}\n${companies}\n${payload}`)
    .digest()
    .subarray(0, SIGNATURE_BYTES);
}

const b36 = (ms: number) => Math.floor(ms).toString(36);

/** The cursor for `state`, signed for its owner. */
export function encodeCursor(state: SyncCursorState, owner: CursorOwner, key: Uint8Array): string {
  const body: Record<string, unknown> = { v: SYNC_CURSOR_VERSION };
  if (state.base !== undefined) {
    body.b = [b36(state.base.at), state.base.membership, state.base.covered.join('.')];
  }
  if (state.round !== undefined) {
    const { at, membership, position } = state.round;
    body.r = [b36(at), membership, position.code, position.changedUs, position.id];
  }
  const payload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const cursor = `${payload}.${signature(key, owner, payload).toString('base64url')}`;
  // A cursor longer than the contract allows is a fault in this code, never the app's.
  return CursorSchema.parse(cursor);
}

function roundOf(at: unknown, membership: unknown): CursorRound | undefined {
  if (typeof at !== 'string' || !/^[0-9a-z]{1,12}$/.test(at)) return undefined;
  if (typeof membership !== 'string' || !HASH.test(membership)) return undefined;
  const ms = Number.parseInt(at, 36);
  return Number.isSafeInteger(ms) ? { at: ms, membership } : undefined;
}

/**
 * The state a cursor holds, or undefined when it is not one this server signed for this owner in
 * this version: the caller answers that as an expired cursor.
 */
export function decodeCursor(
  cursor: string,
  owner: CursorOwner,
  key: Uint8Array,
): SyncCursorState | undefined {
  const [payload, sent, ...rest] = cursor.split('.');
  if (payload === undefined || sent === undefined || rest.length > 0) return undefined;
  const given = Buffer.from(sent, 'base64url');
  const expected = signature(key, owner, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null) return undefined;
  const { v, b, r } = body as { v?: unknown; b?: unknown; r?: unknown };
  if (v !== SYNC_CURSOR_VERSION) return undefined;
  const state: SyncCursorState = {};
  if (b !== undefined) {
    if (!Array.isArray(b) || b.length !== 3) return undefined;
    const round = roundOf(b[0], b[1]);
    const covered = typeof b[2] === 'string' ? (b[2] === '' ? [] : b[2].split('.')) : undefined;
    if (round === undefined || covered === undefined || !covered.every((c) => CODE.test(c))) {
      return undefined;
    }
    state.base = { ...round, covered };
  }
  if (r !== undefined) {
    if (!Array.isArray(r) || r.length !== 5) return undefined;
    const round = roundOf(r[0], r[1]);
    const [, , code, changedUs, id] = r as unknown[];
    if (
      round === undefined ||
      typeof code !== 'string' ||
      !CODE.test(code) ||
      typeof changedUs !== 'string' ||
      !DIGITS.test(changedUs) ||
      typeof id !== 'string' ||
      !UUID.test(id)
    ) {
      return undefined;
    }
    state.round = { ...round, position: { code, changedUs, id } };
  }
  return state;
}
