import {
  ChecklistDto,
  ChecklistItemsSchema,
  QcAnswerSchema,
  QcInspectionDto,
  type ProjectSegment,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

/**
 * The readers the QC commands and the QC tab share (J6, docs/03-roadmap-appendix/phase4.md
 * §7.3): a checklist and an inspection as their DTOs, read as the caller under row security.
 */

type ChecklistRow = typeof schema.checklists.$inferSelect;
type InspectionRow = typeof schema.qcInspections.$inferSelect;

const AnswersSchema = z.array(QcAnswerSchema);

export function toChecklistDto(row: ChecklistRow): ChecklistDto {
  return ChecklistDto.parse({
    id: row.id,
    entityId: row.entityId,
    segment: row.segment,
    stepKey: row.stepKey,
    version: row.version,
    items: ChecklistItemsSchema.parse(row.itemsJson),
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: row.publishedBy,
  });
}

/** The newest checklist of a company and segment for a step, or none. */
export async function newestChecklist(
  tx: RequestTx,
  entityId: number,
  segment: ProjectSegment,
  stepKey: string,
): Promise<ChecklistDto | null> {
  const c = schema.checklists;
  const [row] = await tx
    .select()
    .from(c)
    .where(and(eq(c.entityId, entityId), eq(c.segment, segment), eq(c.stepKey, stepKey)))
    .orderBy(desc(c.version))
    .limit(1);
  return row === undefined ? null : toChecklistDto(row);
}

/** Inspections as their DTOs, each with the checklist version it was filled on. */
export async function toInspectionDtos(
  tx: RequestTx,
  rows: readonly InspectionRow[],
): Promise<QcInspectionDto[]> {
  if (rows.length === 0) return [];
  const c = schema.checklists;
  const lists = await tx
    .select()
    .from(c)
    .where(inArray(c.id, [...new Set(rows.map((r) => r.checklistId))]));
  const byId = new Map(lists.map((l) => [l.id, l]));
  return rows.map((row) => {
    const list = byId.get(row.checklistId);
    return QcInspectionDto.parse({
      id: row.id,
      entityId: row.entityId,
      projectId: row.projectId,
      milestoneId: row.milestoneId,
      checklistId: row.checklistId,
      checklistVersion: list?.version,
      items: ChecklistItemsSchema.parse(list?.itemsJson),
      state: row.state,
      answers: AnswersSchema.parse(row.answersJson),
      submittedAt: row.submittedAt.toISOString(),
      submittedBy: row.submittedBy,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedBy,
      rejectReason: row.rejectReason,
    });
  });
}

/** One inspection as its DTO. */
export async function toInspectionDto(
  tx: RequestTx,
  row: InspectionRow,
): Promise<QcInspectionDto> {
  const [dto] = await toInspectionDtos(tx, [row]);
  if (dto === undefined) throw new Error('unreachable');
  return dto;
}
