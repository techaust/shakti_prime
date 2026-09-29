import type { DeliveredEvent, EventType, Principal } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { recordProbeArrival } from './probe';

/** What a handler is given: the system principal for the event's company and the shared store. */
export interface EventHandlerContext {
  /** `system:workers`, scoped to the event's company; commands run as it (`executeCommand`). */
  principal: Principal;
  keyValue: KeyValue;
  requestId: string;
  now: Date;
}

/**
 * Handles one delivered event. A handler that changes data does it through `executeCommand` as
 * `ctx.principal`; a `DomainError` it throws is answered with its code, and only
 * `integration_unavailable` and `internal` are delivered again. A handler may run twice for one
 * event (a redelivery after the store failed to keep its id), so it is written to allow that.
 */
export type EventHandler = (event: DeliveredEvent, ctx: EventHandlerContext) => Promise<void>;

/**
 * The worker of every subscribed event type (docs/design/phase1.md §5.2). A type is
 * `subscribed: true` in the event catalogue exactly when it has a handler here, which a test
 * checks, and its QStash URL group `evt-<type>` points at `/api/v1/workers/outbox/<type>`.
 */
export const EVENT_HANDLERS: Partial<Record<EventType, EventHandler>> = {
  'platform.probe.requested': (event, ctx) => recordProbeArrival(event, ctx.keyValue, ctx.now),
};

/** The handler of a type, or undefined for a type no worker handles. */
export function handlerFor(type: string): EventHandler | undefined {
  return Object.hasOwn(EVENT_HANDLERS, type) ? EVENT_HANDLERS[type as EventType] : undefined;
}
