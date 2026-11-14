import {
  DomainError,
  HandOffWhatsAppThreadInput,
  ReturnWhatsAppThreadInput,
  WhatsAppThreadDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';
import { auditedHandler, readThread, threadOptedOut, toThreadDto } from './shared';

/**
 * `messaging.thread.hand_off` (docs/03-roadmap-appendix/phase2.md §6.1): a person takes a thread
 * over from the assistant, with the reason (the customer asked for a person, or a complaint), so
 * people answer it from now on. People only; `messaging.send` over the thread's customer or lead,
 * which the update policy checks (a thread the caller may read but not message is not found). A
 * thread already with people stays as it is.
 */
export const handOffWhatsAppThread = defineCommand({
  name: 'messaging.thread.hand_off',
  permission: 'messaging.send',
  minScope: 'own',
  peopleOnly: true,
  input: HandOffWhatsAppThreadInput,
  output: WhatsAppThreadDto,
  auditFields: ['handledBy', 'handoffReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const before = await readThread(ctx, input, true);
    if (before.handledBy === 'people') {
      return toThreadDto(before, await threadOptedOut(ctx, before.id));
    }
    const t = schema.whatsappThreads;
    const [row] = await ctx.tx
      .update(t)
      .set({
        handledBy: 'people',
        handoffReason: input.reason,
        handedOffAt: ctx.now,
        updatedBy: ctx.principal.id,
      })
      .where(eq(t.id, before.id))
      .returning();
    if (!row) throw new DomainError('forbidden', `thread ${before.id} is outside the scope`);
    ctx.audit({
      aggregateType: 'whatsapp_thread',
      aggregateId: row.id,
      entityId: row.entityId,
      before: auditedHandler(before),
      after: auditedHandler(row),
    });
    return toThreadDto(row, await threadOptedOut(ctx, row.id));
  },
});

/**
 * `messaging.thread.return_to_assistant`: a person gives a thread back to the assistant, which
 * answers it again. People only, on the same terms as the hand-off; a thread already with the
 * assistant stays as it is.
 */
export const returnWhatsAppThread = defineCommand({
  name: 'messaging.thread.return_to_assistant',
  permission: 'messaging.send',
  minScope: 'own',
  peopleOnly: true,
  input: ReturnWhatsAppThreadInput,
  output: WhatsAppThreadDto,
  auditFields: ['handledBy', 'handoffReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const before = await readThread(ctx, input, true);
    if (before.handledBy === 'assistant') {
      return toThreadDto(before, await threadOptedOut(ctx, before.id));
    }
    const t = schema.whatsappThreads;
    const [row] = await ctx.tx
      .update(t)
      .set({
        handledBy: 'assistant',
        handoffReason: null,
        handedOffAt: null,
        updatedBy: ctx.principal.id,
      })
      .where(eq(t.id, before.id))
      .returning();
    if (!row) throw new DomainError('forbidden', `thread ${before.id} is outside the scope`);
    ctx.audit({
      aggregateType: 'whatsapp_thread',
      aggregateId: row.id,
      entityId: row.entityId,
      before: auditedHandler(before),
      after: auditedHandler(row),
    });
    return toThreadDto(row, await threadOptedOut(ctx, row.id));
  },
});
