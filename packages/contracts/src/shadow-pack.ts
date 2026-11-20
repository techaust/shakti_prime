import { z } from 'zod';
import { AgentFilterReasonSchema } from './agents';
import { MoneySchema } from './catalogue/enums';
import { LeadQualificationFactsSchema } from './commands/crm/ingest';
import { EntityIdSchema, IdSchema } from './ids';
import { SHADOW_REPORT_MAX_DAYS } from './triage';
import { WhatsAppHandoffReasonSchema } from './whatsapp';

// The G2 shadow review pack (docs/03-roadmap-appendix/phase2.md §8.1): the figures the WhatsApp
// Concierge's and the Caller Co-pilot's shadow reports add per action type (proposals, agreement
// with what people did, the output filter's refusals), the Concierge's hand-offs, each agent's AI
// spend per lead, and the review sample of at most 50 draft-and-reply pairs per agent that the
// Executive reads offline before an action type leaves Shadow.

const Count = z.number().int().min(0);

/** The runs of one action type the output filter refused, by reason. */
export const AgentRefusalCountDto = z
  .object({ reason: AgentFilterReasonSchema, runs: Count })
  .strict();
export type AgentRefusalCountDto = z.infer<typeof AgentRefusalCountDto>;

/**
 * One action type's proposals in the period and how people's own work compares with them. Each
 * proposal is counted once in agreed, edited, disagreed or open (the rules are
 * `shadowActionsSql()`'s in `packages/domain/src/queries/agents/shadow-pack.ts`):
 * - decided by a person: approved as proposed agrees, approved after an edit is edited, rejected
 *   disagrees; dismissed under Suggest ("done, or not wanted") is compared as Shadow is;
 * - waiting for a person, or carried out by the agent itself (Automatic): open;
 * - recorded in Shadow, compared with what people did, for a viewer who reads the audit trail
 *   (`compared` on the report): the facts a person recorded first after it, a person's own task of
 *   the kind proposed made soon after and due near the proposed time, the template a person sent
 *   soon after; a reply in Shadow stays open, since only a reader can judge two texts (the review
 *   set).
 */
export const AgentProposalFiguresDto = z
  .object({
    actionType: z.string(),
    proposals: Count,
    shadowed: Count,
    waiting: Count,
    /** Approved by a person, as proposed or after an edit. */
    approved: Count,
    /** Rejected, or dismissed under Suggest. */
    rejected: Count,
    /** Carried out by the agent itself (Automatic, not available before Phase 6). */
    executed: Count,
    /** Approved, edited, rejected or dismissed by a person. */
    decided: Count,
    agreed: Count,
    edited: Count,
    disagreed: Count,
    open: Count,
    filtered: z.array(AgentRefusalCountDto),
  })
  .strict();
export type AgentProposalFiguresDto = z.infer<typeof AgentProposalFiguresDto>;

/**
 * The agent's AI spend in the period over the distinct leads it worked on: its runs' cost (every
 * run, a refused or stopped one too), never an item cost or a supplier rate. `perLead` is null
 * when it worked on no lead.
 */
export const AgentSpendPerLeadDto = z
  .object({
    total: MoneySchema,
    runs: Count,
    leads: Count,
    perLead: MoneySchema.nullable(),
  })
  .strict();
export type AgentSpendPerLeadDto = z.infer<typeof AgentSpendPerLeadDto>;

/** Who handed a chat to people: the assistant's own rules or answer, or a person who took it. */
export const CONCIERGE_HANDOFF_BY = ['assistant', 'person'] as const;
export const ConciergeHandoffBySchema = z.enum(CONCIERGE_HANDOFF_BY);
export type ConciergeHandoffBy = z.infer<typeof ConciergeHandoffBySchema>;

/** The hand-offs of chats to people in the period for one reason and by one side. */
export const ConciergeHandoffCountDto = z
  .object({ reason: WhatsAppHandoffReasonSchema, by: ConciergeHandoffBySchema, count: Count })
  .strict();
export type ConciergeHandoffCountDto = z.infer<typeof ConciergeHandoffCountDto>;

/** The longest review sample, in pairs. */
export const SHADOW_SAMPLE_SIZE = 50;

const Day = z.iso.date();

/** `agents.concierge.sample`, `agents.copilot.sample`: one company's sample of a period. */
export const ShadowSampleInput = z
  .object({ entityId: EntityIdSchema, from: Day, to: Day })
  .strict()
  .refine((i) => i.from <= i.to, { path: ['to'], message: 'period_reversed' })
  .refine(
    (i) => Date.parse(i.to) - Date.parse(i.from) <= (SHADOW_REPORT_MAX_DAYS - 1) * 86_400_000,
    { path: ['from'], message: 'period_too_long' },
  );
