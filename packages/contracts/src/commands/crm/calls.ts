import { z } from 'zod';
import {
  CustomerLanguageSchema,
  OpportunityLostReasonSchema,
  OpportunityNurtureReasonSchema,
  OpportunityStateSchema,
  SegmentSchema,
  StageExitFieldSchema,
  TaskKindSchema,
} from '../../crm/enums';
import { DispositionNextActionSchema } from '../../crm/config';
import { DispositionDto } from './config';
import { ActivityDto } from '../../dto/customer';
import { SearchTextSchema } from '../../dto/search';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The Cold Caller workspace (docs/03-roadmap-appendix/phase1.md §7.2, PRD TEL-01): the `calls` log, the
 * `calls.log` command, the caller's queue and the team lead's view of the team's queues. Every
 * Phase 1 call is dialled by hand on a phone outside the system; click-to-dial is Phase 2.
 */

/** Which way a call went (`calls.direction`). */
export const CallDirectionSchema = z.enum(['outbound', 'inbound']);
export type CallDirection = z.infer<typeof CallDirectionSchema>;

/**
 * The line a call used (`calls.number_series`): a DLT 140 (promotional) or 160 (service) number
 * of the dialler, an inbound virtual number, or `manual`, a call dialled by hand on a phone
 * outside the system, as every Phase 1 call is.
 */
export const CallNumberSeriesSchema = z.enum(['manual', '140', '160', 'inbound']);
export type CallNumberSeries = z.infer<typeof CallNumberSeriesSchema>;

/** The longest call a caller may log, in seconds: four hours. */
export const CALL_DURATION_MAX_SECONDS = 4 * 60 * 60;

/** How far ahead a callback may be set, in days. */
export const CALLBACK_MAX_DAYS = 90;

const LeadRef = { entityId: EntityIdSchema, opportunityId: IdSchema };

/**
 * `calls.log`: a call the caller just made to a lead, with its outcome. What else the outcome
 * needs depends on its next step: a callback time (`callback`), a reason for losing the lead
 * (`not_interested`, `wrong_number`) or for parking it (`nurture`); the command refuses a missing
 * one with its reason.
 */
export const LogCallInput = z
  .object({
    ...LeadRef,
    dispositionId: IdSchema,
    durationSeconds: z.number().int().min(0).max(CALL_DURATION_MAX_SECONDS).optional(),
    callbackAt: z.iso.datetime({ offset: true }).optional(),
    lostReason: OpportunityLostReasonSchema.optional(),
    nurtureReason: OpportunityNurtureReasonSchema.optional(),
  })
  .strict();
export type LogCallInput = z.infer<typeof LogCallInput>;

/** A logged call. Strict. */
export const CallDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    callerId: IdSchema,
    direction: CallDirectionSchema,
    numberSeries: CallNumberSeriesSchema,
    dispositionId: IdSchema,
    attemptNo: z.number().int().min(1),
    startedAt: z.iso.datetime(),
    durationS: z.number().int().min(0).nullable(),
  })
  .strict();
export type CallDto = z.infer<typeof CallDto>;

/** What `calls.log` answers: the call, what it did to the lead and the next call it set, if any. */
export const LogCallResultDto = z
  .object({
    call: CallDto,
    nextAction: DispositionNextActionSchema,
    leadState: OpportunityStateSchema,
    stageId: IdSchema,
    /** The next call the outcome set: a callback, a retry or the first nurture call. */
    nextCall: z.object({ kind: TaskKindSchema, dueAt: z.iso.datetime() }).strict().nullable(),
    /** The unanswered attempts ran out, so the lead moved to nurture. */
    attemptsUsedUp: z.boolean(),
  })
  .strict();
export type LogCallResultDto = z.infer<typeof LogCallResultDto>;

/** Why a lead stands where it does in the queue, first to last. */
export const CallQueueReasonSchema = z.enum([
  'call_due',
  'nurture_due',
  'first_call_late',
  'not_called',
  'to_call',
]);
export type CallQueueReason = z.infer<typeof CallQueueReasonSchema>;

/**
 * A caller's queue, a page at a time. `callerId` names a member of the team for a team lead (it
 * needs `calls.log` at team scope or wider); left out, the caller's own queue.
 */
