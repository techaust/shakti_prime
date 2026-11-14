import { z } from 'zod';
import { FileSha256Schema } from '../../api/files';
import { E164Schema } from '../../crm/phone';
import { EntityIdSchema, IdSchema } from '../../ids';
import { CALL_PURPOSES, DIAL_REFUSAL_REASONS } from './dial';

/**
 * Click-to-dial and recordings (docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01 and TEL-04):
 * the provider's call (`provider_calls`), the person's dial, what the platform records of the
 * provider's reports, the call's recording, and the caller's own dial phone.
 */

/** Why a call is made: selling (promotional) or about something the customer asked for (service). */
export type DialPurpose = (typeof CALL_PURPOSES)[number];

/**
 * Where a provider call stands. Dialling (the person pressed Dial), ringing (the provider took the
 * call), in progress (both phones on the line), then one of the ends, after which nothing changes.
 */
export const PROVIDER_CALL_STATUSES = [
  'dialling',
  'ringing',
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const;
export const ProviderCallStatusSchema = z.enum(PROVIDER_CALL_STATUSES);
export type ProviderCallStatus = z.infer<typeof ProviderCallStatusSchema>;

/** The ends of a call: once one is recorded, no later report changes the call. */
export const PROVIDER_CALL_ENDS = [
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const satisfies readonly ProviderCallStatus[];

/** What the platform may report: every status but dialling, which only the dial records. */
export const REPORTED_CALL_STATUSES = [
  'ringing',
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const satisfies readonly ProviderCallStatus[];
export const ReportedCallStatusSchema = z.enum(REPORTED_CALL_STATUSES);
export type ReportedCallStatus = z.infer<typeof ReportedCallStatusSchema>;

/** The company's line a provider call used: the 140 or 160 calling number, the IVR or missed-call number. */
export const PROVIDER_CALL_SERIES = ['140', '160', 'ivr', 'missed_call'] as const;
export const ProviderCallSeriesSchema = z.enum(PROVIDER_CALL_SERIES);

/** The lines a person dials out on. */
export const DIALLED_SERIES = [
  '140',
  '160',
] as const satisfies readonly (typeof PROVIDER_CALL_SERIES)[number][];

/** The provider's own id of a call (Exotel's CallSid). */
export const ProviderCallSidSchema = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);

/** A provider call as a screen reads it. The phones are never in it. Strict. */
export const ProviderCallDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    callerId: IdSchema.nullable(),
    direction: z.enum(['outbound', 'inbound']),
    series: ProviderCallSeriesSchema,
    purpose: z.enum(CALL_PURPOSES).nullable(),
    status: ProviderCallStatusSchema,
    startedAt: z.iso.datetime(),
    answeredAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    durationS: z.number().int().min(0).nullable(),
    /** A recording is stored and may be played (with `calls.recording.listen`). */
    hasRecording: z.boolean(),
    /** The person's log of the call, once they logged it. */
    callId: IdSchema.nullable(),
  })
  .strict();
export type ProviderCallDto = z.infer<typeof ProviderCallDto>;

/**
 * `calls.call.dial`: a call to one phone of a lead's customer; without `contactPhoneId`, the main
 * number of the customer's owner contact, as the workspaces dial it.
 */
export const DialCallInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    contactPhoneId: IdSchema.optional(),
  })
  .strict();
export type DialCallInput = z.input<typeof DialCallInput>;

/**
 * What `calls.call.dial` answers to the dialler on the server, never to a screen: the call as
 * recorded, and what the provider is asked to do. The phones are the caller's own (rung first)
 * and the customer's; the caller id is the company's number for the purpose.
 */
