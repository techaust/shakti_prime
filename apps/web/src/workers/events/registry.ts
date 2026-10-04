import type { DeliveredEvent, EventType, Principal } from '@shakti/contracts';
import type { KeyValue } from '@shakti/domain';
import { hostedRuntime } from '../../auth/deps';
import { requireFileStore } from '../../files/uploads';
import { handleFileUploaded } from '../files/handle-file-uploaded';
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
 * `ctx.principal`; a `DomainError` it throws is answered with its code, and every code but
 * `validation_failed`, `forbidden` and `not_found` is delivered again.
 */
export type EventHandler = (event: DeliveredEvent, ctx: EventHandlerContext) => Promise<void>;

/**
 * How a worker treats the order of its events (docs/design/phase1.md §5.2). QStash keeps no order
 * between messages:
 * - `every` (the default) handles every event exactly once by its id, whatever arrives first, so
 *   a failed older event's retry still runs after a newer one succeeded;
 * - `latest-only` is for a worker that needs only an aggregate's latest state: it skips an event
 *   no newer than the last one it handled for that aggregate (`seq:{type}:{aggregateType}:{id}`).
 */
export type EventOrdering = 'every' | 'latest-only';

export interface EventWorker {
  handle: EventHandler;
  ordering?: EventOrdering;
}

/**
 * The worker of every subscribed event type. A type is `subscribed: true` in the event catalogue
 * exactly when it has a worker here, which a test checks, and its QStash URL group `evt-<type>`
 * points at `/api/v1/workers/outbox/<type>`.
 */
export const EVENT_WORKERS: Partial<Record<EventType, EventWorker>> = {
  'platform.probe.requested': {
    handle: (event, ctx) => recordProbeArrival(event, ctx.keyValue, ctx.now),
  },
  // The checks of an upload (docs/ARCHITECTURE.md §9). Every event is handled: a re-drive from
  // Integration health is a new event for the same file, and the checks start from its status.
  'files.file.uploaded': {
    ordering: 'every',
    handle: async (event, ctx) => {
      await handleFileUploaded(event, {
        // No store on a hosted runtime without S3: `integration_unavailable`, delivered again.
        store: requireFileStore(),
        principal: ctx.principal,
        hosted: hostedRuntime(),
        requestId: ctx.requestId,
      });
    },
  },
};

/** The worker of a type, or undefined for a type no worker handles. */
export function workerFor(type: string): EventWorker | undefined {
  return Object.hasOwn(EVENT_WORKERS, type) ? EVENT_WORKERS[type as EventType] : undefined;
}