export const ListCallQueueInput = z
  .object({
    entityId: EntityIdSchema.optional(),
    callerId: IdSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListCallQueueInput = z.input<typeof ListCallQueueInput>;

/** One lead in a queue. Phones show only their last four digits. */
export const CallQueueItemDto = z
  .object({
    opportunityId: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    customerName: z.string(),
    village: z.string().nullable(),
    phoneLast4: z.string().nullable(),
    segment: SegmentSchema,
    stageName: z.string(),
    state: OpportunityStateSchema,
    score: z.number().int(),
    createdAt: z.iso.datetime(),
    reason: CallQueueReasonSchema,
    /** The call task that is due, for `call_due` and `nurture_due`. */
    dueAt: z.iso.datetime().nullable(),
    /** Unanswered attempts in a row so far. */
    attempts: z.number().int().min(0),
    lastCallAt: z.iso.datetime().nullable(),
    /** A contact of the customer withdrew consent to calls: the lead cannot be called. */
    consentWithdrawn: z.boolean(),
  })
  .strict();
export type CallQueueItemDto = z.infer<typeof CallQueueItemDto>;

export const CallQueuePageDto = z
  .object({
    items: z.array(CallQueueItemDto),
    nextCursor: z.string().nullable(),
    /** The moment the queue was read at; the next page reads as of the same moment. */
    asOf: z.iso.datetime(),
  })
  .strict();
export type CallQueuePageDto = z.infer<typeof CallQueuePageDto>;

/** The lead open in the workspace. */
export const LoadCallLeadInput = z.object(LeadRef).strict();
export type LoadCallLeadInput = z.infer<typeof LoadCallLeadInput>;

/** One exit rule of the lead's stage and whether the lead meets it. */
export const ExitCheckDto = z.object({ field: StageExitFieldSchema, met: z.boolean() }).strict();
export type ExitCheckDto = z.infer<typeof ExitCheckDto>;

/** Everything the workspace shows of one lead. Phones show only their last four digits. */
export const CallLeadDto = z
  .object({
    opportunityId: IdSchema,
    entityId: EntityIdSchema,
    accountId: IdSchema,
    state: OpportunityStateSchema,
    customerName: z.string(),
    contactName: z.string().nullable(),
    /** The script variant the customer's calls use (ADR 0014). */
    language: CustomerLanguageSchema,
    segment: SegmentSchema,
    pipelineName: z.string(),
    stageName: z.string(),
    score: z.number().int(),
    village: z.string().nullable(),
    district: z.string().nullable(),
    phoneLast4: z.string().nullable(),
    consentWithdrawn: z.boolean(),
    /** The caller may log a call on this lead (`calls.log` covers it and it is open or nurtured). */
    canLog: z.boolean(),
    /** What the current stage asks before the lead can move on. */
    exitChecks: z.array(ExitCheckDto),
    dispositions: z.array(DispositionDto),
    attempts: z.number().int().min(0),
    maxAttempts: z.number().int().min(1),
    nextCall: z.object({ kind: TaskKindSchema, dueAt: z.iso.datetime() }).strict().nullable(),
    recentActivity: z.array(ActivityDto),
  })
  .strict();
export type CallLeadDto = z.infer<typeof CallLeadDto>;

/** The number to dial for a lead, shown only inside calling hours and with consent in force. */
export const DialNumberInput = z.object(LeadRef).strict();
export type DialNumberInput = z.infer<typeof DialNumberInput>;

export const DialNumberDto = z.object({ e164: z.string() }).strict();
export type DialNumberDto = z.infer<typeof DialNumberDto>;

/** The workspace's search (`/`): the caller's leads by name, village or the phone's last digits. */
export const SearchCallLeadsInput = z.object({ q: SearchTextSchema }).strict();
export type SearchCallLeadsInput = z.input<typeof SearchCallLeadsInput>;

/** The team lead's view: the queue of each caller of the team. */
export const ListTeamQueuesInput = z.object({ entityId: EntityIdSchema.optional() }).strict();
export type ListTeamQueuesInput = z.input<typeof ListTeamQueuesInput>;

export const TeamQueueDto = z
  .object({
    callerId: IdSchema,
    callerName: z.string(),
    entityId: EntityIdSchema,
    /** Leads waiting in the caller's queue now. */
    waiting: z.number().int().min(0),
    /** Of those, callbacks, retries and nurture calls that are due. */
    due: z.number().int().min(0),
    /** Of those, new leads whose first call is late. */
    late: z.number().int().min(0),
    /** Calls the caller logged today (IST). */
    callsToday: z.number().int().min(0),
  })
  .strict();
export type TeamQueueDto = z.infer<typeof TeamQueueDto>;
