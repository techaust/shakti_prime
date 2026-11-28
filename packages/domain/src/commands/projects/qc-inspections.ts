import {
  DomainError,
  newId,
  ProjectSegmentSchema,
  QcInspectionDto,
  QcInspectionStateSchema,
  RejectQcInput,
  SignoffQcInput,
  SubmitQcInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { answersFillChecklist, photoIdsOf } from '../../projects/qc-answers';
import { readMilestones } from '../../queries/projects/project-dto';
import { newestChecklist, toInspectionDto } from '../../queries/projects/qc-read';
import { transition } from '../../state-machines/define-machine';
import { qcInspectionMachine } from '../../state-machines/machines/qc-inspection';
import { requireEntity } from '../crm/opportunity-shared';
import { lockProject, personActor } from './project-shared';

/**
 * A project's quality checks (docs/03-roadmap-appendix/phase4.md §7.3, the QC step of PRD PRJ-02),
 * through the `qc_inspection` machine: filled and submitted by whoever writes the project, then
 * signed off or turned down by a holder of `projects.qc.signoff` who did not submit it. A step
 * with a checklist is marked done only once one of its inspections is signed off. People only;
 * the answers stay out of the audit row and the event, which name the step.
 */

/** Every key a QC command's audit row records besides ids (`apps/web/src/screens/audit.ts`). */
const QC_AUDIT_FIELDS = [
  'milestoneKey',
  'inspectionState',
  'checklistVersion',
  'qcRejectReason',
] as const;

type InspectionRow = typeof schema.qcInspections.$inferSelect;

/**
 * The photos the answers name: each a ready `qc_photo` the caller uploaded in the project's
 * company that no other inspection names; otherwise `qc_photo_missing`.
 */
async function assertPhotos(
  ctx: CommandContext,
  entityId: number,
  photoIds: readonly string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  const f = schema.files;
  const found = await ctx.tx
    .select({ id: f.id })
    .from(f)
    .where(
      and(
        inArray(f.id, [...photoIds]),
        eq(f.entityId, entityId),
        eq(f.purpose, 'qc_photo'),
        eq(f.status, 'ready'),
        isNull(f.deletedAt),
        eq(f.createdBy, ctx.principal.id),
        sql`not exists (select 1 from qc_inspections i where ${f.id} = any (i.photo_file_ids))`,
      ),
    );
  if (found.length !== photoIds.length) {
    throw new DomainError('validation_failed', 'a photo is not a ready quality-check photo', {
      reason: 'qc_photo_missing',
    });
  }
}

/** `projects.qc.submit`: a project's filled checklist for its open step. */
export const submitQc = defineCommand({
  name: 'projects.qc.submit',
  permission: 'projects.write',
  minScope: 'own',
  peopleOnly: true,
  input: SubmitQcInput,
  output: QcInspectionDto,
  auditFields: [...QC_AUDIT_FIELDS],
  constraintReasons: { qc_inspections_milestone_live_unique: 'qc_already_submitted' },
  async handler(ctx, input) {
    const project = await lockProject(ctx, input.entityId, input.projectId);
    if (project.state !== 'active') {
      throw new DomainError('conflict', 'the project is not in progress', {
        reason: 'qc_project_not_active',
      });
    }
    const step = (await readMilestones(ctx.tx, project.id)).find(
      (m) => m.key === input.milestoneKey,
    );
    if (!step) {
      throw new DomainError('not_found', 'step not found', { reason: 'milestone_missing' });
    }
    if (step.state !== 'open') {
      throw new DomainError('conflict', 'the step is closed', { reason: 'qc_step_closed' });
    }
    const checklist = await newestChecklist(
      ctx.tx,
      project.entityId,
      ProjectSegmentSchema.parse(project.segment),
      step.key,
    );
    if (checklist === null || checklist.items.length === 0) {
      throw new DomainError('conflict', 'the step has no checklist', { reason: 'qc_no_checklist' });
    }
    if (checklist.id !== input.checklistId) {
      throw new DomainError('conflict', 'a newer checklist was published', {
        reason: 'qc_checklist_changed',
      });
    }
    transition(
      qcInspectionMachine,
      {
        state: null,
        submittedBy: null,
        answersComplete: answersFillChecklist(checklist.items, input.answers),
      },
      'submit',
      { actor: personActor(ctx), now: ctx.now, params: {} },
    );
    const photos = photoIdsOf(input.answers);
    await assertPhotos(ctx, project.entityId, photos);
    // In the checklist's order, as the screens show them.
    const order = new Map(checklist.items.map((item, i) => [item.key, i]));
    const answers = [...input.answers].sort(
      (a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
    );
    const [row] = await ctx.tx
      .insert(schema.qcInspections)
      .values({
        id: newId(),
        entityId: project.entityId,
        projectId: project.id,
        milestoneId: step.id,
        checklistId: checklist.id,
        answersJson: answers,
        photoFileIds: photos,
        submittedAt: ctx.now,
        submittedBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'the inspection insert returned no row');
    ctx.audit({
      aggregateType: 'qc_inspection',
      aggregateId: row.id,
      entityId: row.entityId,
      before: null,
      after: {
        milestoneKey: step.key,
        inspectionState: 'submitted',
        checklistVersion: checklist.version,
      },
    });
    ctx.emit({
      type: 'projects.qc.submitted',
      entityId: row.entityId,
      aggregateType: 'qc_inspection',
      aggregateId: row.id,
      payload: { projectId: row.projectId, milestoneId: row.milestoneId },
    });
    return toInspectionDto(ctx.tx, row);
  },
});

/**
 * The inspection as the caller reads it: one of another company, or of a project the caller does
 * not read, is not found. The decision's update takes it only while it still waits.
 */
async function readInspection(
  ctx: CommandContext,
  entityId: number,
  inspectionId: string,
): Promise<InspectionRow> {
  requireEntity(ctx, entityId);
  const i = schema.qcInspections;
  const [row] = await ctx.tx
    .select()
    .from(i)
    .where(and(eq(i.id, inspectionId), eq(i.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', 'quality check not found', {
      reason: 'qc_inspection_missing',
    });
  }
  return row;
}

/** Signs off or turns down a waiting inspection, as the caller, through the machine. */
async function decide(
  ctx: CommandContext,
  input: { entityId: number; inspectionId: string; reason?: string },
  event: 'signoff' | 'reject',
): Promise<InspectionRow> {
  const row = await readInspection(ctx, input.entityId, input.inspectionId);
  const moved = transition(
    qcInspectionMachine,
    {
      state: QcInspectionStateSchema.parse(row.state),
      submittedBy: row.submittedBy,
      answersComplete: true,
    },
    event,
    { actor: personActor(ctx), now: ctx.now, params: { reason: input.reason ?? null } },
  );
  const rejectReason = event === 'reject' ? (input.reason ?? null) : null;
  const i = schema.qcInspections;
  const [after] = await ctx.tx
    .update(i)
    .set({ state: moved.to, decidedAt: ctx.now, decidedBy: ctx.principal.id, rejectReason })
    .where(and(eq(i.id, row.id), eq(i.state, 'submitted')))
    .returning();
  if (!after) {
    throw new DomainError('conflict', 'the quality check changed', {
      reason: 'concurrent_change',
    });
  }
  const [step] = await ctx.tx
    .select({ key: schema.projectMilestones.key })
    .from(schema.projectMilestones)
    .where(eq(schema.projectMilestones.id, row.milestoneId))
    .limit(1);
  ctx.audit({
    aggregateType: 'qc_inspection',
    aggregateId: row.id,
    entityId: row.entityId,
    before: { milestoneKey: step?.key ?? null, inspectionState: row.state },
    after: {
      milestoneKey: step?.key ?? null,
      inspectionState: moved.to,
      qcRejectReason: rejectReason,
    },
  });
  return after;
}

/** `projects.qc.signoff`: a waiting inspection signed off by someone who did not submit it. */
export const signoffQc = defineCommand({
  name: 'projects.qc.signoff',
  permission: 'projects.qc.signoff',
  minScope: 'entity',
  peopleOnly: true,
  input: SignoffQcInput,
  output: QcInspectionDto,
  auditFields: [...QC_AUDIT_FIELDS],
  constraintReasons: { qc_inspections_signer_check: 'qc_signer_is_submitter' },
  async handler(ctx, input) {
    const row = await decide(ctx, input, 'signoff');
    ctx.emit({
      type: 'projects.qc.signed_off',
      entityId: row.entityId,
      aggregateType: 'qc_inspection',
      aggregateId: row.id,
      payload: { projectId: row.projectId, milestoneId: row.milestoneId },
    });
    return toInspectionDto(ctx.tx, row);
  },
});

/** `projects.qc.reject`: a waiting inspection turned down with what to put right. */
export const rejectQc = defineCommand({
  name: 'projects.qc.reject',
  permission: 'projects.qc.signoff',
  minScope: 'entity',
  peopleOnly: true,
  input: RejectQcInput,
  output: QcInspectionDto,
  auditFields: [...QC_AUDIT_FIELDS],
  constraintReasons: { qc_inspections_signer_check: 'qc_signer_is_submitter' },
  async handler(ctx, input) {
    const row = await decide(ctx, input, 'reject');
    ctx.emit({
      type: 'projects.qc.rejected',
      entityId: row.entityId,
      aggregateType: 'qc_inspection',
      aggregateId: row.id,
      payload: { projectId: row.projectId, milestoneId: row.milestoneId },
    });
    return toInspectionDto(ctx.tx, row);
  },
});
