import { DomainError, newId, serializeGrants, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { rawDb, readerDb, type Db } from './client';

/** The transaction handed to commands and queries. */
export type RequestTx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface RequestScope {
  /** Entities active for this request. Defaults to every entity the principal may see. */
  entityIds?: readonly number[];
  requestId?: string;
}

export interface RequestContext {
  principal: Principal;
  entityIds: readonly number[];
  requestId: string;
  tx: RequestTx;
}

export interface RequestOptions {
  /**
   * A read: the transaction is read-only from its first statement. The setting is local to the
   * transaction, as every setting here is: through Supavisor in transaction mode a server
   * connection passes to another client when the transaction ends (docs/05-database.md §1).
   */
  readOnly?: boolean;
  /**
   * Run on the `app_reader` pool (`DATABASE_URL_READER`) instead of `app_user`'s: the role itself
   * may only select, so a write fails for want of the privilege as well. Implies `readOnly`.
   */
  reader?: boolean;
}

/**
 * A read's extra setting, in the request's first statement (no extra round trip): this
 * transaction read-only, as `set transaction read only` makes it, and nothing beyond it.
 */
const READ_ONLY_SETTING = sql`,
        set_config('transaction_read_only', 'on', true)`;

/** Postgres int[] literal for `app.entity_ids`, e.g. `{1,2}`. Empty scope yields `{}`, which denies. */
export function entityIdsLiteral(entityIds: readonly number[]): string {
  return `{${entityIds.join(',')}}`;
}

/**
 * The single entry point for database access (docs/04-architecture.md §4, docs/05-database.md §4.1).
 * Opens a transaction and sets the transaction-local settings every RLS policy reads. A request
 * that narrows to entities the principal does not hold is refused before any query runs.
 *
 * With `readOnly`, the same first statement also makes the transaction read-only. Every setting
 * is transaction-local, so nothing outlives the transaction on a pooled server connection. A
 * function that ends the transaction early (`commit`) takes the RLS settings with it, so a write
 * after that is refused by row security, which fails closed without them.
 */
export async function withRequestContext<T>(
  principal: Principal,
  scope: RequestScope,
  fn: (ctx: RequestContext) => Promise<T>,
  options: RequestOptions = {},
): Promise<T> {
  const requested = scope.entityIds ?? principal.entityIds;
  const outside = requested.filter((id) => !principal.entityIds.includes(id));
  if (outside.length > 0) {
    throw new DomainError('forbidden', 'request scope includes entities outside the principal', {
      entityIds: outside,
    });
  }
  // A voice session acts as its person (docs/07-security.md §3.4): `app.user_id` stays the
  // person's, and `app.voice_session_id` marks the request so the audit trail names the session
  // and the merge definers refuse it. A voice principal without its session is refused outright.
  const voiceSessionId = principal.kind === 'voice_session' ? principal.voiceSessionId : '';
  if (voiceSessionId === undefined) {
    throw new DomainError('forbidden', 'a voice session principal must name its session');
  }
  const requestId = scope.requestId ?? newId();
  // A request narrowed to one entity acts with the caller's team there, even when the principal
  // was resolved in All-companies mode, where no single team applies (AUDIT M24).
  const only = requested.length === 1 ? requested[0] : undefined;
  const entityTeam = principal.entityTeams?.find((t) => t.entityId === only)?.teamId;
  const acting: Principal =
    entityTeam !== undefined && principal.teamId === undefined
      ? { ...principal, teamId: entityTeam }
      : principal;
  const readOnly = options.readOnly === true || options.reader === true;
  const db = options.reader === true ? readerDb() : rawDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.user_id', ${principal.id}, true),
        set_config('app.entity_ids', ${entityIdsLiteral(requested)}, true),
        set_config('app.role', ${principal.roleKey}, true),
        set_config('app.permissions', ${serializeGrants(principal.permissions)}, true),
        set_config('app.team_id', ${acting.teamId ?? ''}, true),
        set_config('app.request_id', ${requestId}, true),
        set_config('app.voice_session_id', ${voiceSessionId}, true),
        set_config('DateStyle', 'ISO, YMD', true)${readOnly ? READ_ONLY_SETTING : sql``}
    `);
    return fn({ principal: acting, entityIds: requested, requestId, tx });
  });
}
