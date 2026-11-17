import { z } from 'zod';
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
