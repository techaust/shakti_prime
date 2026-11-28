import { DomainError, ProjectStateSchema } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import type { Actor } from '../../state-machines/define-machine';
import type {
  MilestoneFact,
  ProjectStandardRecord,
} from '../../state-machines/machines/project-standard';
import { requireEntity } from '../crm/opportunity-shared';

export type ProjectRow = typeof schema.projects.$inferSelect;

/** Every key a project command's audit row records besides ids (`apps/web/src/screens/audit.ts`). */
export const PROJECT_AUDIT_FIELDS = [
  'projectNo',
  'projectState',
  'segment',
  'scheme',
  'flow',
  'templateVersionId',
  'milestones',
  'holdReason',
  'cancelReason',
] as const;

/**
 * The project, locked for this transaction, as the caller may write it: one of another company,
 * one the caller cannot read, or one they read but may not write (`projects.write` for the
 * company, or one they are on) is not found.
 */
export async function lockProject(
  ctx: CommandContext,
  entityId: number,
  projectId: string,
): Promise<ProjectRow> {
  requireEntity(ctx, entityId);
  const p = schema.projects;
  const [row] = await ctx.tx
    .select()
    .from(p)
    .where(and(eq(p.id, projectId), eq(p.entityId, entityId)))
    .limit(1)
    .for('update');
  if (!row) throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  return row;
}

/**
 * The `project_standard` machine drives the standard flow only: a PM Surya Ghar project's steps
 * and gates come with the subsidy flow (J4), so its commands refuse it.
 */
export function requireStandardFlow(row: ProjectRow): void {
  if (row.flow !== 'standard') {
    throw new DomainError('conflict', 'a Surya Ghar project follows the subsidy flow', {
      reason: 'project_subsidy_flow',
    });
  }
}

/** The project as the machine reads it. */
export function projectRecordOf(
  row: ProjectRow,
  milestones: readonly MilestoneFact[] = [],
): ProjectStandardRecord {
  return { state: ProjectStateSchema.parse(row.state), milestones };
}

/** The actor a person's command fires the machine as. */
export function personActor(ctx: CommandContext): Actor {
  return { kind: 'principal', principal: ctx.principal };
}

/**
 * Writes the project's new values as the caller, under the update policy; a row the policy
 * refuses is not found.
 */
export async function writeProject(
  ctx: CommandContext,
  row: ProjectRow,
  values: Partial<
    Pick<ProjectRow, 'state' | 'stateChangedAt' | 'ownerId' | 'holdReason' | 'cancelReason'>
  >,
): Promise<void> {
  const done = await ctx.tx
    .update(schema.projects)
    .set({ ...values, updatedBy: ctx.principal.id })
    .where(eq(schema.projects.id, row.id))
    .returning({ id: schema.projects.id });
  if (done.length !== 1) {
    throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  }
}
