import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../../ids';

/**
 * The WhatsApp Concierge's proposals (docs/03-roadmap-appendix/phase2.md §7.2, A3). The agent
 * proposes; a person decides. Its action types are the commands they run: an in-window reply
 * (`messaging.reply.send`), the lead's qualification facts (`crm.lead.qualification.set`) and a
 * callback for the lead's owner (`crm.task.create`). A handoff is not an action: the worker hands
 * the thread to people through the platform's hand-off.
 */
export const CONCIERGE_ACTION_TYPES = {
  reply: 'messaging.reply.send',
  qualification: 'crm.lead.qualification.set',
  callback: 'crm.task.create',
} as const;

export const CONCIERGE_PROPOSAL_KINDS = ['reply', 'qualification', 'callback'] as const;
export type ConciergeProposalKind = (typeof CONCIERGE_PROPOSAL_KINDS)[number];

/** The longest reply the Concierge may draft (§7.2's output filter). */
export const CONCIERGE_REPLY_MAX = 600;

export const ConciergeReplyBodySchema = z.string().trim().min(1).max(CONCIERGE_REPLY_MAX);

/**
 * A reply as the Concierge proposes it: the thread, its customer (the inbox item's subject) and the
 * words. Strict, so a proposal can never name the draft it would be marked with.
 */
export const ConciergeReplyProposalInput = z
  .object({
    entityId: EntityIdSchema,
    threadId: IdSchema,
    accountId: IdSchema,
    body: ConciergeReplyBodySchema,
  })
  .strict();
export type ConciergeReplyProposalInput = z.input<typeof ConciergeReplyProposalInput>;

/**
 * `messaging.reply.send`: the person who approves the Concierge's draft sends it, as written or as
 * they edited it, in the customer's 24-hour window; the message is marked as drafted by the
 * assistant. `draftedByAgentActionId` is the draft's action, filled in by the approval itself.
 */
export const SendWhatsAppReplyInput = ConciergeReplyProposalInput.extend({
  draftedByAgentActionId: IdSchema,
}).strict();
export type SendWhatsAppReplyInput = z.input<typeof SendWhatsAppReplyInput>;
