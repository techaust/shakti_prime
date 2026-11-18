import { z } from 'zod';
import { AgentFilterReasonSchema, InboxItemDto } from './agents';
import { ShadowAgreementSchema } from './triage';
import { FileSha256Schema } from './api/files';
import { WhatsAppTemplateNameSchema } from './api/messaging';
import { LeadQualificationFactsSchema } from './commands/crm/ingest';
import { EntityIdSchema, IdSchema } from './ids';

// The Caller Co-pilot (docs/03-roadmap-appendix/phase2.md §7.3, PRD AI-04 and TEL-03): the briefs and
// call summaries it records on a lead, and the WhatsApp follow-up it may propose.

/** `copilot_notes.kind`: a brief before the call, or the summary of a recorded call. */
export const COPILOT_NOTE_KINDS = ['brief', 'call_summary'] as const;
export const CopilotNoteKindSchema = z.enum(COPILOT_NOTE_KINDS);
export type CopilotNoteKind = z.infer<typeof CopilotNoteKindSchema>;

/** The longest brief or summary, in characters (design §7.3). */
export const COPILOT_NOTE_MAX = 600;

/**
 * A brief or a summary as it is kept: plain text the output filter passed (no identity number,
 * contact detail, instruction or link), masked again before it is stored.
 */
export const CopilotNoteBodySchema = z.string().trim().min(1).max(COPILOT_NOTE_MAX);

/**
 * The qualification facts the Co-pilot heard in a call, each within its field's bounds. The
 * DISCOM consumer number is never taken from a call: it is a long number the transcript's masking
 * hides, and a person types it from the bill.
 */
export const CopilotFactsSchema = LeadQualificationFactsSchema.omit({ discomConsumerNo: true });
export type CopilotFacts = z.infer<typeof CopilotFactsSchema>;

/** The qualification facts the Co-pilot may propose, in the order a screen shows them. */
export const COPILOT_FACTS = [
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
] as const satisfies readonly (keyof CopilotFacts)[];
export type CopilotFact = (typeof COPILOT_FACTS)[number];

/**
 * `agents.note.record`: the Co-pilot records a brief or a call summary on a lead it reads. A
 * summary names the provider call it summarises, the facts it heard and the outcome it would
 * pre-select in the call log; a brief names none of them.
 */
export const RecordCopilotNoteInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    kind: CopilotNoteKindSchema,
    providerCallId: IdSchema.optional(),
    body: CopilotNoteBodySchema,
    fields: CopilotFactsSchema.default({}),
    suggestedDispositionId: IdSchema.optional(),
    /** The suggestion filed with the note (the facts heard), when there is one. */
    agentActionId: IdSchema.optional(),
  })
  .strict()
  .refine((i) => (i.kind === 'call_summary') === (i.providerCallId !== undefined), {
    path: ['providerCallId'],
    message: 'call_summary_needs_call',
  })
  .refine(
    (i) =>
      i.kind === 'call_summary' ||
      (i.suggestedDispositionId === undefined && Object.keys(i.fields).length === 0),
    { path: ['kind'], message: 'brief_has_no_outcome' },
  );
export type RecordCopilotNoteInput = z.input<typeof RecordCopilotNoteInput>;

/** A Co-pilot note as the lead's readers see it. Strict. */
export const CopilotNoteDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    providerCallId: IdSchema.nullable(),
    kind: CopilotNoteKindSchema,
    body: z.string(),
    fields: CopilotFactsSchema,
    suggestedDispositionId: IdSchema.nullable(),
    agentActionId: IdSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CopilotNoteDto = z.infer<typeof CopilotNoteDto>;

/**
 * Why a WhatsApp follow-up is proposed (CALL-5): a nurture message on a nurture day
 * (`WORKSHOP_DEFAULTS.calling.nurtureCallDays`), or a nudge two days before a sent quote expires.
 */
export const COPILOT_TEMPLATE_OCCASIONS = ['nurture', 'quote_expiry'] as const;
export const CopilotTemplateOccasionSchema = z.enum(COPILOT_TEMPLATE_OCCASIONS);
export type CopilotTemplateOccasion = z.infer<typeof CopilotTemplateOccasionSchema>;

