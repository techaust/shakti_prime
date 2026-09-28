import { PrincipalSchema, type Principal } from '@shakti/contracts';
import { parseUserAccess, type KeyValue, type UserAccess } from '@shakti/domain';
import { logger } from '../log';

/** How long a resolved principal is cached, and how long a user's version counter lives. */
const PRINCIPAL_CACHE_SECONDS = 60;
const VERSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CachedPrincipal {
  principal: Principal;
  access: UserAccess;
}

const versionKey = (userId: string) => `principal-version:${userId}`;

function parseCached(raw: string): CachedPrincipal | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const principal = PrincipalSchema.safeParse((value as { principal?: unknown }).principal);
  const access = parseUserAccess((value as { access?: unknown }).access);
  return principal.success && access !== undefined
    ? { principal: principal.data, access }
    : undefined;
}

/**
 * The principal cache on the key-value store. It is only an optimisation: an unreachable store
 * or an unreadable entry is a miss, never a failed request (AUDIT C1, M36). Entries are keyed by
 * a per-user version that `invalidate` bumps after a role, status or session change.
 */
export function principalCache(keyValue: KeyValue) {
  return {
    /** The cache key for this session and entity, or undefined when the store cannot be read. */
    async keyFor(
      userId: string,
      sessionId: string,
      entityId: number | undefined,
    ): Promise<string | undefined> {
      try {
        const version = (await keyValue.get(versionKey(userId))) ?? '0';
        return `principal:${sessionId}:${entityId ?? 'all'}:${version}`;
      } catch (e) {
        logger.log('warn', 'principal_cache.miss', {
          note: 'principal cache unavailable, resolving from the database',
          error: e,
        });
        return undefined;
      }
    },
    async read(key: string | undefined): Promise<CachedPrincipal | undefined> {
      if (key === undefined) return undefined;
      try {
        const raw = await keyValue.get(key);
        return raw === null ? undefined : parseCached(raw);
      } catch (e) {
        logger.log('warn', 'principal_cache.miss', {
          note: 'principal cache read failed, resolving from the database',
          error: e,
        });
        return undefined;
      }
    },
    async write(key: string | undefined, value: CachedPrincipal): Promise<void> {
      if (key === undefined) return;
      try {
        await keyValue.set(key, JSON.stringify(value), PRINCIPAL_CACHE_SECONDS);
      } catch (e) {
        logger.log('warn', 'principal_cache.miss', {
          note: 'principal cache write failed',
          error: e,
        });
      }
    },
    /** Drops every cached principal of a user. Errors propagate: a missed invalidation is a stale grant. */
    async invalidate(userId: string): Promise<void> {
      await keyValue.incr(versionKey(userId), VERSION_TTL_SECONDS);
    },
  };
}
