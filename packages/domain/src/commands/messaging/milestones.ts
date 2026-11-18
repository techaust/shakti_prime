import {
  DomainError,
  newId,
  SendWhatsAppMilestoneInput,
  SetWhatsAppMilestoneInput,
  WHATSAPP_MILESTONE_SUBJECT_OF,
  WhatsAppMilestoneDto,
  WhatsAppMilestoneOutcomeSchema,
  WhatsAppMilestoneSchema,
  WhatsAppMilestoneSent,
  WhatsAppTemplateButtonSchema,
  type MessageRequested,
} from '@shakti/contracts';
import { z } from 'zod';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { milestoneMisfit } from '../../messaging/template-shape';
import { requireEntity } from '../crm/opportunity-shared';
import { maskMessageText } from './shared';

type MilestoneRow = typeof schema.whatsappMilestones.$inferSelect;

function toMilestoneDto(row: MilestoneRow): WhatsAppMilestoneDto {
  return WhatsAppMilestoneDto.parse({
    id: row.id,
    entityId: row.entityId,
    milestone: WhatsAppMilestoneSchema.parse(row.milestone),
    templateId: row.templateId,
    isActive: row.isActive,
  });
}

/**
 * `messaging.milestone.set` (docs/03-roadmap-appendix/phase2.md §7.1, PRD WA-01): an Executive maps
 * a customer milestone of the company to one of its registered templates, or switches the
 * milestone off, in Settings › WhatsApp templates. The template must be the company's, a
 * template people or the milestones send (not one of the platform's own purposes, nor a one-time
 * code), taking exactly the values the milestone gives (`WHATSAPP_MILESTONE_VALUES`), with the
 * header and buttons the platform sends with it (`WHATSAPP_MILESTONE_SHAPES`: a quote's PDF and
 * its two reply buttons; nothing for an order's confirmation): otherwise
 * `whatsapp_template_missing`, `whatsapp_milestone_template_unfit`, `whatsapp_milestone_values` or
 * `whatsapp_milestone_template_shape`. The template is read under a share lock, so it cannot be
 * registered again differently while it is mapped (`messaging.template.register` then refuses).
 * One map per company and milestone, updated in place. A template not yet approved may be mapped:
 * the milestone is then held, not sent, until Meta approves it (WA-01). People only;
 * `messaging.templates.write` for the whole group, which the policies check.
 */
