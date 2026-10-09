import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { CursorSchema, PageLimitSchema, SemverSchema } from './common';
import { TallyCompanySchema } from './connector';
import { AgentNameSchema } from './worker-jobs';

/**
 * The Integration Health page (docs/06-api.md §3.7; docs/01-blueprint.md §8.8, §10;
 * docs/03-roadmap-appendix/backend-weeks-3-5.md §4.4, docs/03-roadmap-appendix/phase1.md §5.2). Both routes need a session
 * holding `admin.integrations.write`. The page shows counts, times, ids and error codes; it never
 * shows a provider payload, a message body or an error that is not a code.
 */

const Count = z.number().int().min(0);
const Instant = z.iso.datetime();

/** Providers whose webhooks land in `webhook_inbox` (docs/06-api.md §3.4). */
export const WEBHOOK_PROVIDERS = [
  'meta_whatsapp',
  'meta_leadgen',
  'google_leadform',
  'exotel',
  'livekit',
] as const;
export const WebhookProviderSchema = z.enum(WEBHOOK_PROVIDERS);
export type WebhookProvider = z.infer<typeof WebhookProviderSchema>;

/** One provider's inbox over the last 24 hours and what still waits. */
export const WebhookInboxStats = z
  .object({
    provider: WebhookProviderSchema,
    received24h: Count,
    failedSignature24h: Count,
    unprocessed: Count,
    failed: Count,
    lastReceivedAt: Instant.nullable(),
    oldestUnprocessedAt: Instant.nullable(),
  })
  .strict();
export type WebhookInboxStats = z.infer<typeof WebhookInboxStats>;

/**
 * Why the last attempt of an outbox event failed, as the publisher records it: a short code such
 * as `queue_refused`, `no_outcome`, `not_in_catalogue`, `TimeoutError` or a worker's error code.
 * A stored error that is not one word of letters, digits, `_` and `.` answers `other`, so no text
 * reaches the page.
 */
export const OutboxErrorCodeSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,63}$/);
export type OutboxErrorCode = z.infer<typeof OutboxErrorCodeSchema>;

/**
 * An outbox event the publisher gave up on after ten attempts (`outbox_events.dead_lettered_at`).
 * `type` is a plain string, because a row that no longer fits the event catalogue is dead-lettered
 * as well.
 */
export const DeadLetteredEvent = z
  .object({
    eventId: IdSchema,
    type: z.string().min(1).max(120),
    entityId: EntityIdSchema,
    aggregateType: z.string().min(1).max(64),
    aggregateId: z.string().min(1).max(64),
    attempts: Count,
    errorCode: OutboxErrorCodeSchema.nullable(),
    createdAt: Instant,
    deadLetteredAt: Instant,
  })
  .strict();
export type DeadLetteredEvent = z.infer<typeof DeadLetteredEvent>;

/** A Tally connector's last heartbeat; `silent` after 30 minutes without one (BLUEPRINT §8.8). */
export const ConnectorHealth = z
  .object({
    connectorId: z.uuid(),
    entityId: EntityIdSchema,
    company: TallyCompanySchema,
    connectorVersion: SemverSchema,
    updateAvailable: z.boolean(),
    lastHeartbeatAt: Instant.nullable(),
    lastBatchAt: Instant.nullable(),
    queueDepth: Count,
    silent: z.boolean(),
  })
  .strict();
export type ConnectorHealth = z.infer<typeof ConnectorHealth>;

/** Meta's quality rating and messaging limit for one company's WhatsApp number. */
export const WhatsAppNumberHealth = z
  .object({
    entityId: EntityIdSchema,
    channelId: IdSchema,
    quality: z.enum(['green', 'yellow', 'red', 'unknown']),
    messagingTier: z.enum(['tier_250', 'tier_1k', 'tier_10k', 'tier_100k', 'unlimited', 'unknown']),
    templatesPending: Count,
    templatesRejected: Count,
    updatedAt: Instant.nullable(),
  })
  .strict();
export type WhatsAppNumberHealth = z.infer<typeof WhatsAppNumberHealth>;

/**
 * One agent's model spend in one company, in rupees, from its runs (`agent_runs`): today's and the
 * month's so far (IST), with the runs, beside the caps that apply there (`agent_configs`): the
 * company's and the group's, null for none. `stoppedByCap` when a run was stopped by a cap today.
 */
