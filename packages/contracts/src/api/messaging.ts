import { z } from 'zod';
import { IdSchema } from '../ids';

/**
 * `message.requested` (docs/06-api.md §6): what a command emits when a customer should get a WhatsApp
 * message. Commands never call Meta; the messaging worker (`/workers/messaging/send`) checks the
 * opt-out, the 24-hour window for session messages, the template's approval, the portfolio tier
 * budget (service messages first), the deterministic output filter and the per-conversation rate
 * limit, then sends and records `provider_message_id`.
 *
 * The shape is documented here and is not an entry of the event catalogue
 * (`events/catalogue.ts`) yet: the type joins the catalogue with the messaging worker and its
 * queue group in Phase 2.
 */

/** A Meta template name as approved: lowercase letters, digits and underscores. */
export const WhatsAppTemplateNameSchema = z.string().regex(/^[a-z0-9_]{1,512}$/);
export type WhatsAppTemplateName = z.infer<typeof WhatsAppTemplateNameSchema>;

/** Meta's limit on one text message body. */
export const WHATSAPP_BODY_MAX = 4096;

const TemplateMessage = z
  .object({
    threadId: IdSchema,
    kind: z.literal('template'),
    templateName: WhatsAppTemplateNameSchema,
    /** The template's body parameters in order; a template without parameters sends none. */
    params: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
    fileId: IdSchema.optional(),
  })
  .strict();

const SessionMessage = z
  .object({
    threadId: IdSchema,
    kind: z.literal('session'),
    /** Free text inside the 24-hour window, already passed through the masking helpers. */
    bodyMasked: z.string().trim().min(1).max(WHATSAPP_BODY_MAX),
    fileId: IdSchema.optional(),
  })
  .strict();

export const MessageRequested = z.discriminatedUnion('kind', [TemplateMessage, SessionMessage]);
export type MessageRequested = z.infer<typeof MessageRequested>;
export type MessageRequestedInput = z.input<typeof MessageRequested>;

/**
 * Why the messaging worker did not send; each is final for this message, so the worker answers
 * 200 and the message is not retried. A conversation over its rate limit answers a retryable 5xx
 * instead, so the queue delivers the message again later.
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
