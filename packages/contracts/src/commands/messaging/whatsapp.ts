import { z } from 'zod';
import { MessagingRefusalSchema, WhatsAppTemplateNameSchema } from '../../api/messaging';
import { ChannelProviderRefSchema } from '../org/channels';
import { EntityIdSchema, IdSchema } from '../../ids';
import {
  WHATSAPP_PERSON_HANDOFF_REASONS,
  WhatsAppBodySchema,
  WhatsAppButtonPayloadSchema,
  WhatsAppDeliveryStatusSchema,
  WhatsAppHandoffReasonSchema,
  WhatsAppInboundKindSchema,
  WhatsAppMessageStatusSchema,
  WhatsAppProviderMessageIdSchema,
  WhatsAppTemplateButtonSchema,
  WhatsAppTemplateCategorySchema,
  WhatsAppTemplateLanguageSchema,
  WhatsAppTemplateParamSchema,
  WhatsAppTemplatePurposeSchema,
  WhatsAppTemplateStatusSchema,
  WhatsAppTemplateValueSchema,
  WhatsAppThreadHandlerSchema,
  WhatsAppWaIdSchema,
} from '../../whatsapp';

/**
 * The WhatsApp commands (docs/03-roadmap-appendix/phase2.md §6.1). A person's: send a message on a
 * thread, take a thread over or give it back to the assistant (`messaging.send`), register a
 * template (`messaging.templates.write`). The platform's (`system:workers`, the platform-only
 * `messaging.process`), each through one definer: record an inbound message, match a thread to its
 * customer, record a delivery status or a template's status, record a STOP or a hand-off, queue the
 * welcome or a STOP's confirmation, take a queued message to send it and record what came of it.
 */

// --- People -------------------------------------------------------------------------------------

/**
 * `messaging.message.send`: a person queues a message on a thread they may message: free text
 * inside the customer's 24-hour window (masked before it is stored), or a registered template
 * with its body values. The messaging worker sends it after its checks.
 */
export const SendWhatsAppMessageInput = z.discriminatedUnion('kind', [
  z
    .object({
      entityId: EntityIdSchema,
      threadId: IdSchema,
      kind: z.literal('text'),
      body: WhatsAppBodySchema,
    })
    .strict(),
  z
    .object({
      entityId: EntityIdSchema,
      threadId: IdSchema,
      kind: z.literal('template'),
      templateName: WhatsAppTemplateNameSchema,
      params: z.array(WhatsAppTemplateValueSchema).max(20).default([]),
    })
    .strict(),
]);
export type SendWhatsAppMessageInput = z.input<typeof SendWhatsAppMessageInput>;

/** `messaging.thread.hand_off`: a person takes a thread over from the assistant, with the reason. */
export const HandOffWhatsAppThreadInput = z
  .object({
    entityId: EntityIdSchema,
    threadId: IdSchema,
    reason: z.enum(WHATSAPP_PERSON_HANDOFF_REASONS),
  })
  .strict();
export type HandOffWhatsAppThreadInput = z.input<typeof HandOffWhatsAppThreadInput>;

/** `messaging.thread.return_to_assistant`: a person gives a thread back to the assistant. */
export const ReturnWhatsAppThreadInput = z
  .object({ entityId: EntityIdSchema, threadId: IdSchema })
  .strict();
export type ReturnWhatsAppThreadInput = z.input<typeof ReturnWhatsAppThreadInput>;

/**
 * `messaging.template.register`: an Executive records a template as it was submitted to Meta for
 * the company: its name and language, category, what each body value stands for and its buttons.
 * Registering the same name and language again updates it; its status stays as Meta last
 * reported it, and a new template waits as `pending` until Meta's event. A template the platform
 * sends (`purpose`) takes no body values, since the platform has none to give it.
 */
export const RegisterWhatsAppTemplateInput = z
  .object({
    entityId: EntityIdSchema,
    name: WhatsAppTemplateNameSchema,
    language: WhatsAppTemplateLanguageSchema.default('en'),
    category: WhatsAppTemplateCategorySchema,
    params: z.array(WhatsAppTemplateParamSchema).max(20).default([]),
    buttons: z.array(WhatsAppTemplateButtonSchema).max(10).default([]),
    purpose: WhatsAppTemplatePurposeSchema.nullable().default(null),
  })
  .strict();
export type RegisterWhatsAppTemplateInput = z.input<typeof RegisterWhatsAppTemplateInput>;

// --- The platform -------------------------------------------------------------------------------

