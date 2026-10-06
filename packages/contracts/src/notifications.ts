import { z } from 'zod';
import { PhoneInputSchema } from './crm/phone';
import { SegmentSchema } from './crm/enums';
import { EntityIdSchema, IdSchema } from './ids';

/*
 * Notifications (PRD RPT-04, BLUEPRINT §8.11, docs/design/phase1.md §8.1): the notices a person
 * reads in the notification centre, their choices per kind of notice and quiet hours, and the
 * browsers they receive pushes on. A notice names its record by ids; its words come from the
 * message catalogue by `type`, never from the database.
 */

const Count = z.number().int().min(0);

/**
 * The kinds of notice, one per thing a person acts on (PRD RPT-04 criterion 1):
 * - `lead_assigned`: a lead was given to you (not when you took it yourself);
 * - `duplicate_found`: a lead or customer of yours may be a duplicate;
 * - `call_due`: a callback or nurture call of yours is due;
 * - `quote_expiring`: a quote on your lead lapses within a day;
 * - `first_call_late`: a new lead of your company was not called within its first-contact limit
 *   (to the company's General Manager, criterion 2);
 * - `enquiry_routed`: an enquiry for a customer you look after was passed to you.
 */
export const NOTICE_TYPES = [
  'lead_assigned',
  'duplicate_found',
  'call_due',
  'quote_expiring',
  'first_call_late',
  'enquiry_routed',
] as const;
export const NoticeTypeSchema = z.enum(NOTICE_TYPES);
export type NoticeType = z.infer<typeof NoticeTypeSchema>;

/** `notifications.subject_type`: the record a notice is about. */
export const NOTICE_SUBJECT_TYPES = [
  'opportunity',
  'duplicate_candidate',
  'task',
  'quote',
  'inbox_item',
] as const;
export const NoticeSubjectTypeSchema = z.enum(NOTICE_SUBJECT_TYPES);
export type NoticeSubjectType = z.infer<typeof NoticeSubjectTypeSchema>;

/**
 * `notifications.payload_json`: the ids the notice's link is made from, nothing else (never a
 * name, a phone number or text a person or a model wrote).
 */
export const NoticePayloadSchema = z
  .object({
    accountId: IdSchema.optional(),
    opportunityId: IdSchema.optional(),
    quoteId: IdSchema.optional(),
  })
  .strict();
export type NoticePayload = z.infer<typeof NoticePayloadSchema>;

/**
 * What became of a notice's push (`notifications.channel_sent_json.push`): sent, held in the
 * person's quiet hours (never sent later: the notice waits in the centre), off for this kind of
 * notice, no browser to send to, refused by every push service, or not yet tried.
 */
export const PUSH_OUTCOMES = ['sent', 'held', 'off', 'none', 'failed', 'pending'] as const;
export const PushOutcomeSchema = z.enum(PUSH_OUTCOMES);
export type PushOutcome = z.infer<typeof PushOutcomeSchema>;

/** One notice in the centre, newest first. */
export const NoticeDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    type: NoticeTypeSchema,
    subjectType: NoticeSubjectTypeSchema,
    subjectId: IdSchema,
    accountId: IdSchema.nullable(),
    opportunityId: IdSchema.nullable(),
    quoteId: IdSchema.nullable(),
    /** The customer's name when the reader may read the customer; null otherwise. */
    customerName: z.string().nullable(),
    /** The quote's number when the reader may read the quote; null otherwise. */
    quoteNo: z.string().nullable(),
    createdAt: z.iso.datetime(),
    readAt: z.iso.datetime().nullable(),
  })
  .strict();
export type NoticeDto = z.infer<typeof NoticeDto>;

/** `listNotices`: the caller's notices in the request's companies, newest first, keyset. */
export const ListNoticesInput = z
  .object({ cursor: z.string().max(200).optional(), limit: z.number().int().min(1).max(50) })
  .strict();
export type ListNoticesInput = z.infer<typeof ListNoticesInput>;

export const NoticePageDto = z
  .object({ items: z.array(NoticeDto), nextCursor: z.string().nullable() })
  .strict();
export type NoticePageDto = z.infer<typeof NoticePageDto>;

/** The bell counts unread notices up to this many and shows 99+ beyond 99. */
export const NOTICE_COUNT_LIMIT = 100;
export const NoticeCountDto = z.object({ unread: Count }).strict();
export type NoticeCountDto = z.infer<typeof NoticeCountDto>;

/** `notifications.notice.read`: the caller's notices, by id, marked read. */
export const MarkNoticesReadInput = z
  .object({ ids: z.array(IdSchema).min(1).max(50) })
  .strict();
export type MarkNoticesReadInput = z.infer<typeof MarkNoticesReadInput>;

