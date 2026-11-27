import { AssignProjectInput, DomainError, newId, ProjectDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readProject } from '../../queries/projects/project-dto';
import { lockProject, writeProject } from './project-shared';

/**
 * `projects.project.assign` (docs/03-roadmap-appendix/phase4.md §5): who runs the project (its
 * owner, the Project Manager) and the people on it, each a person with a role in the project's
 * company. The list replaces the one before. What a Field Engineer's or a Lead Converter's `own`
 * scope reads follows from it (`app.project_is_mine()`). For the company's Project Manager or
 * General Manager (`projects.write` for the company); people only.
 */
export const assignProject = defineCommand({
  name: 'projects.project.assign',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: AssignProjectInput,
  output: ProjectDto,
  auditFields: ['ownerId', 'assigneeIds'],
  async handler(ctx, input) {
    const row = await lockProject(ctx, input.entityId, input.projectId);
    const people = [...new Set([...(input.ownerId === null ? [] : [input.ownerId]), ...input.assigneeIds])];
    if (people.length > 0) {
      const r = schema.userEntityRoles;
      const found = await ctx.tx
        .selectDistinct({ userId: r.userId })
        .from(r)
        .where(and(eq(r.entityId, row.entityId), inArray(r.userId, people)));
      if (found.length !== people.length) {
        throw new DomainError('validation_failed', 'a person outside the company', {
          reason: 'project_person_outside',
        });
      }
    }
    const a = schema.projectAssignments;
    const before = (
      await ctx.tx.select({ personId: a.personId }).from(a).where(eq(a.projectId, row.id))
    ).map((x) => x.personId);
    const leaving = before.filter((id) => !input.assigneeIds.includes(id));
    const joining = input.assigneeIds.filter((id) => !before.includes(id));
    if (leaving.length > 0) {
      await ctx.tx.delete(a).where(and(eq(a.projectId, row.id), inArray(a.personId, leaving)));
    }
    if (joining.length > 0) {
      await ctx.tx.insert(a).values(
        joining.map((personId) => ({
          id: newId(),
          entityId: row.entityId,
          projectId: row.id,
          personId,
          createdBy: ctx.principal.id,
        })),
      );
    }
    if (row.ownerId !== input.ownerId || leaving.length > 0 || joining.length > 0) {
      await writeProject(ctx, row, { ownerId: input.ownerId });
      ctx.audit({
        aggregateType: 'project',
        aggregateId: row.id,
        entityId: row.entityId,
        before: { ownerId: row.ownerId, assigneeIds: [...before].sort() },
        after: { ownerId: input.ownerId, assigneeIds: [...input.assigneeIds].sort() },
      });
    }
    return readProject(ctx.tx, row.entityId, row.id);
  },
});
