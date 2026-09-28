import { DomainError, newId, serializeGrants, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { rawDb, type Db } from './client';

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
   * A read: the transaction is read-only from its first statement, and so is the connection
   * until the call ends, so a `commit` issued inside cannot be followed by a write on the same
   * connection either. The connection goes back to the pool as it came.
   */
  readOnly?: boolean;
}

/**
 * A read's extra settings, in the request's first statement (no extra round trip): this
 * transaction read-only (as `set transaction read only`), and the connection's default for any
 * transaction after it, until the call resets it.
 */
const READ_ONLY_SETTINGS = sql`,
        set_config('transaction_read_only', 'on', true),
        set_config('default_transaction_read_only', 'on', false)`;

/** Postgres int[] literal for `app.entity_ids`, e.g. `{1,2}`. Empty scope yields `{}`, which denies. */
export function entityIdsLiteral(entityIds: readonly number[]): string {
  return `{${entityIds.join(',')}}`;
}

/**
 * The single entry point for database access (docs/ARCHITECTURE.md §4, docs/DATABASE.md §4.1).
 * Opens a transaction and sets the transaction-local settings every RLS policy reads. A request
 * that narrows to entities the principal does not hold is refused before any query runs.
 *
 * With `readOnly`, the same first statement also makes the transaction read-only and sets the
 * connection's default for new transactions to read-only. A statement that ends the transaction
 * early (`commit`) therefore leaves the rest of the call on a connection where every statement is
 * its own read-only transaction; the default is reset when the call ends, whichever way it ends
 * (a rolled-back transaction reverts it by itself).
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
  const requestId = scope.requestId ?? newId();
  const readOnly = options.readOnly === true;
  // A request narrowed to one entity acts with the caller's team there, even when the principal
  // was resolved in All-companies mode, where no single team applies (AUDIT M24).
  const only = requested.length === 1 ? requested[0] : undefined;
  const entityTeam = principal.entityTeams?.find((t) => t.entityId === only)?.teamId;
  const acting: Principal =
    entityTeam !== undefined && principal.teamId === undefined
      ? { ...principal, teamId: entityTeam }
      : principal;
  return rawDb().transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.user_id', ${principal.id}, true),
        set_config('app.entity_ids', ${entityIdsLiteral(requested)}, true),
        set_config('app.role', ${principal.roleKey}, true),
        set_config('app.permissions', ${serializeGrants(principal.permissions)}, true),
        set_config('app.team_id', ${acting.teamId ?? ''}, true),
        set_config('app.request_id', ${requestId}, true),
        set_config('DateStyle', 'ISO, YMD', true)${readOnly ? READ_ONLY_SETTINGS : sql``}
    `);
    const ctx = { principal: acting, entityIds: requested, requestId, tx };
    if (!readOnly) return fn(ctx);
    try {
      return await fn(ctx);
    } finally {
      // In an aborted transaction this fails, and the rollback reverts the default instead.
      await tx.execute(sql`reset default_transaction_read_only`).catch(() => undefined);
    }
  });
}