export const AgentSpend = z
  .object({
    agent: AgentNameSchema,
    entityId: EntityIdSchema,
    today: MoneySchema,
    monthToDate: MoneySchema,
    runsToday: Count,
    runsMonthToDate: Count,
    dailyCap: MoneySchema.nullable(),
    groupDailyCap: MoneySchema.nullable(),
    stoppedByCap: z.boolean(),
  })
  .strict();
export type AgentSpend = z.infer<typeof AgentSpend>;

/** `GET /admin/integrations?cursor=&limit=`: the cursor pages the dead letters, newest first. */
export const IntegrationHealthQuery = z
  .object({
    cursor: CursorSchema.optional(),
    limit: PageLimitSchema,
  })
  .strict();
export type IntegrationHealthQuery = z.infer<typeof IntegrationHealthQuery>;

/**
 * The outbox by event type (`app.outbox_health()`): `pending` waits to be delivered, `due` of those
 * may be sent now (past its backoff and not leased to a run), `deadLettered` waits for a replay.
 */
export const OutboxTypeHealth = z
  .object({
    type: z.string().min(1).max(120),
    pending: Count,
    due: Count,
    deadLettered: Count,
    oldestPendingAt: Instant.nullable(),
  })
  .strict();
export type OutboxTypeHealth = z.infer<typeof OutboxTypeHealth>;

/** The counts of the publisher's last run, kept for a day in the key-value store. */
export const PublisherRun = z
  .object({
    at: Instant,
    claimed: Count,
    published: Count,
    skipped: Count,
    failed: Count,
    deadLettered: Count,
  })
  .strict();
export type PublisherRun = z.infer<typeof PublisherRun>;

/**
 * The delivery check (`platform.probe.run`): `waiting` until the worker for
 * `platform.probe.requested` records its arrival, then `arrived` with the milliseconds from the
 * command to the worker. A check whose ten minutes have passed without an arrival is `lost`.
 */
export const DeliveryCheckStateSchema = z.enum(['waiting', 'arrived', 'lost']);
export type DeliveryCheckState = z.infer<typeof DeliveryCheckStateSchema>;

export const DeliveryCheck = z
  .object({
    probeId: IdSchema,
    state: DeliveryCheckStateSchema,
    requestedAt: Instant,
    arrivedAt: Instant.nullable(),
    milliseconds: Count.nullable(),
  })
  .strict();
export type DeliveryCheck = z.infer<typeof DeliveryCheck>;

export const IntegrationHealthResponse = z
  .object({
    generatedAt: Instant,
    outbox: z
      .object({
        byType: z.array(OutboxTypeHealth),
        lastPublisherRun: PublisherRun.nullable(),
      })
      .strict(),
    deliveryCheck: DeliveryCheck.nullable(),
    webhooks: z.array(WebhookInboxStats),
    deadLetters: z
      .object({
        total: Count,
        items: z.array(DeadLetteredEvent).max(200),
        nextCursor: CursorSchema.nullable(),
      })
      .strict(),
    connectors: z.array(ConnectorHealth),
    whatsapp: z.array(WhatsAppNumberHealth),
    aiSpend: z
      .object({
        today: MoneySchema,
        monthToDate: MoneySchema,
        byAgent: z.array(AgentSpend),
      })
      .strict(),
  })
  .strict();
export type IntegrationHealthResponse = z.infer<typeof IntegrationHealthResponse>;

/**
 * `POST /admin/integrations/replay` (`integrations.dlq.replay`): puts one dead-lettered event back
 * in the queue with its attempts reset, audited with the caller. An event that is not dead-lettered
 * answers `conflict` with reason `not_dead_lettered`.
 */
export const IntegrationReplayRequest = z.object({ eventId: IdSchema }).strict();
export type IntegrationReplayRequest = z.infer<typeof IntegrationReplayRequest>;

export const IntegrationReplayResponse = z
  .object({
    eventId: IdSchema,
    requeued: z.literal(true),
    attempts: z.literal(0),
  })
  .strict();
export type IntegrationReplayResponse = z.infer<typeof IntegrationReplayResponse>;
