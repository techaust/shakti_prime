import { DomainError, SendWhatsAppReplyInput, WhatsAppMessageDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { queueWhatsAppMessage } from './send-message';

/**
 * `messaging.reply.send` (docs/03-roadmap-appendix/phase2.md §7.2, A3): the Concierge's draft of
 * an in-window reply, sent by the person who approves it (`agents.inbox.approve` or `.edit`, which
 * fill in `draftedByAgentActionId` with the draft's own action). It queues the text through
 * `messaging.message.send`'s path, under that person's `messaging.send` and the same checks (the
 * window, the opt-out, the messaging worker's filter), and marks the message as drafted by the
 * assistant. The draft must be the Concierge's reply on this thread and still undecided, which
 * the person reads through their own inbox item, so no message is ever marked with a draft that
 * was not this one. Under Automatic (not before Phase 6) the agent itself would run it, and its own
 * scope writes no message.
 */
export const sendWhatsAppReply = defineCommand({
  name: 'messaging.reply.send',
  permission: 'messaging.send',
  minScope: 'own',
  input: SendWhatsAppReplyInput,
  output: WhatsAppMessageDto,
  auditFields: ['messageKind', 'draftedByAssistant'],
  // The customer's text never reaches the audit row: which thread, and which draft.
  auditInput: (input) => ({
    threadId: input.threadId,
    accountId: input.accountId,
    draftedByAgentActionId: input.draftedByAgentActionId,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const a = schema.agentActions;
    const [draft] = await ctx.tx
      .select({ inputJson: a.inputJson })
      .from(a)
      .where(
        and(
          eq(a.id, input.draftedByAgentActionId),
          eq(a.entityId, input.entityId),
          eq(a.agent, 'agent:concierge'),
          eq(a.actionType, 'messaging.reply.send'),
          eq(a.state, 'proposed'),
        ),
      )
      .limit(1);
    const drafted = draft?.inputJson as { threadId?: unknown; accountId?: unknown } | undefined;
    if (drafted?.threadId !== input.threadId || drafted.accountId !== input.accountId) {
      throw new DomainError('not_found', `no open draft ${input.draftedByAgentActionId}`, {
        reason: 'agent_draft_missing',
      });
    }
    const t = schema.whatsappThreads;
    const [thread] = await ctx.tx
      .select({ accountId: t.accountId })
      .from(t)
      .where(and(eq(t.id, input.threadId), eq(t.entityId, input.entityId)))
      .limit(1);
    if (thread !== undefined && thread.accountId !== input.accountId) {
      throw new DomainError('conflict', `thread ${input.threadId} has another customer now`, {
        reason: 'whatsapp_thread_moved',
      });
    }
    const message = await queueWhatsAppMessage(
      ctx,
      { entityId: input.entityId, threadId: input.threadId, kind: 'text', body: input.body },
      input.draftedByAgentActionId,
    );
    ctx.audit({
      aggregateType: 'whatsapp_message',
      aggregateId: message.id,
      entityId: input.entityId,
      after: { messageKind: message.kind, draftedByAssistant: true },
    });
    return message;
  },
});