/**
 * `messaging.template.request`: a WhatsApp template proposed for a lead's customer, on its
 * occasion. Approved, it queues the template on the customer's chat as the approving person
 * (`messaging.message.send`). Only a template with no blanks to fill is proposed, so the person
 * approves exactly the words that will be sent.
 */
export const RequestTemplateInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    occasion: CopilotTemplateOccasionSchema,
    /** The sent quote about to expire, for a quote-expiry nudge only. */
    quoteId: IdSchema.optional(),
    templateName: WhatsAppTemplateNameSchema,
  })
  .strict()
  .refine((i) => (i.occasion === 'quote_expiry') === (i.quoteId !== undefined), {
    path: ['quoteId'],
    message: 'quote_expiry_needs_quote',
  });
export type RequestTemplateInput = z.infer<typeof RequestTemplateInput>;

/** The Co-pilot's action types (`AGENT_ACTION_TYPES`), each the command it proposes. */
export const COPILOT_ACTION_TYPES = {
  qualification: 'crm.lead.qualification.set',
  followUp: 'crm.task.create',
  template: 'messaging.template.request',
} as const;

/**
 * `agents.brief.request`: a person asks the Co-pilot for a brief on a lead they read, on demand
 * (at most once an hour per lead); the brief worker writes it from `agents.brief.requested`.
 */
export const RequestCopilotBriefInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema })
  .strict();
export type RequestCopilotBriefInput = z.input<typeof RequestCopilotBriefInput>;

export const RequestCopilotBriefDto = z
  .object({ opportunityId: IdSchema, requestedAt: z.iso.datetime() })
  .strict();
export type RequestCopilotBriefDto = z.infer<typeof RequestCopilotBriefDto>;

/** The longest masked call transcript kept, in characters. */
export const CALL_TRANSCRIPT_MAX_CHARS = 100_000;

/**
 * `calls.transcript.attach` (the platform's, `calls.process`): the masked transcript of a call's
 * recording was stored under its own key (`callTranscriptKey`) and is recorded as the call's
 * `call_transcript` file, once.
 */
export const AttachCallTranscriptInput = z
  .object({
    entityId: EntityIdSchema,
    providerCallId: IdSchema,
    fileId: IdSchema,
    bucket: z.string().min(1).max(100),
    key: z.string().min(1).max(300),
    /** UTF-8 bytes of the masked text: at most four bytes a character. */
    size: z
      .number()
      .int()
      .min(1)
      .max(CALL_TRANSCRIPT_MAX_CHARS * 4),
    sha256: FileSha256Schema,
  })
  .strict();
export type AttachCallTranscriptInput = z.input<typeof AttachCallTranscriptInput>;

/**
 * What attaching did: `attached`, or `already` (the same file), and nothing for `other_file` (the
 * call has another transcript), `not_recorded` (the call has not ended, its recording is gone or
 * its lead was anonymised) or `missing` (no such call).
 */
export const CALL_TRANSCRIPT_ATTACH_OUTCOMES = [
  'attached',
  'already',
  'other_file',
  'not_recorded',
  'missing',
] as const;

export const AttachCallTranscriptDto = z
  .object({
    providerCallId: IdSchema,
    outcome: z.enum(CALL_TRANSCRIPT_ATTACH_OUTCOMES),
    fileId: IdSchema.nullable(),
  })
  .strict();
export type AttachCallTranscriptDto = z.infer<typeof AttachCallTranscriptDto>;

/** The key a call's transcript is stored under: `<company>/call_transcript/<file id>.txt`. */
export function callTranscriptKey(entityId: number, fileId: string): string {
  return `${String(entityId)}/call_transcript/${fileId}.txt`;
}

/** `agents.copilot.panel`: the Co-pilot panel of one lead the caller reads. */
export const CopilotPanelInput = z
  .object({ entityId: EntityIdSchema, opportunityId: IdSchema })
  .strict();
export type CopilotPanelInput = z.input<typeof CopilotPanelInput>;

