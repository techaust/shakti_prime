import { z } from 'zod';
import { WebhookErrorCodeSchema, WebhookProviderSchema } from '../../api/admin-integrations';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The webhook worker's commands over `webhook_inbox` (docs/03-roadmap-appendix/phase2.md §5.1),
 * run as `system:workers` with the platform-only `webhooks.process`.
 */

/** How long a worker call holds a row: the route publishes, the sweep republishes after this. */
export const WEBHOOK_LEASE_SECONDS = 60;

/** The lease's exact text as the database wrote it, which names the call that holds the row. */
const LeaseSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/);

/** `webhooks.event.claim`: lease one waiting row for `leaseSeconds`. */
export const ClaimWebhookInput = z
  .object({
    inboxId: IdSchema,
    leaseSeconds: z.number().int().min(10).max(300).default(WEBHOOK_LEASE_SECONDS),
  })
  .strict();
export type ClaimWebhookInput = z.input<typeof ClaimWebhookInput>;

/**
 * The claimed row: its provider, the stored payload (untrusted provider data, parsed by the
 * provider's contract before anything reads it) and the attempt this is; `claimed: false` when the
 * row was already processed or failed, its payload is gone, or another call holds it.
 */
export const ClaimedWebhookDto = z.discriminatedUnion('claimed', [
  z.object({ claimed: z.literal(false) }).strict(),
  z
    .object({
      claimed: z.literal(true),
      provider: WebhookProviderSchema,
      payload: z.unknown(),
      attempts: z.number().int().min(1),
      lease: LeaseSchema,
    })
    .strict(),
]);
export type ClaimedWebhookDto = z.infer<typeof ClaimedWebhookDto>;

export const WEBHOOK_MARK_OUTCOMES = ['processed', 'failed', 'released'] as const;
export const WebhookMarkOutcomeSchema = z.enum(WEBHOOK_MARK_OUTCOMES);

/**
 * `webhooks.event.mark`: the outcome of a claimed row under its lease, or, with no lease, the
 * failure QStash reports after the last retry. `entityId` is the company a handler named.
 */
export const MarkWebhookInput = z
  .object({
    inboxId: IdSchema,
    lease: LeaseSchema.nullable(),
    outcome: WebhookMarkOutcomeSchema,
    errorCode: WebhookErrorCodeSchema.nullable().default(null),
    entityId: EntityIdSchema.nullable().default(null),
  })
  .strict()
  .refine((v) => v.outcome !== 'failed' || v.errorCode !== null, {
    message: 'a failure has a code',
    path: ['errorCode'],
  })
  .refine((v) => v.lease !== null || v.outcome === 'failed', {
    message: 'only a failure is recorded without a lease',
    path: ['lease'],
  });
export type MarkWebhookInput = z.input<typeof MarkWebhookInput>;

/** Whether the row changed: false when the lease had lapsed or the row was no longer waiting. */
export const MarkedWebhookDto = z.object({ changed: z.boolean() }).strict();
export type MarkedWebhookDto = z.infer<typeof MarkedWebhookDto>;
