import {
  CompleteMilestoneInput,
  DomainError,
  ProjectDto,
  ProjectReasonInput,
  ProjectRefInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { milestoneFacts, readMilestones, readProject } from '../../queries/projects/project-dto';
import { transition } from '../../state-machines/define-machine';
import { projectStandardMachine } from '../../state-machines/machines/project-standard';
import {
  lockProject,
  personActor,
  projectRecordOf,
  requireStandardFlow,
  writeProject,
  type ProjectRow,
} from './project-shared';

/**
 * The project's own moves through the `project_standard` machine (docs/03-roadmap-appendix/
 * phase4.md §6.1, PRD PRJ-01): a step done in order, hold and resume, complete and cancel. Each
 * locks the project as the caller may write it, refuses a PM Surya Ghar project (J4 drives it),
 * fires the machine as the caller, writes the state and its reason, records the change and emits
 * the machine's event. People only: no agent moves a project in Phase 4.
 */

const MILESTONE_AUDIT_FIELDS = ['milestoneKey', 'milestoneState'] as const;

/** The documents the step still needs, by requirement key (`app.project_missing_documents()`). */
async function missingDocuments(
  ctx: CommandContext,
  projectId: string,
  key: string,
): Promise<string[]> {
  const rows = (await ctx.tx.execute(
    sql`select missing from app.project_missing_documents(${projectId}::uuid, ${key}) as missing`,
  )) as unknown as { missing: string }[];
  return rows.map((r) => r.missing);
}

/**
 * `projects.milestone.complete`: the next open step of the checklist, once every mandatory
 * document it requires is filed (the guard `documents_missing`, which names what is missing). A
 * Field Engineer completes the steps of a project they are on.
 */
export const completeMilestone = defineCommand({
  name: 'projects.milestone.complete',
  permission: 'projects.write',
  minScope: 'own',
  peopleOnly: true,
  input: CompleteMilestoneInput,
  output: ProjectDto,
  auditFields: [...MILESTONE_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockProject(ctx, input.entityId, input.projectId);
    requireStandardFlow(row);
    const steps = await readMilestones(ctx.tx, row.id);
    const step = steps.find((m) => m.key === input.milestoneKey);
    if (!step) {
      throw new DomainError('not_found', 'step not found', { reason: 'milestone_missing' });
    }
    const missing = await missingDocuments(ctx, row.id, step.key);
    try {
      transition(
        projectStandardMachine,
        projectRecordOf(
          row,
          milestoneFacts(steps, { key: step.key, documentsComplete: missing.length === 0 }),
        ),
        'milestone.complete',
        { actor: personActor(ctx), now: ctx.now, params: { milestoneCode: step.key } },
      );
    } catch (error) {
      if (error instanceof DomainError && error.details?.reason === 'documents_missing') {
        throw new DomainError(error.code, error.message, { ...error.details, missing });
      }
      throw error;
    }
    const m = schema.projectMilestones;
    const done = await ctx.tx
      .update(m)
      .set({ state: 'done', doneAt: ctx.now, doneBy: ctx.principal.id })
      .where(and(eq(m.id, step.id), eq(m.state, 'open')))
      .returning({ id: m.id });
    if (done.length !== 1) {
      throw new DomainError('conflict', 'the step changed', { reason: 'milestone_out_of_order' });
    }
    // The project shows as changed in the list's order by its last change.
    await writeProject(ctx, row, {});
    ctx.audit({
      aggregateType: 'project_milestone',
      aggregateId: step.id,
      entityId: row.entityId,
      before: { milestoneKey: step.key, milestoneState: step.state },
      after: { milestoneKey: step.key, milestoneState: 'done' },
    });
    ctx.emit({
      type: 'projects.project.milestone_completed',
      entityId: row.entityId,
      aggregateType: 'project',
      aggregateId: row.id,
      payload: { accountId: row.accountId, milestoneId: step.id },
    });
    return readProject(ctx.tx, row.entityId, row.id);
  },
});

const MOVE_AUDIT_FIELDS = ['projectState', 'holdReason', 'cancelReason'] as const;

type MoveEvent = 'hold' | 'resume' | 'complete' | 'cancel';

const EMITS: Record<MoveEvent, 'projects.project.held' | 'projects.project.completed' | 'projects.project.cancelled' | null> = {
  hold: 'projects.project.held',
  resume: null,
  complete: 'projects.project.completed',
  cancel: 'projects.project.cancelled',
};

/** Fires a whole-project event and writes the new state with its reason. */
async function moveProject(
  ctx: CommandContext,
  input: { entityId: number; projectId: string; reason?: string },
  event: MoveEvent,
): Promise<ProjectDto> {
  const row: ProjectRow = await lockProject(ctx, input.entityId, input.projectId);
  requireStandardFlow(row);
  const steps = event === 'complete' ? await readMilestones(ctx.tx, row.id) : [];
  const moved = transition(
    projectStandardMachine,
    projectRecordOf(row, milestoneFacts(steps)),
    event,
    { actor: personActor(ctx), now: ctx.now, params: { reason: input.reason ?? null } },
  );
  const holdReason = event === 'hold' ? (input.reason ?? null) : null;
  const cancelReason = event === 'cancel' ? (input.reason ?? null) : null;
  await writeProject(ctx, row, {
    state: moved.to,
    stateChangedAt: ctx.now,
    holdReason,
    cancelReason,
  });
  ctx.audit({
    aggregateType: 'project',
    aggregateId: row.id,
    entityId: row.entityId,
    before: { projectState: row.state, holdReason: row.holdReason, cancelReason: row.cancelReason },
    after: { projectState: moved.to, holdReason, cancelReason },
  });
  const type = EMITS[event];
  if (type !== null) {
    ctx.emit({
      type,
      entityId: row.entityId,
      aggregateType: 'project',
      aggregateId: row.id,
      payload: { accountId: row.accountId },
    });
  }
  return readProject(ctx.tx, row.entityId, row.id);
}

/** `projects.project.hold`: an active project waits, with the reason (a Project Manager's call). */
export const holdProject = defineCommand({
  name: 'projects.project.hold',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ProjectReasonInput,
  output: ProjectDto,
  auditFields: [...MOVE_AUDIT_FIELDS],
  handler: (ctx, input) => moveProject(ctx, input, 'hold'),
});

/** `projects.project.resume`: a project on hold goes on; its hold reason is cleared. */
export const resumeProject = defineCommand({
  name: 'projects.project.resume',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ProjectRefInput,
  output: ProjectDto,
  auditFields: [...MOVE_AUDIT_FIELDS],
  handler: (ctx, input) => moveProject(ctx, input, 'resume'),
});

/**
 * `projects.project.complete`: an active project with every step done. The handover kit and the
 * warranty per serial come with J11.
 */
export const completeProject = defineCommand({
  name: 'projects.project.complete',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ProjectRefInput,
  output: ProjectDto,
  auditFields: [...MOVE_AUDIT_FIELDS],
  handler: (ctx, input) => moveProject(ctx, input, 'complete'),
});

/**
 * `projects.project.cancel`: an active or held project ends, with the reason; its order may then
 * have a new project made by hand.
 */
export const cancelProject = defineCommand({
  name: 'projects.project.cancel',
  permission: 'projects.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ProjectReasonInput,
  output: ProjectDto,
  auditFields: [...MOVE_AUDIT_FIELDS],
  handler: (ctx, input) => moveProject(ctx, input, 'cancel'),
});
