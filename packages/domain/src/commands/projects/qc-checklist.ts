import {
  ChecklistDto,
  ChecklistItemsSchema,
  DomainError,
  newId,
  PublishChecklistInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, max } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toChecklistDto } from '../../queries/projects/qc-read';
import { requireEntity } from '../crm/opportunity-shared';

/**
 * `projects.checklist.publish` (docs/03-roadmap-appendix/phase4.md §7.3): an Executive publishes a
 * new version of one company's quality checklist for a segment's step, the next number after the
 * newest. A new inspection is filled on it; one already submitted keeps the version it was filled
 * on, and no published version changes. An empty list takes the checklist off the step. For the
 * Executive (`projects.write` for every company); people only.
 */
export const publishChecklist = defineCommand({
  name: 'projects.checklist.publish',
  permission: 'projects.write',
  minScope: 'all',
  peopleOnly: true,
  input: PublishChecklistInput,
  output: ChecklistDto,
  auditFields: ['segment', 'stepKey', 'version', 'items'],
  constraintReasons: { checklists_version_unique: 'checklist_changed' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const c = schema.checklists;
    const [newest] = await ctx.tx
      .select({ version: max(c.version) })
      .from(c)
      .where(
        and(
          eq(c.entityId, input.entityId),
          eq(c.segment, input.segment),
          eq(c.stepKey, input.stepKey),
        ),
      );
    const items = ChecklistItemsSchema.parse(input.items);
    const [row] = await ctx.tx
      .insert(c)
      .values({
        id: newId(),
        entityId: input.entityId,
        segment: input.segment,
        stepKey: input.stepKey,
        version: (newest?.version ?? 0) + 1,
        itemsJson: items,
        publishedAt: ctx.now,
        publishedBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'the checklist insert returned no row');
    ctx.audit({
      aggregateType: 'checklist',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: {
        segment: row.segment,
        stepKey: row.stepKey,
        version: row.version,
        items: items.map((i) => i.key),
      },
    });
    return toChecklistDto(row);
  },
});