export const setWhatsAppMilestone = defineCommand({
  name: 'messaging.milestone.set',
  permission: 'messaging.templates.write',
  minScope: 'all',
  peopleOnly: true,
  input: SetWhatsAppMilestoneInput,
  output: WhatsAppMilestoneDto,
  auditFields: ['milestone', 'templateName', 'milestoneActive'],
  constraintReasons: {
    whatsapp_milestones_entity_milestone_unique: 'whatsapp_template_changed_meanwhile',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const w = schema.whatsappTemplates;
    const [template] = await ctx.tx
      .select({
        id: w.id,
        name: w.name,
        category: w.category,
        params: w.params,
        buttons: w.buttons,
        header: w.header,
        purpose: w.purpose,
      })
      .from(w)
      .where(and(eq(w.id, input.templateId), eq(w.entityId, input.entityId)))
      .limit(1)
      .for('share');
    if (!template) {
      throw new DomainError('not_found', `template ${input.templateId} is not registered`, {
        reason: 'whatsapp_template_missing',
      });
    }
    const misfit = milestoneMisfit(input.milestone, {
      category: template.category,
      params: Array.isArray(template.params) ? template.params : [],
      buttons: z.array(WhatsAppTemplateButtonSchema).parse(template.buttons),
      header: template.header,
      purpose: template.purpose,
    });
    if (misfit === 'unfit') {
      throw new DomainError('validation_failed', 'the template is not one a milestone sends', {
        reason: 'whatsapp_milestone_template_unfit',
      });
    }
    if (misfit === 'values') {
      throw new DomainError('validation_failed', 'the template takes other values', {
        reason: 'whatsapp_milestone_values',
      });
    }
    if (misfit === 'shape') {
      throw new DomainError('validation_failed', 'the template has other buttons or header', {
        reason: 'whatsapp_milestone_template_shape',
      });
    }

    const m = schema.whatsappMilestones;
    const [current] = await ctx.tx
      .select({ row: m, templateName: w.name })
      .from(m)
      .innerJoin(w, eq(w.id, m.templateId))
      .where(and(eq(m.entityId, input.entityId), eq(m.milestone, input.milestone)))
      .limit(1)
      .for('update', { of: m });
    const after = {
      milestone: input.milestone,
      templateName: template.name,
      milestoneActive: input.isActive,
    };
    if (current) {
      const [row] = await ctx.tx
        .update(m)
        .set({ templateId: template.id, isActive: input.isActive, updatedBy: ctx.principal.id })
        .where(eq(m.id, current.row.id))
        .returning();
      if (!row) throw new DomainError('forbidden', `milestone ${current.row.id} is outside scope`);
      ctx.audit({
        aggregateType: 'whatsapp_milestone',
        aggregateId: row.id,
        entityId: row.entityId,
        before: {
          milestone: input.milestone,
          templateName: current.templateName,
          milestoneActive: current.row.isActive,
        },
        after,
      });
      return toMilestoneDto(row);
    }
    const [row] = await ctx.tx
      .insert(m)
      .values({
        id: newId(),
        entityId: input.entityId,
        milestone: input.milestone,
        templateId: template.id,
        isActive: input.isActive,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'milestone insert returned no row');
    ctx.audit({
      aggregateType: 'whatsapp_milestone',
      aggregateId: row.id,
      entityId: row.entityId,
      after,
    });
    return toMilestoneDto(row);
  },
});

/**
 * `messaging.milestone.send` (docs/03-roadmap-appendix/phase2.md §7.1, PRD WA-01): the platform
 * sends a milestone of a quote or an order once, in English, from the company's number, through
 * `app.whatsapp_queue_milestone()`, which checks `messaging.process`: the company's active map
 * and its template, the subject at the milestone (a quote sent, an order confirmed), the once-per-
 * subject record, then the customer's chat (`threadId` when it is the customer's, else their chat
 * with the latest message), its opt-out and a WhatsApp consent. A template not yet approved holds
 * the milestone, recorded once and never sent. The values, made by the worker from
 * `app.whatsapp_milestone_subject()`, are masked as every outbound text is; a quote's message
 * carries its PDF. A queued message emits `messaging.message.requested` for the messaging worker,
 * which checks it again before it sends. Delivery bookkeeping: no audit row (the message and the
 * record are the trail).
 */
export const sendWhatsAppMilestone = defineCommand({
  name: 'messaging.milestone.send',
  permission: 'messaging.process',
  minScope: 'entity',
  input: SendWhatsAppMilestoneInput,
  output: WhatsAppMilestoneSent,
  auditFields: [],
  auditWhen: 'changed',
  // The values carry the customer's quote and amount, which the queued message keeps.
  auditInput: (input) => ({
    milestone: input.milestone,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (WHATSAPP_MILESTONE_SUBJECT_OF[input.milestone] !== input.subjectKind) {
      throw new DomainError('validation_failed', 'the milestone is of another kind of subject');
    }
    const values = input.values.map(maskMessageText);
    const rows = (await ctx.tx.execute(sql`
      select outcome, message_id, thread_id
        from app.whatsapp_queue_milestone(${input.entityId}::smallint, ${input.milestone},
                                          ${input.subjectKind}, ${input.subjectId}::uuid,
                                          ${input.threadId}::uuid,
                                          ${JSON.stringify(values)}::jsonb)`)) as unknown as {
      outcome: string;
      message_id: string | null;
      thread_id: string | null;
    }[];
    const row = rows[0];
    if (row === undefined) throw new DomainError('internal', 'the milestone answered nothing');
    const outcome = WhatsAppMilestoneOutcomeSchema.parse(row.outcome);
    if (outcome === 'queued' && row.message_id !== null && row.thread_id !== null) {
      const payload: MessageRequested = {
        messageId: row.message_id,
        threadId: row.thread_id,
        kind: 'template',
      };
      ctx.emit({
        type: 'messaging.message.requested',
        entityId: input.entityId,
        aggregateType: 'whatsapp_thread',
        aggregateId: row.thread_id,
        payload,
      });
    }
    return { outcome, messageId: row.message_id, threadId: row.thread_id };
  },
});
