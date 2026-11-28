import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';

/**
 * The field scheduling board (J5, docs/03-roadmap-appendix/phase4.md §7.2, PRD PRJ-04): crews,
 * visits to a project's step by an engineer or a crew, and the times a person is away. Each
 * list-valued check constraint of these tables is paired with one of these in `enum-sync.test.ts`.
 */

/** `schedule_slots.state`, as the `schedule_slot` machine moves it. */
export const ScheduleSlotStateSchema = z.enum(['proposed', 'confirmed', 'done', 'cancelled']);
export type ScheduleSlotState = z.infer<typeof ScheduleSlotStateSchema>;

/** `unavailability.kind`: leave (Phase 5's approved leave writes it too), training or other. */
export const UnavailabilityKindSchema = z.enum(['leave', 'training', 'other']);
export type UnavailabilityKind = z.infer<typeof UnavailabilityKindSchema>;

/**
 * What `findScheduleConflicts()` names: a person on two visits at once, a person away, or too
 * little time to travel between two visits of one person (question 6 (a)).
 */
export const ScheduleConflictKindSchema = z.enum(['double_booking', 'unavailable', 'travel_time']);
export type ScheduleConflictKind = z.infer<typeof ScheduleConflictKindSchema>;

/** The longest one visit lasts, in hours; a visit may cross midnight. */
export const SCHEDULE_SLOT_MAX_HOURS = 12;
/** The longest one stretch of unavailability, in days. */
export const UNAVAILABILITY_MAX_DAYS = 90;
/** The most people in one crew. */
export const CREW_MEMBERS_MAX = 20;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A reason a person gives in their own words. */
const ReasonSchema = z.string().trim().min(1).max(300);

/** One conflict, named: whose, with which visit or time away, and by how many minutes. */
export const ScheduleConflictDto = z
  .object({
    kind: ScheduleConflictKindSchema,
    personId: IdSchema,
    /** The other visit (`double_booking`, `travel_time`); null for time away. */
    slotId: IdSchema.nullable(),
    /** The time away (`unavailable`); null otherwise. */
    unavailabilityId: IdSchema.nullable(),
    unavailabilityKind: UnavailabilityKindSchema.nullable(),
    /** `travel_time`: the minutes the trip and the buffer need, and the minutes there are. */
    neededMin: z.number().int().min(0).nullable(),
    gapMin: z.number().int().min(0).nullable(),
  })
  .strict();
export type ScheduleConflictDto = z.infer<typeof ScheduleConflictDto>;

/** Who does a visit: one engineer or one crew, never both. */
const assignee = {
  engineerId: IdSchema.nullable().default(null),
  crewId: IdSchema.nullable().default(null),
};

/** When a visit is: a start before its end, at most `SCHEDULE_SLOT_MAX_HOURS` long. */
const when = { startsAt: z.iso.datetime(), endsAt: z.iso.datetime() };

/** Why a visit is saved over its conflicts, in the person's words; null when there are none. */
const override = { overrideReason: ReasonSchema.nullable().default(null) };

function checkVisit(
  v: { engineerId: string | null; crewId: string | null; startsAt: string; endsAt: string },
  ctx: z.RefinementCtx,
): void {
  if ((v.engineerId === null) === (v.crewId === null)) {
    ctx.addIssue({ code: 'custom', path: ['engineerId'], message: 'slot_assignee_required' });
  }
  const length = Date.parse(v.endsAt) - Date.parse(v.startsAt);
  if (!(length > 0) || length > SCHEDULE_SLOT_MAX_HOURS * HOUR_MS) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'slot_time_invalid' });
  }
}

/**
 * `projects.slot.propose`: a visit to a project's step, by an engineer or a crew. A person or the
 * Orchestrator proposes; nothing is booked until a person confirms (PRJ-04).
 */
export const ProposeSlotInput = z
  .object({
    entityId: EntityIdSchema,
    projectId: IdSchema,
    milestoneId: IdSchema,
    ...assignee,
    ...when,
    ...override,
  })
  .strict()
  .superRefine(checkVisit);
export type ProposeSlotInput = z.input<typeof ProposeSlotInput>;

/** `projects.slot.confirm`: a proposed visit, checked again for conflicts as it is confirmed. */
export const ConfirmSlotInput = z
  .object({ entityId: EntityIdSchema, slotId: IdSchema, ...override })
  .strict();
