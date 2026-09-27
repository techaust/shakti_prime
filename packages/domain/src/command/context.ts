import type { Principal } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import type { z } from 'zod';
import type { Command } from './define-command';

/**
 * An event a command wants delivered after commit. The runner checks it against the event
 * catalogue in `@shakti/contracts` and stores it in `outbox_events` with the change (ADR 0005).
 */
export interface DomainEvent {
  type: string;
  entityId: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/**
 * What a command changed, for the audit row (docs/design/backend-weeks-3-5.md §3.2). The runner
 * redacts `before` and `after`. `entityId` null marks a change that belongs to no one entity (a
 * user, a shared price); left out, the request's single entity is used.
 */
export interface AuditChange {
  aggregateType: string;
  aggregateId: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
}

/** What a command handler receives (docs/ARCHITECTURE.md §5). It never opens its own connection. */
export interface CommandContext {
  principal: Principal;
  entityIds: readonly number[];
  /** Set when the request is narrowed to a single entity. */
  activeEntityId: number | undefined;
  tx: RequestTx;
  emit: (event: DomainEvent) => void;
  /** Records one changed aggregate; call once per aggregate the command touches. */
  audit: (change: AuditChange) => void;
  now: Date;
  requestId: string;
  /**
   * Runs another command as the same caller inside this transaction, with its own guard, DTO,
   * audit rows and events; `tx` narrows it to a savepoint the handler opened. Imports commit
   * their rows through here, so a lead from a file is made exactly as one typed in.
   */
  run: <I extends z.ZodType, O extends z.ZodType>(
    command: Command<I, O>,
    input: unknown,
    options?: NestedRunOptions,
  ) => Promise<z.output<O>>;
}

export interface NestedRunOptions {
  idempotencyKey?: string;
  tx?: RequestTx;
}