/** `notifications.notice.read_all`: every unread notice of the caller in the request's companies. */
export const MarkAllNoticesReadInput = z.object({}).strict();
export type MarkAllNoticesReadInput = z.infer<typeof MarkAllNoticesReadInput>;

export const NoticesReadDto = z.object({ read: Count }).strict();
export type NoticesReadDto = z.infer<typeof NoticesReadDto>;

/** A time of day in IST, `HH:MM` on the 24-hour clock. */
export const QuietTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** One kind of notice: shown in the centre, and pushed to the person's browsers. */
export const NoticePreferenceDto = z
  .object({ type: NoticeTypeSchema, inApp: z.boolean(), push: z.boolean() })
  .strict();
export type NoticePreferenceDto = z.infer<typeof NoticePreferenceDto>;

/**
 * A person's notification settings: every kind of notice with its two switches (on when they have
 * set nothing), and the quiet hours in IST when no push is sent (none when they have set none).
 */
export const NotificationSettingsDto = z
  .object({
    types: z.array(NoticePreferenceDto),
    quietFrom: QuietTimeSchema.nullable(),
    quietTo: QuietTimeSchema.nullable(),
  })
  .strict();
export type NotificationSettingsDto = z.infer<typeof NotificationSettingsDto>;

/**
 * `notifications.preferences.set`: the caller's switches for the kinds they send (each kind at most
 * once; a kind left out keeps its switches) and their quiet hours, both or neither, never equal.
 */
export const SetNotificationSettingsInput = z
  .object({
    types: z
      .array(NoticePreferenceDto)
      .max(NOTICE_TYPES.length)
      .refine((list) => new Set(list.map((t) => t.type)).size === list.length, {
        message: 'each kind of notice once',
      }),
    quietFrom: QuietTimeSchema.nullable(),
    quietTo: QuietTimeSchema.nullable(),
  })
  .strict()
  .refine((v) => (v.quietFrom === null) === (v.quietTo === null), {
    message: 'quiet_hours_incomplete',
    path: ['quietTo'],
  })
  .refine((v) => v.quietFrom === null || v.quietFrom !== v.quietTo, {
    message: 'quiet_hours_empty',
    path: ['quietTo'],
  });
export type SetNotificationSettingsInput = z.infer<typeof SetNotificationSettingsInput>;

/**
 * The push services a browser's subscription may name: Google's (Chrome, Edge on Android),
 * Mozilla's, Apple's and Microsoft's. The worker sends to the address a browser gave it, so any
 * other host is refused, and a subscription can never make the server call somewhere else.
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
  'web.push.apple.com',
] as const;
/** Microsoft's push service answers on regional hosts under this name. */
export const PUSH_SERVICE_HOST_SUFFIXES = ['.notify.windows.com'] as const;

/** True for an https address on a push service this app sends to. */
export function isPushServiceEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return (
    (PUSH_SERVICE_HOSTS as readonly string[]).includes(host) ||
    PUSH_SERVICE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}

const PushEndpointSchema = z
  .string()
  .max(1000)
  .refine(isPushServiceEndpoint, { message: 'push_service_unknown' });
const Base64Url = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+=*$/);

/** `notifications.push.subscribe`: this browser, as its push subscription describes it. */
export const PushSubscribeInput = z
  .object({
    endpoint: PushEndpointSchema,
    keys: z.object({ p256dh: Base64Url(80, 100), auth: Base64Url(16, 32) }).strict(),
    /** The browser's own description of itself, shown nowhere; kept to tell browsers apart. */
    userAgent: z.string().trim().max(300).optional(),
  })
  .strict();
export type PushSubscribeInput = z.infer<typeof PushSubscribeInput>;

/** `notifications.push.unsubscribe`: this browser no longer receives pushes. */
export const PushUnsubscribeInput = z.object({ endpoint: PushEndpointSchema }).strict();
export type PushUnsubscribeInput = z.infer<typeof PushUnsubscribeInput>;

export const PushSubscriptionDto = z
  .object({ subscribed: z.boolean() })
  .strict();
export type PushSubscriptionDto = z.infer<typeof PushSubscriptionDto>;

// --- The notify worker's commands (system:workers) --------------------------------------------

/** The events that become notices, each with its worker in `EVENT_WORKERS`. */
export const NOTICE_EVENT_TYPES = [
  'crm.opportunity.assigned',
  'crm.duplicate.found',
  'crm.enquiry.routed',
] as const;
export type NoticeEventType = (typeof NOTICE_EVENT_TYPES)[number];

