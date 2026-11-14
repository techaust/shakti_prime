import {
  DomainError,
  newId,
  RegisterWhatsAppTemplateInput,
  WhatsAppTemplateButtonSchema,
  WhatsAppTemplateCategorySchema,
  WhatsAppTemplateDto,
  WhatsAppTemplateParamSchema,
  WhatsAppTemplatePurposeSchema,
  WhatsAppTemplateStatusSchema,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

type TemplateRow = typeof schema.whatsappTemplates.$inferSelect;

/** The template as the screens and the composer show it. */
export function toTemplateDto(row: TemplateRow): WhatsAppTemplateDto {
  return WhatsAppTemplateDto.parse({
    id: row.id,
    entityId: row.entityId,
    name: row.name,
    language: row.language,
    category: WhatsAppTemplateCategorySchema.parse(row.category),
    status: WhatsAppTemplateStatusSchema.parse(row.status),
    params: z.array(WhatsAppTemplateParamSchema).parse(row.params),
    buttons: z.array(WhatsAppTemplateButtonSchema).parse(row.buttons),
    purpose: row.purpose === null ? null : WhatsAppTemplatePurposeSchema.parse(row.purpose),
  });
}

/** What the audit row shows of a template: what it is called, its kind and what it is for. */
function audited(row: Pick<TemplateRow, 'name' | 'category' | 'purpose'>) {
  return { templateName: row.name, templateCategory: row.category, templatePurpose: row.purpose };
}

/**
 * `messaging.template.register` (docs/03-roadmap-appendix/phase2.md §6.1): an Executive records a
 * template of the company as it was submitted to Meta: its name and language, its category, what
 * each body value stands for and its buttons, and whether the platform sends it itself (the
 * welcome, the confirmation of a STOP; one of each per company, taking no body values). The same
 * name and language again updates it in place. Its status is never written here: a new template
 * waits as `pending` until Meta's template event, which only the platform records. People only;
 * `messaging.templates.write` for the whole group, which the policies check.
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
    if (input.purpose !== null && input.params.length > 0) {
      throw new DomainError('validation_failed', 'a template the platform sends takes no values', {
        reason: 'whatsapp_template_purpose_values',
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
      const [row] = await ctx.tx
        .update(w)
        .set({
          category: input.category,
          params: input.params,
          buttons: input.buttons,
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
        language: input.language,
        category: input.category,
        params: input.params,
        buttons: input.buttons,
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
