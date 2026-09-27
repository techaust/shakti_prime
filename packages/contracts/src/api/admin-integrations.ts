import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { CursorSchema, PageLimitSchema, SemverSchema } from './common';
import { TallyCompanySchema } from './connector';
import { AgentNameSchema } from './worker-jobs';

/**
 * The Integration Health page (docs/API.md §3.7; docs/BLUEPRINT.md §8.8, §10;
 * docs/design/backend-weeks-3-5.md §4.4). Both routes need a session holding
 * `admin.integrations.write`. The page shows counts, times and ids; it never shows a provider
 * payload, a message body or a stored error text.
 */

const Count = z.number().int().min(0);
const Instant = z.iso.datetime();

/** Providers whose webhooks land in `webhook_inbox` (docs/API.md §3.4). */
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

/** One agent's model spend in rupees against its daily cap (`agent_configs.daily_spend_cap`). */
export const AgentSpend = z
  .object({
    agent: AgentNameSchema,
    today: MoneySchema,
    monthToDate: MoneySchema,
    dailyCap: MoneySchema,
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

export const IntegrationHealthResponse = z
  .object({
    generatedAt: Instant,
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
