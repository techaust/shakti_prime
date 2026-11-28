import {
  isDomainError,
  type Principal,
  type SyncCommand,
  type SyncCommandResult,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray } from 'drizzle-orm';
import { executeCommand, executeQuery, type ExecuteOptions } from '../command/execute';
import {
  answerFailure,
  fieldsNewerOnServer,
  sameValue,
  type FailureAnswer,
} from './conflicts';
import { pushableCommand, type SyncCollectionSpec } from './collections';
import { readSyncRecords } from './pull';

/**
 * `POST /api/v1/sync/push` (docs/03-roadmap-appendix/phase4.md §7.4, ADR 0012): the commands the
 * field app recorded offline, applied in the order sent, each through `executeCommand()` as the
 * person with its own idempotency key (the key-value front, then `idempotency_keys`), each in its
 * own transaction, so one refused command never undoes another.
 *
 * Each is answered
 * - `applied` (it ran now) or `replayed` (its key had run already: its first answer, nothing ran
 *   again, so a batch sent twice after a lost answer moves nothing twice);
 * - `conflict`, by its collection's rule (`conflicts.ts`), with the record as the person holds it
 *   now (null when they no longer hold it), for the Conflicts screen;
 * - `rejected`, with the error's code and reason;
 * - `held`, when an earlier command of the batch for the same record conflicted or was refused:
 *   it is not run, and the app sends it again once the person has chosen.
 *
 * Only the commands a collection lists may be pushed; any other name is refused
 * (`sync_command_unknown`), so a phone reaches no command the field app does not use.
 */

export interface SyncPushOptions {
  requestId: string;
  /** The command options every pushed command runs with (the audit's client, the outbox nudge). */
  execute: Omit<ExecuteOptions, 'idempotencyKey'>;
}

/** The keys of this batch the person has used before: those commands are replays. */
function usedKeys(keys: readonly string[]) {
  return async function syncUsedKeys(ctx: RequestContext): Promise<Set<string>> {
    const k = schema.idempotencyKeys;
    const rows = await ctx.tx
      .select({ key: k.key })
      .from(k)
      .where(and(eq(k.principalId, ctx.principal.id), inArray(k.key, [...keys])));
    return new Set(rows.map((r) => r.key));
  };
}

/** The company a command's input names, when the person works there: the command's scope. */
function scopeOf(input: Readonly<Record<string, unknown>>): number[] | undefined {
  const entityId = input.entityId;
  return typeof entityId === 'number' && Number.isInteger(entityId) ? [entityId] : undefined;
}

export async function syncPush(
  principal: Principal,
  commands: readonly SyncCommand[],
  options: SyncPushOptions,
): Promise<SyncCommandResult[]> {
  const { requestId } = options;
  const read = <T>(name: string, entityIds: number[] | undefined, fn: (ctx: RequestContext) => Promise<T>) =>
    executeQuery(principal, { requestId, ...(entityIds === undefined ? {} : { entityIds }) }, fn, {
      name,
      // `idempotency_keys` is read on the person's own pool, where its policy lets them see theirs.
      pool: 'app_user',
      ...(options.execute.logger === undefined ? {} : { logger: options.execute.logger }),
    });

  const used = await read(
    'syncUsedKeys',
    undefined,
    usedKeys(commands.map((c) => c.idempotencyKey)),
  );
  /** Records whose earlier command of this batch failed, with that command's key. */
  const blocked = new Map<string, string>();
  const results: SyncCommandResult[] = [];

  /** The record as the person holds it now, or null. */
  const serverRecord = async (
    collection: SyncCollectionSpec,
    id: string,
    entityIds: number[] | undefined,
  ): Promise<Record<string, unknown> | null> => {
    try {
      const records = await read('syncRecord', entityIds, (ctx) =>
        readSyncRecords(ctx.tx, collection, [id]),
      );
      return records.get(id) ?? null;
    } catch (error) {
      // A company outside the person's is refused before any read: they hold nothing there.
      if (isDomainError(error) && error.code === 'forbidden') return null;
      throw error;
    }
  };

  for (const command of commands) {
    const base = { idempotencyKey: command.idempotencyKey, id: command.id };
    const blocker = blocked.get(command.id);
    if (blocker !== undefined) {
      results.push({ ...base, status: 'held', blockedBy: blocker });
      continue;
    }
    const pushable = pushableCommand(command.name);
    if (pushable === undefined) {
      blocked.set(command.id, command.idempotencyKey);
      results.push({
        ...base,
        status: 'rejected',
        error: { code: 'validation_failed', reason: 'sync_command_unknown' },
      });
      continue;
    }
    const { collection, spec } = pushable;
    const entityIds = scopeOf(command.input);
    const replay = used.has(command.idempotencyKey);

    let input: Record<string, unknown> = command.input;
    let newerOnServer: string[] = [];
    let run = true;
    if (spec.merge !== undefined) {
      const merge = spec.merge;
      const server = await read('syncMergeFacts', entityIds, (ctx) =>
        merge.server(ctx.tx, command.input),
      ).catch((error: unknown) => {
        if (isDomainError(error) && error.code === 'forbidden') return undefined;
        throw error;
      });
      if (server !== undefined) {
        const sent = merge.sent(command.input);
        newerOnServer = fieldsNewerOnServer({
          sent,
          server: server.values,
          stamps: server.stamps,
          clientTime: command.clientTime,
          personId: principal.id,
        });
        if (newerOnServer.length > 0) {
          const keep = new Set(Object.keys(sent).filter((f) => !newerOnServer.includes(f)));
          input = merge.narrow(command.input, keep, server.values);
          // Nothing left that the server lacks: the person's other fields are there already.
          run = [...keep].some((f) => !sameValue(sent[f], server.values[f]));
        }
      }
    }

    let output: unknown;
    let failure: unknown;
    if (run) {
      try {
        output = await executeCommand(
          principal,
          { requestId, ...(entityIds === undefined ? {} : { entityIds }) },
          spec.command,
          input,
          { ...options.execute, idempotencyKey: command.idempotencyKey },
        );
      } catch (error) {
        failure = error;
      }
    }

    if (failure === undefined && newerOnServer.length === 0) {
      results.push({
        ...base,
        status: replay ? 'replayed' : 'applied',
        output: (output ?? {}) as Record<string, unknown>,
      });
      continue;
    }

    let answer: FailureAnswer;
    let server: Record<string, unknown> | null;
    if (failure === undefined) {
      answer = { status: 'conflict', reason: 'field_newer_on_server' };
      server = await serverRecord(collection, command.id, entityIds);
    } else {
      server = await serverRecord(collection, command.id, entityIds);
      answer = answerFailure(failure, collection.conflict, server !== null);
      if (answer.status === 'rejected' && answer.code === 'internal' && !isDomainError(failure)) {
        options.execute.logger?.log('error', 'sync.push_command_failed', {
          requestId,
          command: command.name,
          error: failure,
        });
      }
    }
    blocked.set(command.id, command.idempotencyKey);
    results.push(
      answer.status === 'conflict'
        ? {
            ...base,
            status: 'conflict',
            reason: answer.reason,
            server: answer.reason === 'record_removed' ? null : server,
          }
        : {
            ...base,
            status: 'rejected',
            error: { code: answer.code, ...(answer.reason === undefined ? {} : { reason: answer.reason }) },
          },
    );
  }
  return results;
}
