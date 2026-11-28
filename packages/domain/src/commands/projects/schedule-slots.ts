import {
  CancelSlotInput,
  ConfirmSlotInput,
  DomainError,
  DoneSlotInput,
  MoveSlotInput,
  newId,
  ProposeSlotInput,
  ScheduleSlotDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { transition } from '../../state-machines/define-machine';
import { scheduleSlotMachine } from '../../state-machines/machines/schedule-slot';
import { requireEntity } from '../crm/opportunity-shared';
import {
  checkVisit,
  lockSlot,
  overrideFor,
  SLOT_AUDIT_FIELDS,
  slotActor,
  slotAudit,
  slotDto,
  slotState,
  writeSlot,
} from './schedule-shared';

/**
 * The visits of the scheduling board through the `schedule_slot` machine (J5,
 * docs/03-roadmap-appendix/phase4.md §7.2, PRD PRJ-04). Before every save that sets a time or
 * the people (propose, confirm, move) the conflicts are named by `findScheduleConflicts()`; a
 * person saves over them only with a reason, audited with them. A scheduler or the Orchestrator
 * proposes; every later step is a person's (`peopleOnly`, and the database's guard).
 */

/**
 * `projects.slot.propose`: a visit to an open step of a project in progress, by an engineer of
 * the company or one of its crews. Nothing is booked until a person confirms it.
 */
export const proposeSlot = defineCommand({
  name: 'projects.slot.propose',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  input: ProposeSlotInput,
  output: ScheduleSlotDto,
  auditFields: [...SLOT_AUDIT_FIELDS],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    transition(scheduleSlotMachine, { state: null, startsAt: null }, 'propose', {
      actor: slotActor(ctx),
      now: ctx.now,
      params: { startsAt },
    });
    const p = schema.projects;
    const m = schema.projectMilestones;
    const [step] = await ctx.tx
      .select({ projectState: p.state, milestoneState: m.state })
      .from(m)
      .innerJoin(p, eq(p.id, m.projectId))
      .where(
        and(
          eq(m.id, input.milestoneId),
          eq(m.projectId, input.projectId),
          eq(p.entityId, input.entityId),
        ),
      )
      .limit(1);
    if (!step) {
      throw new DomainError('not_found', 'step not found', { reason: 'milestone_missing' });
    }
    if (step.projectState !== 'active') {
      throw new DomainError('conflict', 'the project is not in progress', {
        reason: 'slot_project_not_active',
      });
    }
    if (step.milestoneState !== 'open') {
      throw new DomainError('conflict', 'the step is closed', { reason: 'slot_step_closed' });
    }
    const id = newId();
    const { conflicts, travelMin } = await checkVisit(ctx, {
      slotId: id,
      entityId: input.entityId,
      projectId: input.projectId,
      engineerId: input.engineerId,
      crewId: input.crewId,
      startsAt,
      endsAt,
    });
    const overrideReason = overrideFor(ctx, conflicts, input.overrideReason);
    const [row] = await ctx.tx
      .insert(schema.scheduleSlots)
      .values({
        id,
        entityId: input.entityId,
        projectId: input.projectId,
        milestoneId: input.milestoneId,
        engineerId: input.engineerId,
        crewId: input.crewId,
        startsAt,
        endsAt,
        travelMin,
        state: 'proposed',
        stateChangedAt: ctx.now,
        proposedBy: ctx.principal.id,
        overrideReason,
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', 'visit insert returned no row');
    ctx.audit({
      aggregateType: 'schedule_slot',
      aggregateId: row.id,
      entityId: row.entityId,
      after: {
        ...slotAudit(row, conflicts),
        projectId: row.projectId,
        milestoneId: row.milestoneId,
      },
    });
    return slotDto(row, conflicts);
  },
});

/**
 * `projects.slot.confirm`: a person books a proposed visit, its conflicts checked again as they
 * stand now (another visit may have been booked since it was proposed). People only (PRJ-04).
 */
export const confirmSlot = defineCommand({
  name: 'projects.slot.confirm',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ConfirmSlotInput,
  output: ScheduleSlotDto,
  auditFields: [...SLOT_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockSlot(ctx, input.entityId, input.slotId);
    const moved = transition(
      scheduleSlotMachine,
      { state: slotState(row), startsAt: row.startsAt },
      'confirm',
      { actor: slotActor(ctx), now: ctx.now, params: {} },
    );
    const { conflicts } = await checkVisit(ctx, { ...row, slotId: row.id });
    const overrideReason = overrideFor(ctx, conflicts, input.overrideReason);
    const written = await writeSlot(ctx, row, {
      state: moved.to,
      stateChangedAt: ctx.now,
      confirmedAt: ctx.now,
      confirmedBy: ctx.principal.id,
      overrideReason: overrideReason ?? row.overrideReason,
    });
    ctx.audit({
      aggregateType: 'schedule_slot',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { slotState: row.state },
      after: {
        slotState: written.state,
        ...(conflicts.length === 0 ? {} : { overrideReason, conflicts }),
      },
    });
    return slotDto(written, conflicts);
  },
});

/**
 * `projects.slot.move`: a proposed or confirmed visit to another time, engineer or crew, as the
 * board's drag and drop or its keyboard moves it. It keeps its state. People only.
 */
export const moveSlot = defineCommand({
  name: 'projects.slot.move',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: MoveSlotInput,
  output: ScheduleSlotDto,
  auditFields: [...SLOT_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockSlot(ctx, input.entityId, input.slotId);
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    const moved = transition(
      scheduleSlotMachine,
      { state: slotState(row), startsAt: row.startsAt },
      'move',
      { actor: slotActor(ctx), now: ctx.now, params: { startsAt } },
    );
    const { conflicts, travelMin } = await checkVisit(ctx, {
      slotId: row.id,
      entityId: row.entityId,
      projectId: row.projectId,
      engineerId: input.engineerId,
      crewId: input.crewId,
      startsAt,
      endsAt,
    });
    const overrideReason = overrideFor(ctx, conflicts, input.overrideReason);
    const written = await writeSlot(ctx, row, {
      state: moved.to,
      engineerId: input.engineerId,
      crewId: input.crewId,
      startsAt,
      endsAt,
      travelMin,
      overrideReason,
    });
    ctx.audit({
      aggregateType: 'schedule_slot',
      aggregateId: row.id,
      entityId: row.entityId,
      before: slotAudit(row),
      after: slotAudit(written, conflicts),
    });
    return slotDto(written, conflicts);
  },
});

/** `projects.slot.cancel`: a visit not done, with the person's reason. People only. */
export const cancelSlot = defineCommand({
  name: 'projects.slot.cancel',
  permission: 'projects.schedule.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CancelSlotInput,
  output: ScheduleSlotDto,
  auditFields: [...SLOT_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockSlot(ctx, input.entityId, input.slotId);
    const moved = transition(
      scheduleSlotMachine,
      { state: slotState(row), startsAt: row.startsAt },
      'cancel',
      { actor: slotActor(ctx), now: ctx.now, params: { reason: input.reason } },
    );
    const written = await writeSlot(ctx, row, {
      state: moved.to,
      stateChangedAt: ctx.now,
      cancelReason: input.reason,
    });
    ctx.audit({
      aggregateType: 'schedule_slot',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { slotState: row.state },
      after: { slotState: written.state, cancelReason: written.cancelReason },
    });
    return slotDto(written);
  },
});

/**
 * `projects.slot.done`: the record that a confirmed visit took place, once it has started, by the
 * person on it (its engineer or a member of its crew, with `projects.write`) or a scheduler, with
 * a note. It completes no step: `projects.milestone.complete` stays the only way. People only.
 */
export const doneSlot = defineCommand({
  name: 'projects.slot.done',
  permission: 'projects.write',
  minScope: 'own',
  peopleOnly: true,
  input: DoneSlotInput,
  output: ScheduleSlotDto,
  auditFields: [...SLOT_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockSlot(ctx, input.entityId, input.slotId);
    const moved = transition(
      scheduleSlotMachine,
      { state: slotState(row), startsAt: row.startsAt },
      'done',
      { actor: slotActor(ctx), now: ctx.now, params: {} },
    );
    const written = await writeSlot(ctx, row, {
      state: moved.to,
      stateChangedAt: ctx.now,
      doneAt: ctx.now,
      doneBy: ctx.principal.id,
      doneNote: input.note,
    });
    ctx.audit({
      aggregateType: 'schedule_slot',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { slotState: row.state },
      after: { slotState: written.state, doneNote: written.doneNote },
    });
    return slotDto(written);
  },
});
