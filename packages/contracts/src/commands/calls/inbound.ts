import { z } from 'zod';
import { PhoneInputSchema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';
import { ProviderCallSidSchema } from './provider-calls';

/**
 * Inbound calls (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05 and CRM-01): what the
 * platform records when Exotel's Passthru applet passes a call to a company's IVR or missed-call
 * number through, and what the person the IVR rings is shown.
 */

/** The company's lines a customer calls in on. */
export const INBOUND_CALL_SERIES = ['ivr', 'missed_call'] as const;
export const InboundCallSeriesSchema = z.enum(INBOUND_CALL_SERIES);
export type InboundCallSeries = z.infer<typeof InboundCallSeriesSchema>;

/** At most this many customers sharing a number are matched and listed on the pop. */
export const INBOUND_MATCH_LIMIT = 20;

/**
 * `calls.inbound_call.record` (the platform, `calls.process`): one call passed through, on the line
 * of the company the dialled number names. `from` is the caller's number and `dialWhom` the number
 * the IVR rings (a person's own dial phone), both as Exotel sends them and normalised here.
 */
export const RecordInboundCallInput = z
  .object({
    entityId: EntityIdSchema,
    series: InboundCallSeriesSchema,
    callSid: ProviderCallSidSchema,
    from: PhoneInputSchema,
    dialWhom: PhoneInputSchema.optional(),
    startedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type RecordInboundCallInput = z.input<typeof RecordInboundCallInput>;

/**
 * `recorded` a new call; `repeat` a call of the company already recorded with this provider id (a
 * repeated delivery), which changes nothing; `other_company` a provider id another company's call
 * holds, which records nothing.
 */
export const INBOUND_CALL_OUTCOMES = ['recorded', 'repeat', 'other_company'] as const;
export const InboundCallOutcomeSchema = z.enum(INBOUND_CALL_OUTCOMES);
export type InboundCallOutcome = z.infer<typeof InboundCallOutcomeSchema>;

/**
 * What the platform recorded, for the webhook handler only (never a screen): the call, the person
 * the IVR rings, the company's customers holding the number (ids only, none on a repeat), and for a
 * missed call the lead it made or joined and the callback given to the lead's owner.
 */
export const InboundCallRecordDto = z
  .object({
    providerCallId: IdSchema.nullable(),
    entityId: EntityIdSchema,
    series: InboundCallSeriesSchema,
    outcome: InboundCallOutcomeSchema,
    answererId: IdSchema.nullable(),
    accountIds: z.array(IdSchema).max(INBOUND_MATCH_LIMIT),
    leadId: IdSchema.nullable(),
    ownerId: IdSchema.nullable(),
    taskId: IdSchema.nullable(),
    taskDueAt: z.iso.datetime().nullable(),
  })
  .strict();
export type InboundCallRecordDto = z.infer<typeof InboundCallRecordDto>;

/**
 * A ringing call waiting for its person (the key-value store's `ringing:<user id>`, held a minute
 * and read once): written by the incoming-call handler after the call is recorded, read and cleared
 * by `GET /api/v1/calls/ringing`. It holds the caller's number only for the new-lead form when no
 * customer of the company has it; it never leaves the server as more than `ScreenPopDto` says.
 */
export const PendingScreenPop = z
  .object({
    providerCallId: IdSchema,
    entityId: EntityIdSchema,
    accountIds: z.array(IdSchema).max(INBOUND_MATCH_LIMIT),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
    ringingAt: z.iso.datetime(),
  })
  .strict();
export type PendingScreenPop = z.infer<typeof PendingScreenPop>;

/** One customer on the pop: one the person may read in the call's company, by name. */
export const ScreenPopCustomer = z
  .object({ accountId: IdSchema, name: z.string().min(1).max(200) })
  .strict();
export type ScreenPopCustomer = z.infer<typeof ScreenPopCustomer>;

/**
 * What the person the IVR rings is shown: the customers of the call's company holding the number
 * that they may read (the matched customer's Account 360 when one, a list when several), the
 * number's last four digits as the app shows a number, and the whole number only to fill the
 * new-lead form when no customer of the company holds it.
 */
export const ScreenPopDto = z
  .object({
    providerCallId: IdSchema,
    entityId: EntityIdSchema,
    ringingAt: z.iso.datetime(),
    phoneLast4: z.string().regex(/^\d{4}$/),
    customers: z.array(ScreenPopCustomer).max(INBOUND_MATCH_LIMIT),
    newLeadPhone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/)
      .nullable(),
  })
  .strict();
export type ScreenPopDto = z.infer<typeof ScreenPopDto>;