/**
 * `messaging.inbound.record`: one inbound message from Meta's webhook. The company is the one whose
 * active WhatsApp number Meta names (`phoneNumberId`); `body` is the customer's text or a file's
 * caption, untrusted, masked before it is stored; `buttonPayload` a button reply's own id.
 */
export const RecordInboundWhatsAppInput = z
  .object({
    phoneNumberId: ChannelProviderRefSchema,
    waId: WhatsAppWaIdSchema,
    providerMessageId: WhatsAppProviderMessageIdSchema,
    kind: WhatsAppInboundKindSchema,
    body: WhatsAppBodySchema.nullable(),
    buttonPayload: WhatsAppButtonPayloadSchema.nullable(),
    sentAt: z.iso.datetime(),
  })
  .strict();
export type RecordInboundWhatsAppInput = z.input<typeof RecordInboundWhatsAppInput>;

/**
 * What the inbound record did: the thread and message, whether the message was a repeat (nothing
 * changed), whether it opened the thread (the welcome is due), the customer when one was matched
 * and how many of the company's customers hold the number, whether the number has opted out and
 * who answers the thread.
 */
export const InboundWhatsAppRecorded = z
  .object({
    entityId: EntityIdSchema,
    threadId: IdSchema,
    messageId: IdSchema,
    duplicate: z.boolean(),
    firstMessage: z.boolean(),
    accountId: IdSchema.nullable(),
    opportunityId: IdSchema.nullable(),
    holders: z.number().int().min(0),
    optedOut: z.boolean(),
    handledBy: WhatsAppThreadHandlerSchema,
  })
  .strict();
export type InboundWhatsAppRecorded = z.infer<typeof InboundWhatsAppRecorded>;

/**
 * `messaging.thread.match`: a thread matched to no customer is matched to the customer the lead
 * intake recorded for its number.
 */
export const MatchWhatsAppThreadInput = z
  .object({ entityId: EntityIdSchema, threadId: IdSchema, accountId: IdSchema })
  .strict();
export type MatchWhatsAppThreadInput = z.input<typeof MatchWhatsAppThreadInput>;

export const WhatsAppThreadMatched = z
  .object({
    threadId: IdSchema,
    accountId: IdSchema,
    opportunityId: IdSchema.nullable(),
    matched: z.boolean(),
  })
  .strict();
export type WhatsAppThreadMatched = z.infer<typeof WhatsAppThreadMatched>;

/** `messaging.status.record`: a delivery status Meta reported for a message the BOS sent. */
export const RecordWhatsAppStatusInput = z
  .object({
    providerMessageId: WhatsAppProviderMessageIdSchema,
    status: WhatsAppDeliveryStatusSchema,
    at: z.iso.datetime(),
    errorCode: z.number().int().min(0).max(2_147_483_647).nullable(),
  })
  .strict();
export type RecordWhatsAppStatusInput = z.input<typeof RecordWhatsAppStatusInput>;

/**
 * The message's status as it now stands; `changed` false for a repeated or late status, and
 * `known` false when Meta's id names no message of the companies.
 */
export const WhatsAppStatusRecorded = z
  .object({
    known: z.boolean(),
    messageId: IdSchema.nullable(),
    threadId: IdSchema.nullable(),
    entityId: EntityIdSchema.nullable(),
    status: WhatsAppMessageStatusSchema.nullable(),
    changed: z.boolean(),
  })
  .strict();
export type WhatsAppStatusRecorded = z.infer<typeof WhatsAppStatusRecorded>;

/** `messaging.template.record_status`: a template's status from Meta's template event. */
export const RecordWhatsAppTemplateStatusInput = z
  .object({
    name: WhatsAppTemplateNameSchema,
    language: WhatsAppTemplateLanguageSchema,
    status: WhatsAppTemplateStatusSchema,
  })
  .strict();
export type RecordWhatsAppTemplateStatusInput = z.input<typeof RecordWhatsAppTemplateStatusInput>;

export const WhatsAppTemplateStatusRecorded = z
  .object({ changed: z.number().int().min(0) })
  .strict();
export type WhatsAppTemplateStatusRecorded = z.infer<typeof WhatsAppTemplateStatusRecorded>;

/** `messaging.opt_out.record`: the customer sent STOP on a thread, at `at`. */
export const RecordWhatsAppOptOutInput = z
  .object({ entityId: EntityIdSchema, threadId: IdSchema, at: z.iso.datetime() })
  .strict();
export type RecordWhatsAppOptOutInput = z.input<typeof RecordWhatsAppOptOutInput>;

export const WhatsAppOptOutRecorded = z
  .object({
    threadId: IdSchema,
    optedOutAt: z.iso.datetime(),
    newly: z.boolean(),
    consentsWithdrawn: z.number().int().min(0),
  })
  .strict();
