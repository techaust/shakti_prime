import { z } from 'zod';
import { MessagingRefusalSchema, WHATSAPP_BODY_MAX, WhatsAppTemplateNameSchema } from './api/messaging';
import { E164Schema } from './crm/phone';
import { EntityIdSchema, IdSchema } from './ids';

// WhatsApp threads and messages (docs/03-roadmap-appendix/phase2.md §6.1, BLUEPRINT §7.8 and §10,
// PRD WA-04 and CRM-10): one thread per company number and customer number, its messages both
// ways, and the company's registered templates. The lists below equal the tables' checks
// (`enum-sync.test.ts`).

/** Who answers a thread: the assistant, or people once it was handed to them. */
export const WHATSAPP_THREAD_HANDLERS = ['assistant', 'people'] as const;
export const WhatsAppThreadHandlerSchema = z.enum(WHATSAPP_THREAD_HANDLERS);
export type WhatsAppThreadHandler = z.infer<typeof WhatsAppThreadHandlerSchema>;

/**
 * Why a thread went to people: the customer's HUMAN (`keyword`), a person's or the customer's
 * request, the output filter refusing the assistant's replies, complaint words.
 */
export const WHATSAPP_HANDOFF_REASONS = [
  'keyword',
  'request',
  'filter_refusals',
  'complaint',
] as const;
export const WhatsAppHandoffReasonSchema = z.enum(WHATSAPP_HANDOFF_REASONS);
export type WhatsAppHandoffReason = z.infer<typeof WhatsAppHandoffReasonSchema>;

/** The reasons a person gives when they take a thread over. */
export const WHATSAPP_PERSON_HANDOFF_REASONS = ['request', 'complaint'] as const;

export const WHATSAPP_MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;
export const WhatsAppMessageDirectionSchema = z.enum(WHATSAPP_MESSAGE_DIRECTIONS);
export type WhatsAppMessageDirection = z.infer<typeof WhatsAppMessageDirectionSchema>;

/**
 * A message's kind: free text, a template, a file, a button reply, and `system`, the platform's
 * confirmation of a STOP (a template, and the one message an opted-out number may still get).
 */
export const WHATSAPP_MESSAGE_KINDS = ['text', 'template', 'media', 'button', 'system'] as const;
export const WhatsAppMessageKindSchema = z.enum(WHATSAPP_MESSAGE_KINDS);
export type WhatsAppMessageKind = z.infer<typeof WhatsAppMessageKindSchema>;

/** An inbound message's kinds. */
export const WHATSAPP_INBOUND_KINDS = ['text', 'media', 'button'] as const;
export const WhatsAppInboundKindSchema = z.enum(WHATSAPP_INBOUND_KINDS);

/**
 * An outbound message's status, which only moves forward: `queued`, then `sent`, `delivered` and
 * `read`; `failed` from queued or sent; `refused` from queued, with its refusal.
 */
export const WHATSAPP_MESSAGE_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'refused',
] as const;
export const WhatsAppMessageStatusSchema = z.enum(WHATSAPP_MESSAGE_STATUSES);
export type WhatsAppMessageStatus = z.infer<typeof WhatsAppMessageStatusSchema>;

/** The statuses Meta reports for a message it was given. */
export const WHATSAPP_DELIVERY_STATUSES = ['sent', 'delivered', 'read', 'failed'] as const;
export const WhatsAppDeliveryStatusSchema = z.enum(WHATSAPP_DELIVERY_STATUSES);
export type WhatsAppDeliveryStatus = z.infer<typeof WhatsAppDeliveryStatusSchema>;

export const WHATSAPP_TEMPLATE_CATEGORIES = ['utility', 'marketing', 'authentication'] as const;
export const WhatsAppTemplateCategorySchema = z.enum(WHATSAPP_TEMPLATE_CATEGORIES);
export type WhatsAppTemplateCategory = z.infer<typeof WhatsAppTemplateCategorySchema>;

/** A template's state in Meta, recorded only by the platform from Meta's template events. */
export const WHATSAPP_TEMPLATE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
] as const;
export const WhatsAppTemplateStatusSchema = z.enum(WHATSAPP_TEMPLATE_STATUSES);
export type WhatsAppTemplateStatus = z.infer<typeof WhatsAppTemplateStatusSchema>;

/** Templates are written in English (ADR 0014). */
export const WHATSAPP_TEMPLATE_LANGUAGES = ['en'] as const;
export const WhatsAppTemplateLanguageSchema = z.enum(WHATSAPP_TEMPLATE_LANGUAGES);

