import { z } from 'zod';
import { AgentFilterReasonSchema } from './agents';
import { EntityIdSchema, IdSchema } from './ids';

// The WhatsApp Concierge's screens (docs/03-roadmap-appendix/phase2.md §7.2, A3): the draft line in
// a chat, where the lead's owner sends, edits or discards the assistant's reply under Needs
// approval, and its shadow report on Admin › Agents, every draft beside what a person sent.

/** `agents.concierge.draft`: the chat whose open draft the viewer may decide. */
export const ConciergeDraftInput = z
  .object({ entityId: EntityIdSchema, threadId: IdSchema })
  .strict();
export type ConciergeDraftInput = z.infer<typeof ConciergeDraftInput>;

/**
 * The assistant's newest undecided reply on the chat in the viewer's own Agent Inbox, or none: its
 * inbox item (which the decision names), the words and when it was drafted.
 */
export const ConciergeDraftDto = z
  .object({
    draft: z
      .object({
        itemId: IdSchema,
        body: z.string(),
        createdAt: z.iso.datetime(),
        /**
         * Whether the viewer sends, edits or discards it from the chat (Needs approval); under
         * Suggest it is only shown, and decided in the Agent Inbox.
         */
        decidable: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ConciergeDraftDto = z.infer<typeof ConciergeDraftDto>;

/**
 * What became of a draft: recorded in Shadow, waiting for its person, sent as written or edited,
 * or discarded.
 */
export const CONCIERGE_DRAFT_STATES = [
  'shadowed',
  'waiting',
  'sent',
  'edited',
  'discarded',
] as const;
export const ConciergeDraftStateSchema = z.enum(CONCIERGE_DRAFT_STATES);
export type ConciergeDraftState = z.infer<typeof ConciergeDraftStateSchema>;

/** One draft beside the customer's message it answered and what a person sent after it. */
export const ConciergeReportItemDto = z
  .object({
    actionId: IdSchema,
    createdAt: z.iso.datetime(),
    accountId: IdSchema,
    customerName: z.string().nullable(),
    /** The customer's message the draft answered, masked as stored; null for a file. */
    asked: z.string().nullable(),
    draft: z.string(),
    state: ConciergeDraftStateSchema,
    /**
     * The first message a person sent on the chat after the draft and before the customer wrote
     * again: its words, or a template's label.
     */
    sent: z
      .object({
        body: z.string().nullable(),
        templateLabel: z.string().nullable(),
        at: z.iso.datetime(),
        /** Sent from this draft (approved as written or edited). */
        fromDraft: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ConciergeReportItemDto = z.infer<typeof ConciergeReportItemDto>;

/**
 * The Concierge's shadow report (design §7.2, PRD AI-04): one company's drafts in a period, newest
 * first, each beside what a person sent; how many there were and how they ended; the runs the
 * output filter refused by reason; and its proposals by action type and how they ended.
 */
export const ConciergeReportDto = z
  .object({
    entityId: EntityIdSchema,
    from: z.iso.date(),
    to: z.iso.date(),
    drafts: z
      .object({
        total: z.number().int().min(0),
        shadowed: z.number().int().min(0),
        waiting: z.number().int().min(0),
        sent: z.number().int().min(0),
        edited: z.number().int().min(0),
        discarded: z.number().int().min(0),
        /** Drafts after which a person sent something to the customer. */
        answered: z.number().int().min(0),
      })
      .strict(),
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
    items: z.array(ConciergeReportItemDto),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type ConciergeReportDto = z.infer<typeof ConciergeReportDto>;
