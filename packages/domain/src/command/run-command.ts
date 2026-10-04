import {
  DomainError,
  hasGrant,
  parseEventPayload,
  type PermissionKey,
  type Principal,
  type Scope,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import type { z } from 'zod';
import { redactForAudit } from '../audit/redact';
import { inputHash } from '../idempotency/hash';
import { databaseIdempotencyStore, type IdempotencyStore } from '../idempotency/store';
import type { AuditRecord, AuditSink, ClientMeta } from '../audit/sink';
import type { OutboxRecord, OutboxSink } from '../outbox/sink';
import type { FieldCipher } from '../privacy/field-cipher';
import type { AuditChange, CommandContext } from './context';
import type { Command } from './define-command';

export interface RunOptions {
  /** The open request context from `withRequestContext()`. */
  context: RequestContext;
  now?: Date;
  /** Where the audit rows go (required since review 3; `executeCommand` passes the database). */
  audit: AuditSink;
  /**
   * False only on a runtime that is not hosted (a developer's machine, CI), where a command may
   * accept what only such a runtime may (a file no scanner looked at). Left out, the runtime is
   * taken to be hosted.
   */
  hosted?: boolean;
  /** The caller's address and device, recorded on the audit row. */
  client?: ClientMeta;
  /** Where emitted events go (required since slice 3; `executeCommand` passes `outbox_events`). */
  outbox: OutboxSink;
  /**
   * The caller's key for this call (docs/API.md §1). With one, the command acts once per caller
   * and key: a repeat with the same input replays the first answer, with other input it is refused.
   */
  idempotencyKey?: string;
  /** Where keys live; `idempotency_keys` unless a test passes the in-memory store. */
  idempotency?: IdempotencyStore;
  /**
   * Seals and opens sensitive fields (`FieldCipher`, docs/SECURITY.md §5): KMS on a hosted runtime,
   * the local key elsewhere. A command that stores such a field answers `integration_unavailable`
   * without it.
   */
  fieldCipher?: FieldCipher;
}

/** Collects what an inner command writes, for its caller to write with its own rows. */
function holdIn<T>(held: T[]): { write: (tx: unknown, records: readonly T[]) => Promise<void> } {
  return {
    write(_tx, records) {
      held.push(...records);
      return Promise.resolve();
    },
  };
}

/** For an inner command whose caller writes one summary row instead (`auditedByCaller`). */
const DISCARD_AUDIT: AuditSink = { write: () => Promise.resolve() };

/**
 * Where a command stopped: `input` (the input did not parse, nothing ran), `guard` (the
 * permission guard refused) or `handler` (the handler, the DTO check or the audit and outbox
 * writes). `executeCommand` reads it to choose the outcome of the audit row it writes after the
 * rollback; the parsed input travels with it so that row can record what was asked.
 */
export type FailureStage = 'input' | 'guard' | 'handler';

interface Failure {
  stage: FailureStage;
  input: unknown;
}

const failures = new WeakMap<object, Failure>();

function tag<E>(error: E, stage: FailureStage, input: unknown): E {
  if (typeof error === 'object' && error !== null && !failures.has(error)) {
    failures.set(error, { stage, input });
  }
  return error;
}

/** The stage and parsed input of an error thrown by `runCommand`, if it came from there. */
export function failureOf(error: unknown): Failure | undefined {
  return typeof error === 'object' && error !== null ? failures.get(error) : undefined;
}

/** The fields every audit row of one call shares. */
export function auditBase(
  principal: Principal,
  command: string,
  requestId: string,
  client: ClientMeta = {},
): Pick<
  AuditRecord,
  'command' | 'actorPrincipalId' | 'actorKind' | 'onBehalfOfUserId' | 'requestId' | 'client'
> {
  return {
    command,
    actorPrincipalId: principal.id,
    actorKind: principal.kind,
    onBehalfOfUserId: null,
    requestId,
    client,
  };
}

/** The input as an audit row records it: the command's summary when it has one, redacted. */
export function auditedInput<I extends z.ZodType, O extends z.ZodType>(
  command: Pick<Command<I, O>, 'auditInput'>,
  input: z.output<I>,
): unknown {
  return redactForAudit(command.auditInput === undefined ? input : command.auditInput(input));
}

/** An id is an internal reference: the Activity log never names it, so it needs no declaring. */
const REFERENCE_KEY = /^id$|Ids?$/;

/**
 * The keys of a change's `before` and `after` that the command does not list in `auditFields`,
 * ids aside. Read by the runner, which refuses them outside production (see `auditFields`).
 */
export function undeclaredAuditFields(
  declared: readonly string[],
  change: Pick<AuditChange, 'before' | 'after'>,
): string[] {
  const keys = [change.before, change.after].flatMap((side) =>
    typeof side === 'object' && side !== null && !Array.isArray(side) ? Object.keys(side) : [],
  );
  return [...new Set(keys)].filter((k) => !REFERENCE_KEY.test(k) && !declared.includes(k)).sort();
}

/**
 * Outside production a change with an undeclared field fails the command, so the tests of every
 * command keep its list true. In production the row is written as it is: the Activity log shows
 * an unnamed field in plain words, which is better than refusing the change.
 */
const STRICT_AUDIT_FIELDS = process.env.NODE_ENV !== 'production';

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

/**
 * The command's own permission: declared once, or named by the input for a command of several
 * kinds. An input no request may send (its permission is null) is refused like a missing grant.
 */
function guardPermission<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: z.output<I>,
): void {
  if (typeof command.permission === 'string') {
    checkPermission(principal, command.permission, command.minScope ?? 'own');
    return;
  }
  const needed = command.permission.of(input);
  if (needed === null) {
    throw new DomainError('forbidden', `${command.name} is not open for this input`);
  }
  checkPermission(principal, needed.permission, needed.minScope);
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
export const RUNNER_REASONS = [
  'concurrent_change',
  'database_rejected',
  'idempotency_mismatch',
] as const;

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
 * audit rows and events in the same transaction. Denied calls throw `forbidden` before the handler
 * runs; every error carries its stage for `executeCommand` (see `failureOf`).
 */
export function runCommand<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  options: RunOptions,
  rawInput: unknown,
): Promise<z.output<O>> {
  return runWithin(command, options, rawInput, false);
}

