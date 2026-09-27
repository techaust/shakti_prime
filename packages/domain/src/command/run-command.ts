import {
  DomainError,
  hasGrant,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import type { z } from 'zod';
import type { CommandContext, DomainEvent } from './context';
import type { Command } from './define-command';

/** What the audit log records for every mutating command (docs/ARCHITECTURE.md §5). */
export interface AuditEntry {
  command: string;
  principalId: string;
  entityIds: readonly number[];
  requestId: string;
  input: unknown;
  at: Date;
}

export interface RunOptions {
  /** The open request context from `withRequestContext()`. */
  context: RequestContext;
  now?: Date;
  /** Receives the audit row. Wired to `audit_logs` when that table exists. */
  onAudit?: (entry: AuditEntry) => Promise<void> | void;
  /** Receives emitted events. Wired to `outbox_events` when that table exists. */
  onEmit?: (events: readonly DomainEvent[]) => Promise<void> | void;
}

/** Pure permission guard: the principal must hold the permission at `minScope` or wider. */
export function checkPermission(
  principal: Principal,
  permission: PermissionKey,
  minScope: Scope = 'own',
): void {
  if (!hasGrant(principal.permissions, permission, minScope)) {
    throw new DomainError('forbidden', `${principal.roleKey} lacks ${permission}:${minScope}`, {
      permission,
      scope: minScope,
    });
  }
}

/** SQLSTATE classes a handler may hit; anything else is an internal error, never a leak. */
const SQLSTATE_CODES: Record<string, DomainError['code']> = {
  '23505': 'conflict', // unique_violation
  '40001': 'conflict', // serialization_failure
  '40P01': 'conflict', // deadlock_detected
  '55P03': 'conflict', // lock_not_available
  '23503': 'validation_failed', // foreign_key_violation
  '23514': 'validation_failed', // check_violation
  '23502': 'validation_failed', // not_null_violation
  '22P02': 'validation_failed', // invalid_text_representation
  '22003': 'validation_failed', // numeric_value_out_of_range
  '23P01': 'validation_failed', // exclusion_violation
  '42501': 'forbidden', // insufficient_privilege (RLS with check, security definer refusals)
};

/** The reasons the runner itself gives; each has a sentence in the catalogue (AUDIT M30). */
export const RUNNER_REASONS = ['concurrent_change', 'database_rejected'] as const;

/** A PostgreSQL SQLSTATE: five digits or capitals. Driver codes such as ECONNREFUSED are not. */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * A handler that hits a database error answers with a domain code and a plain reason; the SQL
 * text stays out of the response and the original failure is kept as the `cause` for the logs.
 * `DomainError`s pass through untouched.
 */
export function translateDatabaseError(
  e: unknown,
  commandName: string,
  constraintReasons: Readonly<Record<string, string>> = {},
): unknown {
  if (e instanceof DomainError) return e;
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  if (!(cause instanceof Error)) return e;
  const sqlstate =
    'code' in cause && typeof cause.code === 'string' && SQLSTATE.test(cause.code)
      ? cause.code
      : undefined;
  if (sqlstate === undefined) return e;
  const constraint =
    'constraint_name' in cause && typeof cause.constraint_name === 'string'
      ? cause.constraint_name
      : undefined;
  const code = SQLSTATE_CODES[sqlstate] ?? 'internal';
  const named = constraint === undefined ? undefined : constraintReasons[constraint];
  const fallback: (typeof RUNNER_REASONS)[number] =
    code === 'conflict' ? 'concurrent_change' : 'database_rejected';
  return new DomainError(
    code,
    `${commandName} hit database error ${sqlstate}`,
    {
      // A policy refusal is a plain "no access"; the forbidden sentence says so.
      ...(code === 'forbidden' && named === undefined ? {} : { reason: named ?? fallback }),
      sqlstate,
      ...(constraint === undefined ? {} : { constraint }),
    },
    { cause: e },
  );
}

/**
 * Runs one command inside an existing request context: validate → guard → handler → strict DTO →
 * audit. Denied calls throw `forbidden` before the handler runs.
 */
export async function runCommand<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  options: RunOptions,
  rawInput: unknown,
): Promise<z.output<O>> {
  const { context } = options;
  const parsed = command.input.safeParse(rawInput);
  if (!parsed.success) {
    throw new DomainError('validation_failed', `invalid input for ${command.name}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  checkPermission(context.principal, command.permission, command.minScope ?? 'own');
  for (const also of command.alsoRequires ?? []) {
    checkPermission(context.principal, also.permission, also.minScope);
  }

  const now = options.now ?? new Date();
  const events: DomainEvent[] = [];
  const ctx: CommandContext = {
    principal: context.principal,
    entityIds: context.entityIds,
    activeEntityId: context.entityIds.length === 1 ? context.entityIds[0] : undefined,
    tx: context.tx,
    emit: (event) => {
      events.push(event);
    },
    now,
    requestId: context.requestId,
  };

  let result: z.input<O>;
  try {
    result = await command.handler(ctx, parsed.data);
  } catch (e) {
    throw translateDatabaseError(e, command.name, command.constraintReasons);
  }
  const output = command.output.safeParse(result);
  if (!output.success) {
    throw new DomainError('internal', `${command.name} returned data outside its DTO`, {
      issues: output.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  // The audit and outbox writes share the transaction, so their failures translate the same way.
  try {
    await options.onAudit?.({
      command: command.name,
      principalId: context.principal.id,
      entityIds: context.entityIds,
      requestId: context.requestId,
      input: parsed.data,
      at: now,
    });
    if (events.length > 0) await options.onEmit?.(events);
  } catch (e) {
    throw translateDatabaseError(e, command.name, command.constraintReasons);
  }

  return output.data;
}