/** A brief or a summary as the panel shows it, with the outcome's label for a summary. */
export const CopilotPanelNoteDto = z
  .object({
    id: IdSchema,
    kind: CopilotNoteKindSchema,
    body: z.string(),
    fields: CopilotFactsSchema,
    providerCallId: IdSchema.nullable(),
    suggestedDispositionId: IdSchema.nullable(),
    suggestedOutcomeLabel: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CopilotPanelNoteDto = z.infer<typeof CopilotPanelNoteDto>;

export const CopilotPanelDto = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    /** The newest brief. */
    brief: CopilotPanelNoteDto.nullable(),
    /** The newest call summary, of a dial call of the lead. */
    summary: CopilotPanelNoteDto.nullable(),
    /**
     * The outcome to pre-select in the call log: the newest summary's, while the call it summarises
     * is not logged yet. Never logged by the agent.
     */
    preselectDispositionId: IdSchema.nullable(),
    /** When a brief may next be asked for; null when one may be asked for now. */
    nextBriefAt: z.iso.datetime().nullable(),
    /** The Co-pilot's open suggestions on the lead that the caller may act on. */
    suggestions: z.array(InboxItemDto),
    /** The facts a suggestion to record what was heard would record, by its inbox item. */
    suggestedFacts: z.record(IdSchema, CopilotFactsSchema),
  })
  .strict();
export type CopilotPanelDto = z.infer<typeof CopilotPanelDto>;

/** Whether a summary's outcome matches the call as logged; `none` when it suggested none. */
export const COPILOT_OUTCOME_AGREEMENTS = ['agree', 'disagree', 'pending', 'none'] as const;
export const CopilotOutcomeAgreementSchema = z.enum(COPILOT_OUTCOME_AGREEMENTS);
export type CopilotOutcomeAgreement = z.infer<typeof CopilotOutcomeAgreementSchema>;

/** One fact a summary heard beside what the lead now records. */
export const CopilotReportFactDto = z
  .object({
    fact: z.enum(COPILOT_FACTS),
    heard: z.number(),
    recorded: z.number().nullable(),
    agreement: ShadowAgreementSchema,
  })
  .strict();
export type CopilotReportFactDto = z.infer<typeof CopilotReportFactDto>;

/** One call summary beside what the caller logged and what the lead records. Strict. */
export const CopilotReportItemDto = z
  .object({
    noteId: IdSchema,
    createdAt: z.iso.datetime(),
    opportunityId: IdSchema,
    accountId: IdSchema.nullable(),
    customerName: z.string().nullable(),
    suggestedOutcome: z.string().nullable(),
    loggedOutcome: z.string().nullable(),
    outcomeAgreement: CopilotOutcomeAgreementSchema,
    facts: z.array(CopilotReportFactDto),
  })
  .strict();
export type CopilotReportItemDto = z.infer<typeof CopilotReportItemDto>;

const Counts = z
  .object({
    agreed: z.number().int().min(0),
    disagreed: z.number().int().min(0),
    pending: z.number().int().min(0),
  })
  .strict();

/**
 * The Co-pilot's shadow report (design §7.3): one company's call summaries in a period, their
 * suggested outcomes and heard facts beside what callers logged and leads record, the runs the
 * output filter refused by reason, and its proposals by action type and how they ended.
 */
export const CopilotReportDto = z
  .object({
    entityId: EntityIdSchema,
    from: z.iso.date(),
    to: z.iso.date(),
    summaries: z.number().int().min(0),
    outcomes: Counts.extend({ none: z.number().int().min(0) }).strict(),
    facts: Counts,
    filtered: z.array(
      z.object({ reason: AgentFilterReasonSchema, runs: z.number().int().min(0) }).strict(),
    ),
    proposals: z.array(
      z
        .object({
          actionType: z.string(),
          shadowed: z.number().int().min(0),
          waiting: z.number().int().min(0),
          approved: z.number().int().min(0),
          rejected: z.number().int().min(0),
        })
        .strict(),
    ),
    items: z.array(CopilotReportItemDto),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type CopilotReportDto = z.infer<typeof CopilotReportDto>;
