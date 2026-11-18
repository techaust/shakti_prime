import {
  DomainError,
  QueueWhatsAppAnswerInput,
  WhatsAppAnswerQueued,
  type MessageRequested,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { maskMessageText } from './shared';

/**
 * `messaging.answer.queue` (docs/03-roadmap-appendix/phase2.md §7.1): the platform answers a
 * customer on their chat, deterministically and never through a model, through
 * `app.whatsapp_queue_answer()`, which checks `messaging.process`: a text in the customer's
 * window (the STATUS list, an acceptance, a code that does not match), or the company's template
 * of an answering purpose, the one-time code (`acceptance_code`, stored with no value: the
 * messaging worker makes the code from the message's id as it sends it) or the answer on a quote
 * no longer open (`quote_expired`, with the quote's number). The text is masked as every outbound
 * text is. Nothing is queued when the company registered no template of the purpose, the chat's
 * number was removed or it opted out. A queued answer emits `messaging.message.requested`, so the
 * messaging worker checks it (window, template approval, filter, rate) before it sends. Delivery
 * bookkeeping: no audit row (the message is the record) and never the text in the audit input.
 */
export const queueWhatsAppAnswer = defineCommand({
  name: 'messaging.answer.queue',
  permission: 'messaging.process',
  minScope: 'entity',
  input: QueueWhatsAppAnswerInput,
  output: WhatsAppAnswerQueued,
  auditFields: [],
  auditWhen: 'changed',
  auditInput: (input) => ({ threadId: input.threadId, answer: input.answer.kind }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const answer = input.answer;
    let templateName: string | null = null;
    let params: string[] | null = null;
    if (answer.kind !== 'text') {
      const w = schema.whatsappTemplates;
      const [template] = await ctx.tx
        .select({ name: w.name })
        .from(w)
        .where(
          and(eq(w.entityId, input.entityId), eq(w.purpose, answer.kind), eq(w.language, 'en')),
        )
        .limit(1);
      if (!template) return { outcome: 'no_template' as const, messageId: null };
      templateName = template.name;
      params = answer.kind === 'quote_expired' ? [maskMessageText(answer.quoteNo)] : [];
    }
    const body = answer.kind === 'text' ? maskMessageText(answer.body) : null;
    const kind = answer.kind === 'text' ? 'text' : 'template';
    const rows = (await ctx.tx.execute(sql`
      select outcome, message_id
        from app.whatsapp_queue_answer(${input.threadId}::uuid, ${input.messageId}::uuid, ${kind},
                                       ${templateName},
                                       ${params === null ? null : JSON.stringify(params)}::jsonb,
                                       ${body})`)) as unknown as {
      outcome: 'queued' | 'no_number' | 'opted_out';
      message_id: string | null;
    }[];
    const row = rows[0];
    if (row === undefined) {
      throw new DomainError('not_found', `thread ${input.threadId} is not visible`, {
        reason: 'whatsapp_thread_missing',
      });
    }
    if (row.outcome === 'queued' && row.message_id !== null) {
      const payload: MessageRequested = {
        messageId: row.message_id,
        threadId: input.threadId,
        kind,
      };
      ctx.emit({
        type: 'messaging.message.requested',
        entityId: input.entityId,
        aggregateType: 'whatsapp_thread',
        aggregateId: input.threadId,
        payload,
      });
    }
    return { outcome: row.outcome, messageId: row.message_id };
  },
});
