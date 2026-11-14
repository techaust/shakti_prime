import {
  DomainError,
  newId,
  SendWhatsAppMessageInput,
  WhatsAppMessageDto,
  type MessageRequested,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { maskMessageText, readThread, threadOptedOut } from './shared';

/**
 * `messaging.message.send` (docs/03-roadmap-appendix/phase2.md §6.1, PRD WA-04): a person queues a
 * WhatsApp message on a thread they may message (`messaging.send` over the thread's customer or
 * lead, which the insert policy checks): free text while the customer's 24-hour window is open, or
 * a registered, approved template of the thread's company with one value for each of its body
 * values. The text and values are masked before they are stored (`maskMessageText()`). A number
 * that opted out is refused here, by the table's guard, and again by the messaging worker before
 * it sends; the worker also checks the window and the template once more, since either can change
 * while the message waits. The message is sent by the worker, never here: the command writes the
 * queued row and `messaging.message.requested`, and the thread no longer waits for a reply.
 */
export const sendWhatsAppMessage = defineCommand({
  name: 'messaging.message.send',
  permission: 'messaging.send',
  minScope: 'own',
  input: SendWhatsAppMessageInput,
  output: WhatsAppMessageDto,
  auditFields: ['messageKind', 'templateName'],
  // The customer's text never reaches the audit row: which thread, and which template.
  auditInput: (input) => ({
    threadId: input.threadId,
    kind: input.kind,
    templateName: input.kind === 'template' ? input.templateName : null,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const thread = await readThread(ctx, input, true);
    if (await threadOptedOut(ctx, thread.id)) {
      throw new DomainError('conflict', `thread ${thread.id} has opted out`, {
        reason: 'whatsapp_opted_out',
      });
    }

    let templateName: string | null = null;
    let templateParams: string[] | null = null;
    let body: string | null = null;
    if (input.kind === 'text') {
      if (thread.windowOpenUntil === null || thread.windowOpenUntil <= ctx.now) {
        throw new DomainError('conflict', `the window of thread ${thread.id} is closed`, {
          reason: 'whatsapp_window_closed',
        });
      }
      body = maskMessageText(input.body);
    } else {
      const w = schema.whatsappTemplates;
      const [template] = await ctx.tx
        .select({ status: w.status, params: w.params, purpose: w.purpose })
        .from(w)
        .where(
          and(
            eq(w.entityId, thread.entityId),
            eq(w.name, input.templateName),
            eq(w.language, 'en'),
          ),
        )
        .limit(1);
      // A template the platform sends for a purpose is not offered to people.
      if (template?.purpose !== null) {
        throw new DomainError('not_found', `template ${input.templateName} is not registered`, {
          reason: 'whatsapp_template_missing',
        });
      }
      if (template.status !== 'approved') {
        throw new DomainError('conflict', `template ${input.templateName} is not approved`, {
          reason: 'whatsapp_template_not_approved',
        });
      }
      const expected = Array.isArray(template.params) ? template.params.length : 0;
      if (input.params.length !== expected) {
        throw new DomainError('validation_failed', 'the template takes another number of values', {
          reason: 'whatsapp_template_values',
        });
      }
      templateName = input.templateName;
      templateParams = input.params.map(maskMessageText);
    }

    const id = newId();
    const kind: 'text' | 'template' = input.kind === 'text' ? 'text' : 'template';
    await ctx.tx.insert(schema.whatsappMessages).values({
      id,
      entityId: thread.entityId,
      threadId: thread.id,
      direction: 'outbound',
      kind,
      templateName,
      templateParams,
      bodyMasked: body,
      status: 'queued',
      sentBy: ctx.principal.id,
      createdAt: ctx.now,
    });
    if (thread.needsReply) {
      const t = schema.whatsappThreads;
      await ctx.tx
        .update(t)
        .set({ needsReply: false, updatedBy: ctx.principal.id })
        .where(eq(t.id, thread.id));
    }

    const payload: MessageRequested = { messageId: id, threadId: thread.id, kind };
    ctx.emit({
      type: 'messaging.message.requested',
      entityId: thread.entityId,
      aggregateType: 'whatsapp_thread',
      aggregateId: thread.id,
      payload,
    });
    ctx.audit({
      aggregateType: 'whatsapp_message',
      aggregateId: id,
      entityId: thread.entityId,
      after: { messageKind: kind, templateName },
    });
    return {
      id,
      threadId: thread.id,
      direction: 'outbound' as const,
      kind,
      templateName,
      templateParams,
      body,
      fileId: null,
      status: 'queued' as const,
      refusal: null,
      sentBy: ctx.principal.id,
      sentByName: null,
      createdAt: ctx.now.toISOString(),
      statusAt: null,
    };
  },
});
