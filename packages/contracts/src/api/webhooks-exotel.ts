import { z } from 'zod';

/**
 * Exotel callbacks (docs/06-api.md §3.4), shaped as Exotel's call API and Passthru applet references
 * describe them. Exotel sends every value as a string (form fields or a JSON body when the call
 * asks for `StatusCallbackContentType: application/json`), and adds fields over time, so the
 * objects are loose. How each callback is authenticated is fixed by the week 6 Exotel spike
 * (docs/03-roadmap.md §2); nothing is parsed before that check passes.
 */

/** `YYYY-MM-DD HH:mm:ss`, in IST, as Exotel writes times. */
const ExotelTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

/** Seconds as a string; empty when the call never connected. */
const SecondsString = z.string().regex(/^\d*$/);

/** Numbers as Exotel sends them: `0` trunk prefix or `+91`, never trusted as E.164 until normalised. */
const ExotelNumber = z.string().regex(/^\+?\d{6,15}$/);

export const EXOTEL_CALL_STATUSES = [
  'queued',
  'in-progress',
  'completed',
  'failed',
  'busy',
  'no-answer',
  'canceled',
] as const;
export const ExotelCallStatusSchema = z.enum(EXOTEL_CALL_STATUSES);

/**
 * `POST /webhooks/exotel/call-status`: the terminal status of a click-to-dial call. `CustomField`
 * carries the BOS `calls.id` set when the call was placed, so the worker finds the row without
 * matching on numbers.
 */
export const ExotelCallStatusWebhook = z.looseObject({
  CallSid: z.string().min(1),
  EventType: z.enum(['terminal', 'answered']).optional(),
  Status: ExotelCallStatusSchema,
  Direction: z.string().optional(),
  From: ExotelNumber.optional(),
  To: ExotelNumber.optional(),
  PhoneNumberSid: z.string().optional(),
  DateCreated: ExotelTime.optional(),
  DateUpdated: ExotelTime,
  StartTime: ExotelTime.optional(),
  EndTime: ExotelTime.optional(),
  ConversationDuration: SecondsString.optional(),
  /** Empty when the call was not recorded. The worker copies the file to S3 and never keeps the link. */
  RecordingUrl: z.union([z.url({ protocol: /^https$/ }), z.literal('')]).optional(),
  CustomField: z.string().optional(),
  Legs: z
    .array(
      z.looseObject({
        Status: z.string().optional(),
        OnCallDuration: SecondsString.optional(),
      }),
    )
    .optional(),
});
export type ExotelCallStatusWebhook = z.infer<typeof ExotelCallStatusWebhook>;

/**
 * `POST /webhooks/exotel/incoming`: the Passthru applet on an entity's inbound flow. The worker
 * matches `CallFrom` to a contact and raises the screen-pop event for the caller who answers.
 */
export const ExotelIncomingWebhook = z.looseObject({
  CallSid: z.string().min(1),
  CallFrom: ExotelNumber,
  /** The entity's virtual number that was dialled. */
  CallTo: ExotelNumber,
  Direction: z.literal('incoming'),
  CallType: z.string().optional(),
  Created: z.string().optional(),
  StartTime: ExotelTime.optional(),
  DialWhomNumber: z.union([ExotelNumber, z.literal('')]).optional(),
  CurrentTime: ExotelTime.optional(),
  /** IVR key pressed, which Exotel wraps in double quotes (`"1"`). */
  digits: z.string().optional(),
  flow_id: z.string().optional(),
});
export type ExotelIncomingWebhook = z.infer<typeof ExotelIncomingWebhook>;