export type WhatsAppOptOutRecorded = z.infer<typeof WhatsAppOptOutRecorded>;

/**
 * `messaging.thread.record_hand_off`: the platform hands a thread to people: the customer's HUMAN,
 * the output filter's refusals, complaint words.
 */
export const RecordWhatsAppHandOffInput = z
  .object({ entityId: EntityIdSchema, threadId: IdSchema, reason: WhatsAppHandoffReasonSchema })
  .strict();
export type RecordWhatsAppHandOffInput = z.input<typeof RecordWhatsAppHandOffInput>;

export const WhatsAppHandOffRecorded = z
  .object({
    threadId: IdSchema,
    handledBy: WhatsAppThreadHandlerSchema,
    handoffReason: WhatsAppHandoffReasonSchema.nullable(),
    changed: z.boolean(),
  })
  .strict();
export type WhatsAppHandOffRecorded = z.infer<typeof WhatsAppHandOffRecorded>;

/**
 * `messaging.message.queue`: the platform queues the company's template of a purpose on a thread:
 * the welcome on a customer's first message, or the confirmation of a STOP. Nothing is queued
 * when the company registered no template for the purpose.
 */
export const QueueWhatsAppMessageInput = z
  .object({
    entityId: EntityIdSchema,
    threadId: IdSchema,
    purpose: WhatsAppTemplatePurposeSchema,
  })
  .strict();
export type QueueWhatsAppMessageInput = z.input<typeof QueueWhatsAppMessageInput>;

export const WhatsAppMessageQueued = z
  .object({ threadId: IdSchema, messageId: IdSchema.nullable(), queued: z.boolean() })
  .strict();
export type WhatsAppMessageQueued = z.infer<typeof WhatsAppMessageQueued>;

/** `messaging.message.claim`: the messaging worker takes a queued message to send it, once. */
export const ClaimWhatsAppMessageInput = z
  .object({ entityId: EntityIdSchema, messageId: IdSchema })
  .strict();
export type ClaimWhatsAppMessageInput = z.input<typeof ClaimWhatsAppMessageInput>;

export const WhatsAppMessageClaimed = z
  .object({ messageId: IdSchema, claimed: z.boolean() })
  .strict();
export type WhatsAppMessageClaimed = z.infer<typeof WhatsAppMessageClaimed>;

/**
 * `messaging.message.record_send`: what came of a queued message: sent with Meta's id or failed
 * (a message the worker took), or refused with the check that refused it (one it did not take).
 */
export const RecordWhatsAppSendInput = z.discriminatedUnion('status', [
  z
    .object({
      entityId: EntityIdSchema,
      messageId: IdSchema,
      status: z.literal('sent'),
      providerMessageId: WhatsAppProviderMessageIdSchema,
    })
    .strict(),
  z
    .object({
      entityId: EntityIdSchema,
      messageId: IdSchema,
      status: z.literal('failed'),
      errorCode: z.number().int().min(0).max(2_147_483_647).nullable(),
    })
    .strict(),
  z
    .object({
      entityId: EntityIdSchema,
      messageId: IdSchema,
      status: z.literal('refused'),
      refusal: MessagingRefusalSchema,
    })
    .strict(),
]);
export type RecordWhatsAppSendInput = z.input<typeof RecordWhatsAppSendInput>;

export const WhatsAppSendRecorded = z
  .object({
    messageId: IdSchema,
    threadId: IdSchema,
    status: WhatsAppMessageStatusSchema,
    changed: z.boolean(),
  })
  .strict();
export type WhatsAppSendRecorded = z.infer<typeof WhatsAppSendRecorded>;

/**
 * `messaging.media.attach`: the platform stored a file a customer sent (downloaded from Meta with
 * the system key) and attaches it to the inbound message it came on, as a `whatsapp_media` file
 * waiting for its checks (malware scan, re-encoding, masking) before anyone can open it.
 */
export const AttachWhatsAppMediaInput = z
  .object({
    entityId: EntityIdSchema,
    messageId: IdSchema,
    fileId: IdSchema,
    bucket: z.string().min(1).max(63),
    key: z.string().min(1).max(300),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    size: z.number().int().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type AttachWhatsAppMediaInput = z.input<typeof AttachWhatsAppMediaInput>;

export const WhatsAppMediaAttached = z
  .object({ messageId: IdSchema, fileId: IdSchema, attached: z.boolean() })
  .strict();
export type WhatsAppMediaAttached = z.infer<typeof WhatsAppMediaAttached>;