export function isNoticeEvent(type: string): type is NoticeEventType {
  return (NOTICE_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * `notifications.event.notify`: the notice one event stands for, its people found from the
 * records when the worker runs (the owner may have changed since): the lead's new owner unless
 * they took it themselves, the owners of a duplicate card's leads in its company, or the colleague
 * an enquiry was passed to. `eventId` makes a repeated delivery one notice per person.
 */
export const NotifyEventInput = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('crm.opportunity.assigned'),
      entityId: EntityIdSchema,
      eventId: IdSchema,
      opportunityId: IdSchema,
      ownerId: IdSchema,
      assignedById: IdSchema.nullable(),
    })
    .strict(),
  z
    .object({
      event: z.literal('crm.duplicate.found'),
      entityId: EntityIdSchema,
      eventId: IdSchema,
      candidateId: IdSchema,
    })
    .strict(),
  z
    .object({
      event: z.literal('crm.enquiry.routed'),
      entityId: EntityIdSchema,
      eventId: IdSchema,
      itemId: IdSchema,
      assigneeId: IdSchema,
      accountId: IdSchema,
    })
    .strict(),
]);
export type NotifyEventInput = z.infer<typeof NotifyEventInput>;

/** `notifications.scan`: one company's due calls, lapsing quotes and late first calls. */
export const ScanNoticesInput = z.object({ entityId: EntityIdSchema }).strict();
export type ScanNoticesInput = z.infer<typeof ScanNoticesInput>;

/** A browser a push goes to; the keys are the browser's own, sent back to it encrypted. */
export const PushTargetDto = z
  .object({ endpoint: z.string().max(1000), p256dh: z.string().max(100), auth: z.string().max(32) })
  .strict();
export type PushTargetDto = z.infer<typeof PushTargetDto>;

/**
 * What to do with a new notice's push: `send` it to `targets`, or nothing because it is `held` in
 * quiet hours, `off` for its kind, or there is no browser (`none`).
 */
export const PushPlanSchema = z.enum(['send', 'held', 'off', 'none']);
export type PushPlan = z.infer<typeof PushPlanSchema>;

/** One notice a command wrote; a notice a person already had for the same reason is not one. */
export const WrittenNoticeDto = z
  .object({
    id: IdSchema,
    userId: IdSchema,
    type: NoticeTypeSchema,
    entityId: EntityIdSchema,
    payload: NoticePayloadSchema,
    subjectId: IdSchema,
    push: PushPlanSchema,
    targets: z.array(PushTargetDto),
  })
  .strict();
export type WrittenNoticeDto = z.infer<typeof WrittenNoticeDto>;

/** What a notify or scan command wrote; `more` when a scan left work for another batch. */
export const NoticeBatchDto = z
  .object({ entityId: EntityIdSchema, notices: z.array(WrittenNoticeDto), more: z.boolean() })
  .strict();
export type NoticeBatchDto = z.infer<typeof NoticeBatchDto>;

/**
 * `notifications.push.record`: what became of each notice's push, the browsers the push service
 * says are gone (answered 404 or 410), removed, and the ones that took a push.
 */
export const RecordPushInput = z
  .object({
    entityId: EntityIdSchema,
    outcomes: z
      .array(z.object({ noticeId: IdSchema, push: PushOutcomeSchema }).strict())
      .max(500),
    gone: z.array(z.string().max(1000)).max(500),
    delivered: z.array(z.string().max(1000)).max(500),
  })
  .strict();
export type RecordPushInput = z.infer<typeof RecordPushInput>;

export const PushRecordDto = z.object({ recorded: Count, removed: Count }).strict();
export type PushRecordDto = z.infer<typeof PushRecordDto>;

// --- Routed enquiries (PRD RPT-04 criterion 2) ---------------------------------------------------

/**
 * `crm.enquiry.route`: an enquiry refused as `customer_held_by_colleague` goes to the colleague who
 * looks after the customer in the company, as routed work in their Agent Inbox with the
 * enquiry's interest (the pipeline's segment) and an optional note. The customer is named by
 * `existingAccountId` (the known-customer path) or by the number typed for a new one (`phone`).
 */
export const RouteEnquiryInput = z
  .object({
    entityId: EntityIdSchema,
    pipelineKey: z.string().trim().min(1).max(40),
    existingAccountId: IdSchema.optional(),
    phone: PhoneInputSchema.optional(),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => (v.existingAccountId === undefined) !== (v.phone === undefined), {
    message: 'the customer or the number, one of them',
    path: ['existingAccountId'],
  });
export type RouteEnquiryInput = z.infer<typeof RouteEnquiryInput>;

/** The enquiry went to `colleagueName`, as routed work `itemId`. */
export const RoutedEnquiryDto = z
  .object({
    outcome: z.literal('routed'),
    itemId: IdSchema,
    colleagueName: z.string(),
    segment: SegmentSchema,
  })
  .strict();
export type RoutedEnquiryDto = z.infer<typeof RoutedEnquiryDto>;
