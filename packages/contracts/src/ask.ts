import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './ids';

// Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, PRD AI-02): a person with
// `knowledge.ask` asks a question in plain words; the model reads the business through read-only
// tools run as that person, and the answer cites the records it read. Each conversation is the
// person's own: nobody else reads it, and it is removed 90 days after it was last used
// (`WORKSHOP_DEFAULTS.retention.askDays`).

/** The longest question a person may ask, in characters. */
export const ASK_QUESTION_MAX = 2000;
/** The longest answer kept, in characters; a longer one is cut at a sentence. */
export const ASK_ANSWER_MAX = 8000;
/** A conversation's title: its first question, masked and cut. */
export const ASK_TITLE_MAX = 120;
/** The most sources one answer may cite, and one turn's tools may return. */
export const ASK_CITED_MAX = 50;
export const ASK_RETURNED_MAX = 500;

/**
 * The records a tool returns for citation, each a link on the screen: a vault file, an approved
 * Playbook directive, a pipeline stage (its open leads), a lead, a quote, an order and a dealer
 * (its credit). Totals of a company (this month's sales, targets) cite nothing: their figures are
 * still checked against what the lookup returned.
 */
export const ASK_SOURCE_KINDS = [
  'knowledge_file',
  'playbook_directive',
  'pipeline_stage',
  'opportunity',
  'quote',
  'sales_order',
  'account',
] as const;
export const AskSourceKindSchema = z.enum(ASK_SOURCE_KINDS);
export type AskSourceKind = z.infer<typeof AskSourceKindSchema>;

export const AskSourceSchema = z.object({ kind: AskSourceKindSchema, id: IdSchema }).strict();
export type AskSource = z.infer<typeof AskSourceSchema>;

/**
 * How an answer came out of the grounding filter:
 * - `answered`: every citation is a returned record and every figure is in a tool's result;
 * - `unsourced`: some figures or citations could not be sourced and were taken out, and the
 *   answer says so;
 * - `no_answer`: the model gave nothing that could be shown (it declined, ran too long, or only
 *   asked for more lookups).
 */
export const ASK_OUTCOMES = ['answered', 'unsourced', 'no_answer'] as const;
export const AskOutcomeSchema = z.enum(ASK_OUTCOMES);
export type AskOutcome = z.infer<typeof AskOutcomeSchema>;

export const AskQuestionSchema = z.string().trim().min(1).max(ASK_QUESTION_MAX);

/**
 * A question from the person (the route and the screen): a new conversation, or a follow-up in
 * one of theirs. A new conversation covers the companies the person is viewing; a follow-up keeps
 * its conversation's companies.
 */
export const AskInput = z
  .object({ conversationId: IdSchema.nullable().default(null), question: AskQuestionSchema })
  .strict();
export type AskInput = z.input<typeof AskInput>;

/**
 * `knowledge.ask.record` (people only, `knowledge.ask`): one question and its filtered answer, in
 * a new conversation (`conversationId` names it, unknown so far) or a follow-up of the person's
 * own. Written only by `askTheBusiness()` after the grounding filter; `returned` holds what this
 * turn's tools returned, and every `cited` source must be one of them or one an earlier turn of the
 * conversation returned.
 */
export const RecordAskInput = z
  .object({
    conversationId: IdSchema,
    question: AskQuestionSchema,
    answer: z.string().max(ASK_ANSWER_MAX),
    outcome: AskOutcomeSchema,
    unsourced: z.number().int().min(0).max(1000),
    cited: z.array(AskSourceSchema).max(ASK_CITED_MAX),
    returned: z.array(AskSourceSchema).max(ASK_RETURNED_MAX),
    model: z.string().max(60).nullable(),
    costPaise: z.number().int().min(0).max(10_000_000),
  })
  .strict();
export type RecordAskInput = z.input<typeof RecordAskInput>;

/** One question and its answer as the person reads them back. */
export const AskMessageDto = z
  .object({
    id: IdSchema,
    conversationId: IdSchema,
    question: z.string(),
    answer: z.string(),
    outcome: AskOutcomeSchema,
    unsourced: z.number().int().min(0),
    cited: z.array(AskSourceSchema),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type AskMessageDto = z.infer<typeof AskMessageDto>;

/** A conversation in the person's list: its title, companies and when it was last used. */
export const AskConversationDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema.nullable(),
    entityIds: z.array(EntityIdSchema).min(1),
    title: z.string(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type AskConversationDto = z.infer<typeof AskConversationDto>;

/** What `knowledge.ask.record` answers: the conversation as it now stands, and the new message. */
export const AskTurnDto = z
  .object({ conversation: AskConversationDto, message: AskMessageDto })
  .strict();
export type AskTurnDto = z.infer<typeof AskTurnDto>;

/** `knowledge.ask.delete` (people only, `knowledge.ask`): one of the person's conversations. */
export const DeleteAskConversationInput = z.object({ conversationId: IdSchema }).strict();
export type DeleteAskConversationInput = z.input<typeof DeleteAskConversationInput>;

export const DeletedAskConversationDto = z.object({ conversationId: IdSchema }).strict();
export type DeletedAskConversationDto = z.infer<typeof DeletedAskConversationDto>;
