import { SyncPullResponse, type SyncChange } from '@shakti/contracts';
import type { RequestContext, RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { SYNC_REGISTRY, type SourceRow, type SyncCollectionSpec } from './collections';
import {
  decodeCursor,
  encodeCursor,
  type CursorPosition,
  type CursorRound,
  type SyncCursorState,
} from './cursor';

/**
 * `GET /api/v1/sync/pull` (docs/03-roadmap-appendix/phase4.md §7.4, ADR 0012): the changes to the
 * person's working set since their cursor, a page at a time, read in one read-only transaction as
 * the person, so every collection reads under their own row security.
 *
 * **Rounds.** A pull without a cursor starts a full round; a finished round's cursor starts the
 * next. A round reads each collection's rows changed since its high-water mark (the start of the
 * last finished round, less `SYNC_OVERLAP_MS` for writes still open then, so a row committed late
 * is read next time; reading one twice is harmless), in the registry's order, `(changed_at, id)`
 * ascending, and pages while more wait.
 *
 * **Leaving the working set.** A record the person no longer holds (taken off the project, a
 * project finished long enough ago, a company no longer theirs) cannot be read to be sent as a
 * removal. So each round starts by hashing the ids of the working set as it stands, and compares
 * the part that was surely there at the last round's start (each row's `since`) with that round's
 * hash. When they differ, something left, or something old came in (a person put on a project made
 * long ago): the pull answers `cursor_expired` and the app pulls everything again, keeping only
 * what that full round sends. A record made since is no difference: its change brings it.
 */

/** How far a round looks back past the last one's start, for writes still open then. */
export const SYNC_OVERLAP_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A cursor claiming to start after the server's own clock is not one this server made. */
const CLOCK_SKEW_MS = 60 * 1000;
/** The position at the start of a collection, for a page that ended at a collection's end. */
const START = { changedUs: '0', id: '00000000-0000-0000-0000-000000000000' } as const;

export type SyncPullOutcome =
  | { kind: 'changes'; response: SyncPullResponse }
  /** The cursor is not one this server made for the person, has lapsed, or the set moved. */
  | { kind: 'cursor_expired' };

export interface SyncPullRequest {
  since?: string | undefined;
  limit: number;
  /** The key cursors are signed with (the web derives it from the field app's key pair). */
  cursorKey: Uint8Array;
}

/** The read-only query of one pull, for `executeQuery()`. */
export function syncPull(request: SyncPullRequest): (ctx: RequestContext) => Promise<SyncPullOutcome> {
  return async function syncPullQuery(ctx) {
    const owner = { personId: ctx.principal.id, entityIds: ctx.entityIds };
    let state: SyncCursorState = {};
    if (request.since !== undefined) {
      const decoded = decodeCursor(request.since, owner, request.cursorKey);
      if (decoded === undefined) return { kind: 'cursor_expired' };
      state = decoded;
    }
    const now = await databaseNow(ctx.tx);
    const anchor = state.round?.at ?? state.base?.at;
    if (
      anchor !== undefined &&
      (now - anchor > WORKSHOP_DEFAULTS.field.syncCursorDays * DAY_MS ||
        anchor > now + CLOCK_SKEW_MS)
    ) {
      return { kind: 'cursor_expired' };
    }

    const registry = SYNC_REGISTRY;
    let round: CursorRound;
    let position: CursorPosition | undefined;
    if (state.round === undefined) {
      const hashes = await membership(ctx.tx, registry, state.base?.at);
      if (state.base !== undefined) {
        const covered = new Set(state.base.covered);
        const before = combine(
          registry.filter((c) => covered.has(c.code)).map((c) => [c.code, hashes.get(c.code)?.before]),
        );
        if (before !== state.base.membership) return { kind: 'cursor_expired' };
      }
      round = {
        at: now,
        membership: combine(registry.map((c) => [c.code, hashes.get(c.code)?.now])),
      };
    } else {
      round = { at: state.round.at, membership: state.round.membership };
      position = state.round.position;
    }

    const limit = Math.min(request.limit, WORKSHOP_DEFAULTS.field.syncPageLimit);
    const first = position === undefined ? 0 : registry.findIndex((c) => c.code === position?.code);
    if (first < 0) return { kind: 'cursor_expired' };

    const changes: SyncChange[] = [];
    let stopped: CursorPosition | undefined;
    for (let i = first; i < registry.length; i += 1) {
      const spec = registry[i];
      if (spec === undefined) break;
      const remaining = limit - changes.length;
      if (remaining === 0) {
        stopped = { code: spec.code, ...START };
        break;
      }
      const covered = state.base?.covered.includes(spec.code) === true;
      const mark = covered && state.base !== undefined ? state.base.at - SYNC_OVERLAP_MS : undefined;
      const after = position?.code === spec.code ? position : undefined;
      const rows = await changedRows(ctx.tx, spec, mark, after, remaining + 1);
      const page = rows.slice(0, remaining);
      changes.push(...(await toChanges(ctx.tx, spec, page)));
      if (rows.length > remaining) {
        const last = page.at(-1);
        stopped = { code: spec.code, changedUs: String(last?.changed_us), id: String(last?.id) };
        break;
      }
    }

    const next: SyncCursorState =
      stopped === undefined
        ? { base: { ...round, covered: registry.map((c) => c.code) } }
        : {
            ...(state.base === undefined ? {} : { base: state.base }),
            round: { ...round, position: stopped },
          };
    return {
      kind: 'changes',
      response: SyncPullResponse.parse({
        changes,
        nextCursor: encodeCursor(next, owner, request.cursorKey),
        hasMore: stopped !== undefined,
        serverTime: new Date(now).toISOString(),
      }),
    };
  };
}

/** The transaction's own time, in milliseconds: every row's change time is the database's. */
async function databaseNow(tx: RequestTx): Promise<number> {
  const [row] = (await tx.execute(
    sql`select ((extract(epoch from pg_catalog.now()) * 1000)::bigint)::text as ms`,
  )) as unknown as { ms: string }[];
  return Number(row?.ms);
}

/**
 * Each collection's membership hashes: of every id in the working set now, and of the ids there
 * since before `before` (the last round's start), for comparing with that round's hash.
 */
async function membership(
  tx: RequestTx,
  registry: readonly SyncCollectionSpec[],
  before: number | undefined,
): Promise<Map<string, { now: string; before: string }>> {
  const cutoff = new Date(before ?? 0).toISOString();
  const hashes = new Map<string, { now: string; before: string }>();
  for (const spec of registry) {
    const [row] = (await tx.execute(sql`
      select pg_catalog.md5(coalesce(pg_catalog.string_agg(s.id::text, ',' order by s.id), '')) as now,
             pg_catalog.md5(coalesce(pg_catalog.string_agg(s.id::text, ',' order by s.id)
                                       filter (where s.since < ${cutoff}::timestamptz), '')) as before
        from (${spec.source()}) s`)) as unknown as { now: string; before: string }[];
    hashes.set(spec.code, { now: row?.now ?? '', before: row?.before ?? '' });
  }
  return hashes;
}

/** One hash of the collections' hashes, short enough for the cursor. */
export function combine(parts: readonly (readonly [string, string | undefined])[]): string {
  const digest = createHash('sha256');
  for (const [code, hash] of parts) digest.update(`${code}:${hash ?? ''}\n`);
  return digest.digest('base64url').slice(0, 16);
}

/** The collection's rows changed since `mark`, after `after`, in change order. */
async function changedRows(
  tx: RequestTx,
  spec: SyncCollectionSpec,
  mark: number | undefined,
  after: Omit<CursorPosition, 'code'> | undefined,
  limit: number,
): Promise<SourceRow[]> {
  const since =
    mark === undefined ? sql`` : sql`and s.changed_at >= ${new Date(mark).toISOString()}::timestamptz`;
  const keyset =
    after === undefined
      ? sql``
      : sql`and (s.changed_at, s.id) > (timestamptz 'epoch' + ${after.changedUs}::bigint * interval '1 microsecond', ${after.id}::uuid)`;
  return (await tx.execute(sql`
    select s.*, ((extract(epoch from s.changed_at) * 1000000)::bigint)::text as changed_us
      from (${spec.source()}) s
     where true ${since} ${keyset}
     order by s.changed_at, s.id
     limit ${limit}`)) as unknown as SourceRow[];
}

/** A page's rows as upserts, each record through its collection's strict DTO. */
async function toChanges(
  tx: RequestTx,
  spec: SyncCollectionSpec,
  rows: readonly SourceRow[],
): Promise<SyncChange[]> {
  if (rows.length === 0) return [];
  const records = await spec.toRecords(tx, rows);
  return rows.map((row, i) => ({
    op: 'upsert',
    collection: spec.collection,
    id: String(row.id),
    updatedAt: new Date(Number(BigInt(String(row.changed_us)) / 1000n)).toISOString(),
    record: spec.record.parse(records[i]) as Record<string, unknown>,
  }));
}

/**
 * The records of a collection with these ids that the person holds now, for a conflict's server
 * record; a record they no longer hold is absent, which the push answers as `record_removed`.
 */
export async function readSyncRecords(
  tx: RequestTx,
  spec: SyncCollectionSpec,
  ids: readonly string[],
): Promise<Map<string, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();
  const rows = (await tx.execute(sql`
    select s.* from (${spec.source()}) s
     where s.id = any (${`{${ids.join(',')}}`}::uuid[])`)) as unknown as SourceRow[];
  const records = await spec.toRecords(tx, rows);
  return new Map(
    rows.map((row, i) => [String(row.id), spec.record.parse(records[i]) as Record<string, unknown>]),
  );
}