/**
 * `runCommand`, and the one place `inImportBatch` is set: only `ctx.run` passes true, for a row an
 * import batch commits (`NestedRunOptions`). No option of `runCommand` or `executeCommand` sets it.
 */
async function runWithin<I extends z.ZodType, O extends z.ZodType>(
  command: Command<I, O>,
  options: RunOptions,
  rawInput: unknown,
  inImportBatch: boolean,
): Promise<z.output<O>> {
  const { context } = options;
  const parsed = command.input.safeParse(rawInput);
  if (!parsed.success) {
    throw tag(
      new DomainError('validation_failed', `invalid input for ${command.name}`, {
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
      'input',
      undefined,
    );
  }

  try {
    guardPermission(context.principal, command, parsed.data);
    for (const also of command.alsoRequires ?? []) {
      checkPermission(context.principal, also.permission, also.minScope);
    }
  } catch (e) {
    throw tag(e, 'guard', parsed.data);
  }

  // A key is claimed after the guard, so a refused caller learns nothing about an earlier call,
  // and before the handler, so a repeat never runs it twice (docs/design/backend-weeks-3-5.md §5).
  const key = options.idempotencyKey;
  const store = options.idempotency ?? databaseIdempotencyStore;
  if (key !== undefined) {
    const hash = inputHash(command.name, parsed.data);
    let claim: Awaited<ReturnType<IdempotencyStore['claim']>>;
    try {
      claim = await store.claim(context.tx, {
        principalId: context.principal.id,
        key,
        command: command.name,
        inputHash: hash,
      });
    } catch (e) {
      throw tag(
        translateDatabaseError(e, command.name, command.constraintReasons),
        'handler',
        parsed.data,
      );
    }
    if (claim.kind === 'seen') {
      if (claim.command !== command.name || claim.inputHash !== hash) {
        throw tag(
          new DomainError('conflict', `${command.name} got a used key with other input`, {
            reason: 'idempotency_mismatch',
          }),
          'handler',
          parsed.data,
        );
      }
      // Nothing changes on a replay, so it writes no audit row and no event.
      const replay = command.output.safeParse(claim.response);
      if (!replay.success) {
        throw tag(
          new DomainError('internal', `${command.name} stored an answer outside its DTO`),
          'handler',
          parsed.data,
        );
      }
      return replay.data;
    }
  }

  const now = options.now ?? new Date();
  const events: OutboxRecord[] = [];
  const changes: AuditChange[] = [];
  // What commands run through `ctx.run` recorded, written with this command's own rows at the end.
  const innerAudit: AuditRecord[] = [];
  const innerEvents: OutboxRecord[] = [];
  const activeEntityId = context.entityIds.length === 1 ? context.entityIds[0] : undefined;
  const ctx: CommandContext = {
    principal: context.principal,
    entityIds: context.entityIds,
    activeEntityId,
    tx: context.tx,
    inImportBatch,
    hosted: options.hosted !== false,
    ...(options.fieldCipher === undefined ? {} : { fieldCipher: options.fieldCipher }),
    // Checked against the catalogue here, so a bad event fails the command that emits it.
    emit: (event) => {
      const parsed = parseEventPayload(event.type, event.payload);
      if (!parsed.ok) {
        throw new DomainError(
          'internal',
          `${command.name} emitted an event outside the catalogue`,
          {
            eventType: event.type,
            problem: parsed.problem,
            issues: parsed.issues,
          },
        );
      }
      events.push({ ...event, payload: parsed.payload });
    },
    audit: (change) => {
      if (STRICT_AUDIT_FIELDS) {
        const undeclared = undeclaredAuditFields(command.auditFields, change);
        if (undeclared.length > 0) {
          throw new DomainError('internal', `${command.name} audited fields it does not declare`, {
            fields: undeclared,
          });
        }
      }
      changes.push(change);
    },
    now,
    requestId: context.requestId,
    run: async (inner, innerInput, nested = {}) => {
      try {
        return await runWithin(
          inner,
          {
            context: { ...context, tx: nested.tx ?? context.tx },
            now,
            audit: nested.auditedByCaller === true ? DISCARD_AUDIT : holdIn(innerAudit),
            outbox: holdIn(innerEvents),
            ...(options.client === undefined ? {} : { client: options.client }),
            ...(options.hosted === undefined ? {} : { hosted: options.hosted }),
            ...(options.idempotency === undefined ? {} : { idempotency: options.idempotency }),
            ...(options.fieldCipher === undefined ? {} : { fieldCipher: options.fieldCipher }),
            ...(nested.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: nested.idempotencyKey }),
          },
          innerInput,
          nested.inImportBatch === true,
        );
      } catch (e) {
        // The outer command records its own stage and input, never the inner one's.
        if (typeof e === 'object' && e !== null) failures.delete(e);
        throw e;
      }
    },
    savepoint: async (work) => {
      const marks = [changes.length, events.length, innerAudit.length, innerEvents.length];
      try {
        return await context.tx.transaction((sp) => work(sp));
      } catch (e) {
        // The rows are gone with the savepoint; so is everything recorded for them.
        changes.length = marks[0] ?? 0;
        events.length = marks[1] ?? 0;
        innerAudit.length = marks[2] ?? 0;
        innerEvents.length = marks[3] ?? 0;
        throw e;
      }
    },
  };

  let result: z.input<O>;
  try {
    result = await command.handler(ctx, parsed.data);
  } catch (e) {
    throw tag(
      translateDatabaseError(e, command.name, command.constraintReasons),
      'handler',
      parsed.data,
    );
  }
  const output = command.output.safeParse(result);
  if (!output.success) {
    throw tag(
      new DomainError('internal', `${command.name} returned data outside its DTO`, {
        issues: output.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      }),
      'handler',
      parsed.data,
    );
  }

  // One row per changed aggregate, or one row for the call when the handler named none.
  const base = auditBase(context.principal, command.name, context.requestId, options.client);
  const input = auditedInput(command, parsed.data);
  const rows: Partial<AuditChange>[] = changes.length > 0 ? changes : [{}];
  const records: AuditRecord[] = rows.map((change) => ({
    ...base,
    outcome: 'ok',
    entityId: change.entityId === undefined ? (activeEntityId ?? null) : change.entityId,
    aggregateType: change.aggregateType ?? null,
    aggregateId: change.aggregateId ?? null,
    errorCode: null,
    input,
    before: 'before' in change ? redactForAudit(change.before) : null,
    after: 'after' in change ? redactForAudit(change.after) : null,
  }));

  // The audit, outbox and key writes share the transaction, so their failures translate alike.
  try {
    await options.audit.write(context.tx, [...innerAudit, ...records]);
    await options.outbox.write(context.tx, [...innerEvents, ...events]);
    if (key !== undefined) await store.complete(context.tx, context.principal.id, key, output.data);
  } catch (e) {
    throw tag(
      translateDatabaseError(e, command.name, command.constraintReasons),
      'handler',
      parsed.data,
    );
  }

  return output.data;
}