export type ShadowSampleInput = z.infer<typeof ShadowSampleInput>;

/** What became of a proposal: recorded in Shadow, waiting, or a person's decision. */
export const SHADOW_SAMPLE_STATES = [
  'shadowed',
  'waiting',
  'approved',
  'edited',
  'rejected',
  'dismissed',
  'executed',
] as const;
export const ShadowSampleStateSchema = z.enum(SHADOW_SAMPLE_STATES);
export type ShadowSampleState = z.infer<typeof ShadowSampleStateSchema>;

export const SHADOW_SAMPLE_AGREEMENTS = ['agree', 'edited', 'disagree', 'open'] as const;
export const ShadowSampleAgreementSchema = z.enum(SHADOW_SAMPLE_AGREEMENTS);
export type ShadowSampleAgreement = z.infer<typeof ShadowSampleAgreementSchema>;

/** The qualification facts a sample shows: the numbers, never a consumer number. */
export const SampleFactsSchema = LeadQualificationFactsSchema.omit({ discomConsumerNo: true });
export type SampleFacts = z.infer<typeof SampleFactsSchema>;

/** The agent's proposal, by what it proposes. */
export const ShadowSampleDraftDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reply'), text: z.string() }).strict(),
  z.object({ kind: z.literal('facts'), facts: SampleFactsSchema }).strict(),
  z
    .object({
      kind: z.literal('task'),
      taskKind: z.string(),
      dueAt: z.iso.datetime().nullable(),
      title: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('template'),
      templateName: z.string(),
      templateLabel: z.string().nullable(),
      occasion: z.string().nullable(),
    })
    .strict(),
]);
export type ShadowSampleDraftDto = z.infer<typeof ShadowSampleDraftDto>;

/** What people sent or did, beside the proposal; null when nothing yet. */
export const ShadowSampleDidDto = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('message'),
      /** The words a person sent, masked as stored; null for a template. */
      body: z.string().nullable(),
      templateLabel: z.string().nullable(),
      at: z.iso.datetime(),
      /** Sent from this draft (approved as written or edited). */
      fromDraft: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal('facts'), facts: SampleFactsSchema }).strict(),
  z
    .object({
      kind: z.literal('task'),
      taskKind: z.string(),
      dueAt: z.iso.datetime(),
      title: z.string().nullable(),
      at: z.iso.datetime(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('template'),
      templateLabel: z.string().nullable(),
      at: z.iso.datetime(),
    })
    .strict(),
]);
export type ShadowSampleDidDto = z.infer<typeof ShadowSampleDidDto>;

/** One pair: the proposal beside what people did. */
export const ShadowSampleItemDto = z
  .object({
    actionId: IdSchema,
    actionType: z.string(),
    createdAt: z.iso.datetime(),
    opportunityId: IdSchema.nullable(),
    accountId: IdSchema.nullable(),
    customerName: z.string().nullable(),
    /** The customer's message a reply answered, masked as stored; null for a file or another type. */
    asked: z.string().nullable(),
    draft: ShadowSampleDraftDto,
    did: ShadowSampleDidDto.nullable(),
    state: ShadowSampleStateSchema,
    agreement: ShadowSampleAgreementSchema,
  })
  .strict();
export type ShadowSampleItemDto = z.infer<typeof ShadowSampleItemDto>;

/**
 * The review sample of one agent, company and period: at most 50 of its proposals, spread evenly
 * over the period in time order (the same period always gives the same pairs while no proposal is
 * added to it), oldest first. Every proposal kept passed the output filter: a refused answer keeps
 * only its reason, so the refusals come as counts.
 */
export const ShadowSampleDto = z
  .object({
    entityId: EntityIdSchema,
    from: Day,
    to: Day,
    /** The agent's proposals in the period of the kinds sampled, of which `items` is the set. */
    proposals: Count,
    /** Whether the agreement compares with what people did (the viewer reads the audit trail). */
    compared: z.boolean(),
    items: z.array(ShadowSampleItemDto).max(SHADOW_SAMPLE_SIZE),
    filtered: z.array(AgentRefusalCountDto.extend({ actionType: z.string() }).strict()),
  })
  .strict();
export type ShadowSampleDto = z.infer<typeof ShadowSampleDto>;
