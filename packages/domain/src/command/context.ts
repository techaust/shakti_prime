import type { Principal } from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';

/** An event a command wants delivered after commit. Persisted to `outbox_events` (ADR 0005). */
export interface DomainEvent {
  type: string;
  entityId: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** What a command handler receives (docs/ARCHITECTURE.md §5). It never opens its own connection. */
export interface CommandContext {
  principal: Principal;
  entityIds: readonly number[];
  /** Set when the request is narrowed to a single entity. */
  activeEntityId: number | undefined;
  tx: RequestTx;
  emit: (event: DomainEvent) => void;
  now: Date;
  requestId: string;
}
