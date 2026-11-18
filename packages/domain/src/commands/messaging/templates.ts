import {
  DomainError,
  newId,
  RegisterWhatsAppTemplateInput,
  WhatsAppTemplateButtonSchema,
  WhatsAppTemplateCategorySchema,
  WhatsAppTemplateDto,
  WhatsAppTemplateHeaderSchema,
  WhatsAppTemplateParamSchema,
  WhatsAppTemplatePurposeSchema,
  WhatsAppTemplateStatusSchema,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCommand } from '../../command/define-command';
import { purposeMisfit } from '../../messaging/template-shape';
import { requireEntity } from '../crm/opportunity-shared';

type TemplateRow = typeof schema.whatsappTemplates.$inferSelect;

/** The template as the screens and the composer show it. */
export function toTemplateDto(row: TemplateRow): WhatsAppTemplateDto {
  return WhatsAppTemplateDto.parse({
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    label: row.label,
    language: row.language,
    category: WhatsAppTemplateCategorySchema.parse(row.category),
    status: WhatsAppTemplateStatusSchema.parse(row.status),
    params: z.array(WhatsAppTemplateParamSchema).parse(row.params),
    buttons: z.array(WhatsAppTemplateButtonSchema).parse(row.buttons),
    header: WhatsAppTemplateHeaderSchema.parse(row.header),
    purpose: row.purpose === null ? null : WhatsAppTemplatePurposeSchema.parse(row.purpose),
  });
}

/** What the audit row shows of a template: what it is called, its kind and what it is for. */
function audited(row: Pick<TemplateRow, 'name' | 'category' | 'purpose'>) {
  return { templateName: row.name, templateCategory: row.category, templatePurpose: row.purpose };
}

/** Whether the input registers the template again as it stands, its label aside. */
function sameTemplate(
  current: TemplateRow,
  input: Pick<TemplateRow, 'category' | 'params' | 'buttons' | 'header' | 'purpose'>,
): boolean {
  return (
    current.category === input.category &&
    current.header === input.header &&
    current.purpose === input.purpose &&
    JSON.stringify(current.params) === JSON.stringify(input.params) &&
    JSON.stringify(current.buttons) === JSON.stringify(input.buttons)
  );
}

/**
 * `messaging.template.register` (docs/03-roadmap-appendix/phase2.md §6.1): an Executive records a
 * template of the company as it was submitted to Meta: its name and language, its category, what
 * each body value stands for, its buttons and what its header takes, and whether the platform
 * sends it itself (the welcome, the confirmation of a STOP, the acceptance code, the answer on an
 * expired quote; one of each per company, taking the values its purpose gives,
 * `WHATSAPP_PURPOSE_VALUES`, and the one-time code only as an authentication template with its
 * copy-code button, `WHATSAPP_PURPOSE_SHAPES`: `whatsapp_template_purpose_values` or
 * `whatsapp_template_purpose_shape` otherwise). The same name and language again updates it in
 * place, but a template an active milestone sends keeps everything except its label
 * (`whatsapp_template_mapped`): the milestone was mapped to it as it is. Its status is never
 * written here: a new template waits as `pending` until Meta's template event, which only the
 * platform records. People only; `messaging.templates.write` for the whole group, which the
 * policies check.
 */
export const registerWhatsAppTemplate = defineCommand({
  name: 'messaging.template.register',
  permission: 'messaging.templates.write',
  minScope: 'all',
  peopleOnly: true,
  input: RegisterWhatsAppTemplateInput,
  output: WhatsAppTemplateDto,
  auditFields: ['templateName', 'templateCategory', 'templatePurpose'],
  constraintReasons: {
    whatsapp_templates_purpose_unique: 'whatsapp_template_purpose_taken',
    whatsapp_templates_entity_name_unique: 'whatsapp_template_changed_meanwhile',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const misfit = input.purpose === null ? null : purposeMisfit(input.purpose, input);
    if (misfit === 'values') {
      throw new DomainError('validation_failed', 'a platform template takes its purpose’s values', {
        reason: 'whatsapp_template_purpose_values',
      });
    }
    if (misfit === 'shape') {
      throw new DomainError('validation_failed', 'a platform template has its purpose’s kind', {
        reason: 'whatsapp_template_purpose_shape',
      });
    }
    const w = schema.whatsappTemplates;
    const [current] = await ctx.tx
      .select()
      .from(w)
      .where(
        and(eq(w.entityId, input.entityId), eq(w.name, input.name), eq(w.language, input.language)),
      )
      .limit(1)
      .for('update');

    if (current) {
      if (!sameTemplate(current, input)) {
        const m = schema.whatsappMilestones;
        const [mapped] = await ctx.tx
          .select({ id: m.id })
          .from(m)
          .where(
            and(
              eq(m.entityId, current.entityId),
              eq(m.templateId, current.id),
              eq(m.isActive, true),
            ),
          )
          .limit(1);
        if (mapped) {
          throw new DomainError('conflict', 'a milestone sends this template as it is', {
            reason: 'whatsapp_template_mapped',
          });
        }
      }
      const [row] = await ctx.tx
        .update(w)
        .set({
          label: input.label,
          category: input.category,
          params: input.params,
          buttons: input.buttons,
          header: input.header,
          purpose: input.purpose,
          updatedBy: ctx.principal.id,
        })
        .where(eq(w.id, current.id))
        .returning();
      if (!row) throw new DomainError('forbidden', `template ${current.id} is outside the scope`);
      ctx.audit({
        aggregateType: 'whatsapp_template',
        aggregateId: row.id,
        entityId: row.entityId,
        before: audited(current),
        after: audited(row),
      });
      return toTemplateDto(row);
    }

    const [row] = await ctx.tx
      .insert(w)
      .values({
        id: newId(),
        entityId: input.entityId,
        name: input.name,
        label: input.label,
        language: input.language,
        category: input.category,
        params: input.params,
        buttons: input.buttons,
        header: input.header,
        purpose: input.purpose,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'template insert returned no row');
    ctx.audit({
      aggregateType: 'whatsapp_template',
      aggregateId: row.id,
      entityId: row.entityId,
      after: audited(row),
    });
    return toTemplateDto(row);
  },
});