export type ConfirmSlotInput = z.input<typeof ConfirmSlotInput>;

/** `projects.slot.move`: a visit to another time, engineer or crew (drag and drop, or the keys). */
export const MoveSlotInput = z
  .object({ entityId: EntityIdSchema, slotId: IdSchema, ...assignee, ...when, ...override })
  .strict()
  .superRefine(checkVisit);
export type MoveSlotInput = z.input<typeof MoveSlotInput>;

/** `projects.slot.cancel`: a visit not done, and why. */
export const CancelSlotInput = z
  .object({ entityId: EntityIdSchema, slotId: IdSchema, reason: ReasonSchema })
  .strict();
export type CancelSlotInput = z.input<typeof CancelSlotInput>;

/**
 * `projects.slot.done`: the person's record that the visit took place, with a note. The step's own
 * completion stays `projects.milestone.complete`.
 */
export const DoneSlotInput = z
  .object({
    entityId: EntityIdSchema,
    slotId: IdSchema,
    note: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .strict();
export type DoneSlotInput = z.input<typeof DoneSlotInput>;

export const ScheduleSlotDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    projectId: IdSchema,
    milestoneId: IdSchema,
    engineerId: IdSchema.nullable(),
    crewId: IdSchema.nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    /** Minutes of travel from the visit before, when both places are known. */
    travelMin: z.number().int().min(0).nullable(),
    state: ScheduleSlotStateSchema,
    proposedBy: IdSchema,
    confirmedAt: z.iso.datetime().nullable(),
    confirmedBy: IdSchema.nullable(),
    doneAt: z.iso.datetime().nullable(),
    doneBy: IdSchema.nullable(),
    doneNote: z.string().nullable(),
    cancelReason: z.string().nullable(),
    /** Why the visit was last saved over its conflicts, when it was. */
    overrideReason: z.string().nullable(),
    /** The conflicts the save went over (none unless `overrideReason` is set). */
    conflicts: z.array(ScheduleConflictDto),
  })
  .strict();
export type ScheduleSlotDto = z.infer<typeof ScheduleSlotDto>;

/**
 * `projects.crew.save`: a new crew (`crewId` null) or a change to one: its name, its lead and its
 * members, each a person of the company, the lead among them; `archived` takes it off the board.
 */
export const SaveCrewInput = z
  .object({
    entityId: EntityIdSchema,
    crewId: IdSchema.nullable().default(null),
    name: z.string().trim().min(1).max(60),
    leadId: IdSchema,
    memberIds: z
      .array(IdSchema)
      .min(1)
      .max(CREW_MEMBERS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'each person once' }),
    archived: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.memberIds.includes(v.leadId)) {
      ctx.addIssue({ code: 'custom', path: ['leadId'], message: 'crew_lead_not_member' });
    }
  });
export type SaveCrewInput = z.input<typeof SaveCrewInput>;

export const CrewDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    name: z.string(),
    leadId: IdSchema,
    memberIds: z.array(IdSchema),
    archivedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type CrewDto = z.infer<typeof CrewDto>;

/** `projects.unavailability.record`: a person away from a start to an end, and why. */
export const RecordUnavailabilityInput = z
  .object({
    entityId: EntityIdSchema,
    personId: IdSchema,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    kind: UnavailabilityKindSchema,
    note: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    const length = Date.parse(v.endsAt) - Date.parse(v.startsAt);
    if (!(length > 0) || length > UNAVAILABILITY_MAX_DAYS * DAY_MS) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'unavailability_time_invalid' });
    }
  });
export type RecordUnavailabilityInput = z.input<typeof RecordUnavailabilityInput>;

/** `projects.unavailability.remove`: a time away recorded in error, or cut short. */
export const RemoveUnavailabilityInput = z
  .object({ entityId: EntityIdSchema, unavailabilityId: IdSchema })
  .strict();
export type RemoveUnavailabilityInput = z.input<typeof RemoveUnavailabilityInput>;

export const UnavailabilityDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    personId: IdSchema,
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    kind: UnavailabilityKindSchema,
    note: z.string().nullable(),
    createdBy: IdSchema,
    createdAt: z.iso.datetime(),
  })
  .strict();
export type UnavailabilityDto = z.infer<typeof UnavailabilityDto>;
