import { z } from 'zod';
import { IdSchema } from '../ids';

/**
 * `messaging.message.requested` (docs/06-api.md §6, docs/03-roadmap-appendix/phase2.md §6.1): what
 * a command emits when it has queued a WhatsApp message (`whatsapp_messages`, status `queued`).
 * Commands never call Meta; the messaging worker (`/workers/messaging/send`) reads the queued
 * message and checks, in order, the opt-out, the 24-hour window for a session message, the
 * template's approval, the portfolio budget (service messages first), the deterministic output
 * filter and the rate limit per thread, then sends it once and records Meta's id.
 *
 * The payload carries ids and the kind only, as every catalogue event does: the body and the
 * template's values stay in the queued row, masked.
 */
export const MessageRequested = z
  .object({
    messageId: IdSchema,
    threadId: IdSchema,
    /** `text` a session message, `template` a template, `system` the confirmation of a STOP. */
    kind: z.enum(['text', 'template', 'system']),
  })
  .strict();
export type MessageRequested = z.infer<typeof MessageRequested>;

/** A Meta template name as approved: lowercase letters, digits and underscores. */
export const WhatsAppTemplateNameSchema = z.string().regex(/^[a-z0-9_]{1,512}$/);
export type WhatsAppTemplateName = z.infer<typeof WhatsAppTemplateNameSchema>;

/** Meta's limit on one text message body. */
export const WHATSAPP_BODY_MAX = 4096;

/**
 * Why the messaging worker did not send; each is final for the message, recorded as its
 * `refusal` with the status `refused`, and the worker answers 200 so it is not retried.
 */
export const MESSAGING_REFUSALS = [
  'opted_out',
  'window_closed',
  'template_not_approved',
  'tier_budget_reached',
  'output_filter',
] as const;
export const MessagingRefusalSchema = z.enum(MESSAGING_REFUSALS);
export type MessagingRefusal = z.infer<typeof MessagingRefusalSchema>;

/**
 * Why the messaging worker sent nothing yet, without refusing: a thread over its rate limit
 * (`rate_limited`) answers a retryable 5xx, so the queue delivers the message again later; a
 * marketing template over the hold share of the portfolio budget (`marketing_held`) stays
 * `queued` and goes with the next window's budget.
 */
export const MESSAGING_RETRYABLE = ['rate_limited', 'marketing_held'] as const;
export const MessagingRetryableSchema = z.enum(MESSAGING_RETRYABLE);
export type MessagingRetryable = z.infer<typeof MessagingRetryableSchema>;