export const DialPlacementDto = z
  .object({
    call: ProviderCallDto,
    placement: z
      .object({
        agentNumber: E164Schema,
        customerNumber: E164Schema,
        callerId: E164Schema,
        purpose: z.enum(CALL_PURPOSES),
        hasRecordedConsent: z.boolean(),
        /** The DND state the dial was checked on; false when unknown for a consented service call. */
        onDnd: z.boolean(),
        callConsentWithdrawn: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type DialPlacementDto = z.infer<typeof DialPlacementDto>;

/** The rules a refused dial broke, every one of them, for the screen to say. */
export const DialRefusalSchema = z.enum(DIAL_REFUSAL_REASONS);

/**
 * `calls.provider_call.record`: what the provider reported for a call, recorded by the platform
 * (`calls.process`). `callSid` is the provider's id, taken when the call has none yet.
 */
export const RecordProviderCallInput = z
  .object({
    entityId: EntityIdSchema,
    providerCallId: IdSchema,
    callSid: ProviderCallSidSchema.optional(),
    status: ReportedCallStatusSchema,
    answeredAt: z.iso.datetime({ offset: true }).optional(),
    endedAt: z.iso.datetime({ offset: true }).optional(),
    durationSeconds: z.number().int().min(0).max(14_400).optional(),
  })
  .strict();
export type RecordProviderCallInput = z.input<typeof RecordProviderCallInput>;

/**
 * What a report did: `moved` the call on (or took the provider's id), changed nothing
 * (`unchanged`: the same or an earlier status), found no such call of the company (`missing`), or
 * named a call that holds another id (`other_call`).
 */
export const PROVIDER_CALL_RECORD_OUTCOMES = [
  'moved',
  'unchanged',
  'missing',
  'other_call',
] as const;

export const ProviderCallRecordDto = z
  .object({
    providerCallId: IdSchema,
    outcome: z.enum(PROVIDER_CALL_RECORD_OUTCOMES),
    status: ProviderCallStatusSchema.nullable(),
  })
  .strict();
export type ProviderCallRecordDto = z.infer<typeof ProviderCallRecordDto>;

/** The kinds of file a call recording is stored as. */
export const CALL_RECORDING_CONTENT_TYPES = ['audio/mpeg', 'audio/wav'] as const;
export const CallRecordingContentTypeSchema = z.enum(CALL_RECORDING_CONTENT_TYPES);
export type CallRecordingContentType = z.infer<typeof CallRecordingContentTypeSchema>;

/** The largest recording kept: a four-hour call in MP3 is well under it. */
export const CALL_RECORDING_MAX_BYTES = 200 * 1024 * 1024;

/**
 * `calls.recording.attach`: the platform recorded the recording it copied into the file store
 * under `key` (`<company>/call_recording/<file id>.<mp3 or wav>`) as the ended call's file.
 */
export const AttachCallRecordingInput = z
  .object({
    entityId: EntityIdSchema,
    providerCallId: IdSchema,
    fileId: IdSchema,
    bucket: z.string().min(1).max(100),
    key: z.string().min(1).max(300),
    contentType: CallRecordingContentTypeSchema,
    size: z.number().int().min(1).max(CALL_RECORDING_MAX_BYTES),
    sha256: FileSha256Schema,
  })
  .strict();
export type AttachCallRecordingInput = z.input<typeof AttachCallRecordingInput>;

/**
 * What attaching did: `attached`, or `already` (the same file), and nothing for `other_file` (the
 * call has another recording), `not_ended` (the call has not ended) or `missing` (no such call).
 */
export const CALL_RECORDING_ATTACH_OUTCOMES = [
  'attached',
  'already',
  'other_file',
  'not_ended',
  'missing',
] as const;

export const AttachCallRecordingDto = z
  .object({
    providerCallId: IdSchema,
    outcome: z.enum(CALL_RECORDING_ATTACH_OUTCOMES),
    fileId: IdSchema.nullable(),
  })
  .strict();
export type AttachCallRecordingDto = z.infer<typeof AttachCallRecordingDto>;

/** `calls.recording.delete`: the platform removed a recording's bytes; its file is marked deleted. */
export const DeleteCallRecordingInput = z
  .object({ entityId: EntityIdSchema, fileId: IdSchema })
  .strict();
export type DeleteCallRecordingInput = z.input<typeof DeleteCallRecordingInput>;

export const DeleteCallRecordingDto = z.object({ fileId: IdSchema, deleted: z.boolean() }).strict();
export type DeleteCallRecordingDto = z.infer<typeof DeleteCallRecordingDto>;

/** A recording due for removal, as the sweep reads it. */
export const DueCallRecordingDto = z
  .object({ fileId: IdSchema, entityId: EntityIdSchema, bucket: z.string(), key: z.string() })
  .strict();
export type DueCallRecordingDto = z.infer<typeof DueCallRecordingDto>;

/** `calls.recording.play`: a provider call's recording, to hear. */
export const PlayCallRecordingInput = z
  .object({ entityId: EntityIdSchema, providerCallId: IdSchema })
  .strict();
export type PlayCallRecordingInput = z.input<typeof PlayCallRecordingInput>;

/**
 * Where the recording to play is stored, answered to the server, which signs a short-lived
 * address for it (`PRESIGN_SECONDS`); never sent to a screen.
 */
export const CallRecordingToPlayDto = z
  .object({
    providerCallId: IdSchema,
    fileId: IdSchema,
    bucket: z.string(),
    key: z.string(),
    name: z.string(),
    contentType: CallRecordingContentTypeSchema,
  })
  .strict();
export type CallRecordingToPlayDto = z.infer<typeof CallRecordingToPlayDto>;

/** `crm.caller_profile.set_dial_phone`: the caller's own phone that click-to-dial rings first. */
export const SetDialPhoneInput = z
  .object({ entityId: EntityIdSchema, phone: E164Schema.nullable() })
  .strict();
export type SetDialPhoneInput = z.input<typeof SetDialPhoneInput>;

export const DialPhoneDto = z
  .object({ entityId: EntityIdSchema, dialPhone: E164Schema.nullable() })
  .strict();
export type DialPhoneDto = z.infer<typeof DialPhoneDto>;

/**
 * Whether the Dial key is offered on a lead of a company: the runtime has a telephony provider and
 * the company a 140 or 160 calling number in use (`available`), and whether the caller has set
 * their own dial phone there. Without it the manual flow stays.
 */
export const DialReadinessDto = z
  .object({ available: z.boolean(), dialPhoneSet: z.boolean() })
  .strict();
export type DialReadinessDto = z.infer<typeof DialReadinessDto>;

/** A company the workspace asks about. */
export const DialReadinessInput = z.object({ entityId: EntityIdSchema }).strict();
export type DialReadinessInput = z.input<typeof DialReadinessInput>;

/**
 * What the Dial key answers: the call as placed, or every calling rule the dial broke, which the
 * screen lists. A failure of another kind (not set up, the provider refused) is the action's error.
 */
export const DialOutcomeDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('placed'), call: ProviderCallDto }).strict(),
  z.object({ kind: z.literal('refused'), refusals: z.array(DialRefusalSchema).min(1) }).strict(),
]);
export type DialOutcomeDto = z.infer<typeof DialOutcomeDto>;

/** One provider call of a company, as its caller's call bar reads it again. */
export const ProviderCallRefInput = z
  .object({ entityId: EntityIdSchema, providerCallId: IdSchema })
  .strict();
export type ProviderCallRefInput = z.input<typeof ProviderCallRefInput>;

/** A short-lived address that plays a call recording, and when it stops working. */
export const RecordingAddressDto = z
  .object({ url: z.string().min(1), expiresAt: z.iso.datetime() })
  .strict();
export type RecordingAddressDto = z.infer<typeof RecordingAddressDto>;

/** The platform's view of a reported call: its company, status, provider id and recording. */
export const ProviderCallForReportDto = z
  .object({
    entityId: EntityIdSchema,
    status: ProviderCallStatusSchema,
    providerCallSid: ProviderCallSidSchema.nullable(),
    hasRecording: z.boolean(),
  })
  .strict();
export type ProviderCallForReportDto = z.infer<typeof ProviderCallForReportDto>;

/** A dial the provider never took nor reported, for the sweep to close as failed. */
export const UnplacedProviderCallDto = z
  .object({ id: IdSchema, entityId: EntityIdSchema })
  .strict();
export type UnplacedProviderCallDto = z.infer<typeof UnplacedProviderCallDto>;
