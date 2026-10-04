import type { Principal } from '@shakti/contracts';
import type { FieldCipher } from '../privacy/field-cipher';
import type { RequestTx } from '@shakti/db';
import type { z } from 'zod';
import type { ActivityRecord } from '../activities/activity';
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
  /**
   * Writes one row of the customer timeline in this transaction (docs/ARCHITECTURE.md §5), as the
   * caller and under the insert policy, so the caller must read the lead or customer at that
   * moment: a command that hands a lead to someone else records the row first. A savepoint that
   * rolls back takes the row with it.
   */
  activity: (record: ActivityRecord) => Promise<void>;
  now: Date;
  requestId: string;
  /** The runtime is hosted (`RunOptions.hosted`); true unless the caller said it is not. */
  hosted: boolean;
  /** The runtime's field cipher (`RunOptions.fieldCipher`), for a command that seals a field. */
  fieldCipher?: FieldCipher;
  /**
   * Set when an import batch runs this command for one of its rows (`NestedRunOptions`): the
   * command then leaves out what only a person's own save needs, such as holding a new number.
   */
  inImportBatch?: boolean;
  /**
   * Runs another command as the same caller inside this transaction, with its own guard, DTO and
   * idempotency key. Its audit rows and events are held and written with this command's own, so a
   * `savepoint` that rolls back drops them too. Imports commit their rows through here, so a lead
   * from a file is made exactly as one typed in.
   */
  run: <I extends z.ZodType, O extends z.ZodType>(
    command: Command<I, O>,
    input: unknown,
    options?: NestedRunOptions,
  ) => Promise<z.output<O>>;
  /**
   * Runs `work` in a savepoint of this transaction. If it throws, the savepoint rolls back, and
   * the audit changes, events and inner commands' rows recorded inside it are dropped with it.
   */
  savepoint: <T>(work: (tx: RequestTx) => Promise<T>) => Promise<T>;
}

export interface NestedRunOptions {
  idempotencyKey?: string;
  /** The savepoint's transaction, from `savepoint`. */
  tx?: RequestTx;
  /**
   * The calling command records one summary audit row for this and its sibling calls (an import
   * batch, design §8), so the inner command writes no audit row of its own.
   */
  auditedByCaller?: boolean;
  /** The caller is an import batch committing one of its rows (`CommandContext.inImportBatch`). */
  inImportBatch?: boolean;
}
