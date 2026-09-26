import {
  DomainError,
  hasGrant,
  type Locale,
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
  locale?: Locale;
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
    locale: options.locale ?? context.principal.locale,
  };

  const result = await command.handler(ctx, parsed.data);
  const output = command.output.safeParse(result);
  if (!output.success) {
    throw new DomainError('internal', `${command.name} returned data outside its DTO`, {
      issues: output.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  await options.onAudit?.({
    command: command.name,
    principalId: context.principal.id,
    entityIds: context.entityIds,
    requestId: context.requestId,
    input: parsed.data,
    at: now,
  });
  if (events.length > 0) await options.onEmit?.(events);

  return output.data;
}
