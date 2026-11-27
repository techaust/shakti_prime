import { DomainError, ProjectDto } from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, eq } from 'drizzle-orm';
import type { MilestoneFact } from '../../state-machines/machines/project-standard';

type ProjectRow = typeof schema.projects.$inferSelect;
type MilestoneRow = typeof schema.projectMilestones.$inferSelect;

/** A project's steps in checklist order, as the caller reads them. */
export async function readMilestones(tx: RequestTx, projectId: string): Promise<MilestoneRow[]> {
  return tx
    .select()
    .from(schema.projectMilestones)
    .where(eq(schema.projectMilestones.projectId, projectId))
    .orderBy(asc(schema.projectMilestones.position));
}

/** The steps as the `project_standard` machine's guards read them. */
export function milestoneFacts(
  rows: readonly MilestoneRow[],
  complete?: { key: string; documentsComplete: boolean },
): MilestoneFact[] {
  return rows.map((m) => ({
    code: m.key,
    done: m.state !== 'open',
    documentsComplete: complete?.key === m.key ? complete.documentsComplete : true,
  }));
}

function requiresOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** One project as its DTO, from its row, its steps and the people on it. */
export function toProjectDto(
  row: ProjectRow,
  milestones: readonly MilestoneRow[],
  assigneeIds: readonly string[],
): ProjectDto {
  return ProjectDto.parse({
    id: row.id,
    entityId: row.entityId,
    projectNo: row.projectNo,
    salesOrderId: row.salesOrderId,
    accountId: row.accountId,
    siteId: row.siteId,
    segment: row.segment,
    scheme: row.scheme,
    flow: row.flow,
    templateVersionId: row.templateVersionId,
    state: row.state,
    stateChangedAt: row.stateChangedAt.toISOString(),
    ownerId: row.ownerId,
    holdReason: row.holdReason,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
    milestones: milestones.map((m) => ({
      id: m.id,
      position: m.position,
      key: m.key,
      title: m.title,
      state: m.state,
      requires: requiresOf(m.requires),
      doneAt: m.doneAt?.toISOString() ?? null,
      doneBy: m.doneBy,
    })),
    assigneeIds: [...assigneeIds].sort(),
  });
}

/**
 * A project of a company as the caller reads it (`projects.read` for the company, or one they are
 * on): not found otherwise.
 */
export async function readProject(
  tx: RequestTx,
  entityId: number,
  projectId: string,
): Promise<ProjectDto> {
  const p = schema.projects;
  const [row] = await tx
    .select()
    .from(p)
    .where(and(eq(p.id, projectId), eq(p.entityId, entityId)))
    .limit(1);
  if (!row) throw new DomainError('not_found', 'project not found', { reason: 'project_missing' });
  const a = schema.projectAssignments;
  const milestones = await readMilestones(tx, row.id);
  const people = await tx.select({ personId: a.personId }).from(a).where(eq(a.projectId, row.id));
  return toProjectDto(
    row,
    milestones,
    people.map((x) => x.personId),
  );
}
