import { z } from 'zod';
import { AgentFilterReasonSchema } from './agents';
import { EntityIdSchema, IdSchema } from './ids';

// The Triage agent in shadow (docs/03-roadmap-appendix/phase1.md §9, A1; PRD AI-04, AI-05): what it
// proposes for a new lead and the shadow report that sets each proposal beside what people did.

/**
 * A short note the agent gives with a proposal, checked by the output filter before it is
 * recorded: no phone number, identity number or instruction. Shown only on the shadow report.
 */
export const TriageNoteSchema = z.string().trim().min(1).max(160);

/**
 * `triage.pipeline.choose`: the pipeline the agent would have put the lead in, by its key. A
 * shadow-only kind: no command moves a lead between pipelines, so it is recorded, never run.
 */
export const TriagePipelineProposalInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    pipelineKey: z.string().min(1).max(40),
    note: TriageNoteSchema.optional(),
  })
  .strict();
export type TriagePipelineProposalInput = z.infer<typeof TriagePipelineProposalInput>;

/**
 * `triage.score.adjust`: the change to the lead's rules-based score the agent would have made,
 * within the bounds the filter holds it to (`AGENT_DEFAULTS.triage.scoreAdjustmentMax`), and the
 * score it gives. A shadow-only kind: scores come only from the score rules (CRM-06).
 */
export const TriageScoreProposalInput = z
  .object({
    entityId: EntityIdSchema,
    opportunityId: IdSchema,
    adjustment: z.number().int().min(-100).max(100),
    score: z.number().int().min(0).max(100),
    note: TriageNoteSchema.optional(),
  })
  .strict();
export type TriageScoreProposalInput = z.infer<typeof TriageScoreProposalInput>;

/** The four kinds of proposal the Triage agent makes, as the shadow report names them. */
export const TRIAGE_PROPOSAL_KINDS = ['pipeline', 'score', 'duplicate', 'assignee'] as const;
export const TriageProposalKindSchema = z.enum(TRIAGE_PROPOSAL_KINDS);
export type TriageProposalKind = z.infer<typeof TriageProposalKindSchema>;

/** The action type of each kind: a command where one exists, else the shadow-only kind's name. */
export const TRIAGE_ACTION_TYPES = {
  pipeline: 'triage.pipeline.choose',
  score: 'triage.score.adjust',
  duplicate: 'crm.duplicate.suggest',
  assignee: 'crm.opportunity.assign',
} as const satisfies Record<TriageProposalKind, string>;

/** Whether what people did with the lead bears the proposal out, contradicts it, or is not known yet. */
export const SHADOW_AGREEMENTS = ['agree', 'disagree', 'pending'] as const;
export const ShadowAgreementSchema = z.enum(SHADOW_AGREEMENTS);
export type ShadowAgreement = z.infer<typeof ShadowAgreementSchema>;

/** The longest period the shadow report covers, in days. */
export const SHADOW_REPORT_MAX_DAYS = 92;

const Day = z.iso.date();

/** `shadowReport`: one company's shadowed proposals in a period of IST days, newest first. */
export const ShadowReportInput = z
  .object({
    entityId: EntityIdSchema,
    from: Day,
    to: Day,
    cursor: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((i) => i.from <= i.to, { path: ['to'], message: 'period_reversed' })
  .refine(
    (i) => Date.parse(i.to) - Date.parse(i.from) <= (SHADOW_REPORT_MAX_DAYS - 1) * 86_400_000,
    { path: ['from'], message: 'period_too_long' },
  );
export type ShadowReportInput = z.infer<typeof ShadowReportInput>;

/** One shadowed proposal beside the lead as it stands. Strict. */
export const ShadowProposalDto = z
  .object({
    actionId: IdSchema,
    kind: TriageProposalKindSchema,
    createdAt: z.iso.datetime(),
    opportunityId: IdSchema,
    /** The lead's customer, for a link to Account 360, when the viewer reads it. */
    accountId: IdSchema.nullable(),
    customerName: z.string().nullable(),
    /** What the agent proposed: one of these is set, by kind. */
    proposedPipelineKey: z.string().nullable(),
    proposedScoreChange: z.number().int().nullable(),
    proposedScore: z.number().int().nullable(),
    otherOpportunityId: IdSchema.nullable(),
    proposedOwnerId: IdSchema.nullable(),
    proposedOwnerName: z.string().nullable(),
    note: z.string().nullable(),
    /** The lead now, when the viewer reads it. */
    pipelineKey: z.string().nullable(),
    score: z.number().int().nullable(),
    leadState: z.enum(['open', 'nurture', 'won', 'lost']).nullable(),
    /** Whether the lead reached Qualified or a later stage of its pipeline. */
    reachedQualified: z.boolean().nullable(),
    ownerId: IdSchema.nullable(),
    ownerName: z.string().nullable(),
    /** For a duplicate link: where the card of the two leads stands. */
    duplicateState: z.enum(['open', 'merged', 'dismissed']).nullable(),
    agreement: ShadowAgreementSchema,
  })
  .strict();
export type ShadowProposalDto = z.infer<typeof ShadowProposalDto>;

/** The proposals of one kind in the period, and the runs the output filter stopped. */
export const ShadowKindSummaryDto = z
  .object({
    kind: TriageProposalKindSchema,
    proposals: z.number().int().min(0),
    agreed: z.number().int().min(0),
    disagreed: z.number().int().min(0),
    pending: z.number().int().min(0),
    filtered: z.array(
      z.object({ reason: AgentFilterReasonSchema, runs: z.number().int().min(1) }).strict(),
    ),
  })
  .strict();
export type ShadowKindSummaryDto = z.infer<typeof ShadowKindSummaryDto>;

export const ShadowReportDto = z
  .object({
    entityId: EntityIdSchema,
    from: Day,
    to: Day,
    summary: z.array(ShadowKindSummaryDto),
    items: z.array(ShadowProposalDto),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ShadowReportDto = z.infer<typeof ShadowReportDto>;