/**
 * A template the platform itself sends: the welcome on a customer's first message (the owner's
 * decision of 13-11-2026, question 2 (a)) and the confirmation of a STOP. One per company each.
 */
export const WHATSAPP_TEMPLATE_PURPOSES = ['welcome', 'opt_out_confirmation'] as const;
export const WhatsAppTemplatePurposeSchema = z.enum(WHATSAPP_TEMPLATE_PURPOSES);
export type WhatsAppTemplatePurpose = z.infer<typeof WhatsAppTemplatePurposeSchema>;

export const WHATSAPP_BUTTON_KINDS = ['quick_reply', 'url'] as const;

/** A button a template carries, as Meta limits its text. */
export const WhatsAppTemplateButtonSchema = z
  .object({
    kind: z.enum(WHATSAPP_BUTTON_KINDS),
    text: z.string().trim().min(1).max(25),
  })
  .strict();
export type WhatsAppTemplateButton = z.infer<typeof WhatsAppTemplateButtonSchema>;

/** What one body value of a template stands for, for the people choosing it. */
export const WhatsAppTemplateParamSchema = z.string().trim().min(1).max(60);

/** One body value given to a template when it is sent. */
export const WhatsAppTemplateValueSchema = z.string().trim().min(1).max(1024);

/**
 * WhatsApp's own name for a customer number: E.164 digits without the plus, as
 * `whatsapp_threads_wa_id_check` allows.
 */
export const WhatsAppWaIdSchema = z.string().regex(/^[1-9][0-9]{6,14}$/);

/** Meta's message id (`wamid.…`). */
export const WhatsAppProviderMessageIdSchema = z.string().regex(/^[A-Za-z0-9._:=+/-]{1,256}$/);

/** A button reply's own id, as the button was sent with it. */
export const WhatsAppButtonPayloadSchema = z.string().min(1).max(256);

/** The customer's text, before it is masked; Meta's limit. */
export const WhatsAppBodySchema = z.string().trim().min(1).max(WHATSAPP_BODY_MAX);

// --- DTOs ---------------------------------------------------------------------------------------

/**
 * A thread as the screens show it. `number` is the customer's number, read by whoever reads the
 * thread (the customer's read rule). `optedOut` is whether the number has opted out now, by its
 * STOP or a withdrawn consent; `windowOpenUntil` when the customer's last message's 24-hour window
 * closes.
 */
export const WhatsAppThreadDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    number: E164Schema,
    accountId: IdSchema.nullable(),
    opportunityId: IdSchema.nullable(),
    assigneeId: IdSchema.nullable(),
    windowOpenUntil: z.iso.datetime().nullable(),
    optedOut: z.boolean(),
    handledBy: WhatsAppThreadHandlerSchema,
    handoffReason: WhatsAppHandoffReasonSchema.nullable(),
    handedOffAt: z.iso.datetime().nullable(),
    lastInboundAt: z.iso.datetime().nullable(),
    needsReply: z.boolean(),
  })
  .strict();
export type WhatsAppThreadDto = z.infer<typeof WhatsAppThreadDto>;

/**
 * A message as the thread shows it: its text masked, a template's name and values, a file
 * (opened only through the file checks), and an outbound one's status and refusal.
 */
export const WhatsAppMessageDto = z
  .object({
    id: IdSchema,
    threadId: IdSchema,
    direction: WhatsAppMessageDirectionSchema,
    kind: WhatsAppMessageKindSchema,
    templateName: WhatsAppTemplateNameSchema.nullable(),
    templateParams: z.array(z.string()).max(20).nullable(),
    body: z.string().max(WHATSAPP_BODY_MAX).nullable(),
    fileId: IdSchema.nullable(),
    status: WhatsAppMessageStatusSchema.nullable(),
    refusal: MessagingRefusalSchema.nullable(),
    sentBy: IdSchema.nullable(),
    createdAt: z.iso.datetime(),
    statusAt: z.iso.datetime().nullable(),
  })
  .strict();
export type WhatsAppMessageDto = z.infer<typeof WhatsAppMessageDto>;

/** A registered template; the composer offers the approved ones of the thread's company. */
export const WhatsAppTemplateDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    name: WhatsAppTemplateNameSchema,
    language: WhatsAppTemplateLanguageSchema,
    category: WhatsAppTemplateCategorySchema,
    status: WhatsAppTemplateStatusSchema,
    params: z.array(WhatsAppTemplateParamSchema).max(20),
    buttons: z.array(WhatsAppTemplateButtonSchema).max(10),
    purpose: WhatsAppTemplatePurposeSchema.nullable(),
  })
  .strict();
export type WhatsAppTemplateDto = z.infer<typeof WhatsAppTemplateDto>;
