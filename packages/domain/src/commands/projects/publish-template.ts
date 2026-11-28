import {
  DomainError,
  newId,
  ProjectStepsSchema,
  ProjectTemplateDto,
  PublishProjectTemplateInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, max } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * `projects.template.publish` (docs/03-roadmap-appendix/phase4.md §6.1, question 2 (a)): an
 * Executive publishes a new version of one company's checklist for a segment, the next number
 * after the newest. It is current for every project made from then on; a running project keeps the
 * version it copied, and no published version changes. For the Executive (`projects.write` for
 * every company); people only.
 */
export const publishProjectTemplate = defineCommand({
  name: 'projects.template.publish',
  permission: 'projects.write',
  minScope: 'all',
  peopleOnly: true,
  input: PublishProjectTemplateInput,
  output: ProjectTemplateDto,
  auditFields: ['segment', 'version', 'steps'],
  constraintReasons: { project_flow_templates_version_unique: 'project_template_changed' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const t = schema.projectFlowTemplates;
    const [newest] = await ctx.tx
      .select({ version: max(t.version) })
      .from(t)
      .where(and(eq(t.entityId, input.entityId), eq(t.segment, input.segment)));
    const steps = ProjectStepsSchema.parse(input.steps);
    const [row] = await ctx.tx
      .insert(t)
      .values({
        id: newId(),
        entityId: input.entityId,
        segment: input.segment,
        version: (newest?.version ?? 0) + 1,
        stepsJson: steps,
        publishedAt: ctx.now,
        publishedBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'the template insert returned no row');
    ctx.audit({
      aggregateType: 'project_flow_template',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: { segment: row.segment, version: row.version, steps: steps.map((s) => s.key) },
    });
    return ProjectTemplateDto.parse({
      id: row.id,
      entityId: row.entityId,
      segment: row.segment,
      version: row.version,
      steps,
      publishedAt: row.publishedAt.toISOString(),
      publishedBy: row.publishedBy,
    });
  },
});
