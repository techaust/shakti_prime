import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorsRequired, archivable, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { projectMilestones, projects } from './projects';

/**
 * A crew of one company (docs/03-roadmap-appendix/phase4.md §7.2, §14): a name, a lead and its
 * members (`crew_members`), booked on a visit as one. Archived, it leaves the board; it is never
 * deleted, since its visits name it.
 */
export const crews = pgTable(
  'crews',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    name: text('name').notNull(),
    leadId: uuid('lead_id')
      .notNull()
      .references(() => principals.id),
    ...archivable,
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    // The key the members and visits point at, so they stay in the crew's company.
    unique('crews_id_entity_unique').on(t.id, t.entityId),
    uniqueIndex('crews_entity_name_unique')
      .on(t.entityId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} is null`),
    check('crews_name_check', sql`length(${t.name}) between 1 and 60`),
  ],
);

/** The people of a crew, each a person of the crew's company. */
export const crewMembers = pgTable(
  'crew_members',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    crewId: uuid('crew_id').notNull(),
    personId: uuid('person_id')
      .notNull()
      .references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'crew_members_crew_fk',
      columns: [t.crewId, t.entityId],
      foreignColumns: [crews.id, crews.entityId],
    }).onDelete('cascade'),
    unique('crew_members_person_unique').on(t.crewId, t.personId),
    // The crews a person is in: the conflict check's and the `own` read's probe.
    index('crew_members_person_idx').on(t.personId, t.crewId),
  ],
);

/**
 * A visit to a project's step (docs/03-roadmap-appendix/phase4.md §7.2, PRD PRJ-04) by one
 * engineer or one crew, from a start to an end. Proposed by a person or the Orchestrator, booked
 * only when a person confirms it (the `schedule_slot` machine). Conflicts are named by
 * `findScheduleConflicts()` before every save, never by the database: a visit saved over them
 * carries the person's reason (`override_reason`), and the audit trail names them.
 */
export const scheduleSlots = pgTable(
  'schedule_slots',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectId: uuid('project_id').notNull(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => projectMilestones.id),
    engineerId: uuid('engineer_id').references(() => principals.id),
    crewId: uuid('crew_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    /** Minutes of travel from the visit before (question 6 (a)); null when a place is unknown. */
    travelMin: smallint('travel_min'),
    state: text('state').notNull().default('proposed'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** The person or agent who proposed it. */
    proposedBy: uuid('proposed_by')
      .notNull()
      .references(() => principals.id),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => principals.id),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => principals.id),
    doneNote: text('done_note'),
    cancelReason: text('cancel_reason'),
    overrideReason: text('override_reason'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    foreignKey({
      name: 'schedule_slots_project_fk',
      columns: [t.projectId, t.entityId],
      foreignColumns: [projects.id, projects.entityId],
    }),
    foreignKey({
      name: 'schedule_slots_crew_fk',
      columns: [t.crewId, t.entityId],
      foreignColumns: [crews.id, crews.entityId],
    }),
    // The board's week of one company, read by start (tests/spike/schedule-explain.ts).
    index('schedule_slots_entity_starts_idx').on(t.entityId, t.startsAt),
    // A person's or a crew's visits around a time: the conflict check's probes.
    index('schedule_slots_engineer_starts_idx')
      .on(t.engineerId, t.startsAt)
      .where(sql`${t.engineerId} is not null and ${t.state} <> 'cancelled'`),
    index('schedule_slots_crew_starts_idx')
      .on(t.crewId, t.startsAt)
      .where(sql`${t.crewId} is not null and ${t.state} <> 'cancelled'`),
    index('schedule_slots_project_idx').on(t.projectId),
    // The unassigned queue: the steps with a visit not cancelled.
    index('schedule_slots_milestone_idx')
      .on(t.milestoneId)
      .where(sql`${t.state} <> 'cancelled'`),
    check(
      'schedule_slots_state_check',
      sql`${t.state} in ('proposed', 'confirmed', 'done', 'cancelled')`,
    ),
    check('schedule_slots_assignee_check', sql`(${t.engineerId} is null) <> (${t.crewId} is null)`),
    check(
      'schedule_slots_time_check',
      sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '12 hours'`,
    ),
    check('schedule_slots_travel_check', sql`${t.travelMin} is null or ${t.travelMin} >= 0`),
    // A confirmed or done visit says who confirmed it; a done one who did it; a cancelled one why.
    check(
      'schedule_slots_confirmed_check',
      sql`(${t.state} in ('confirmed', 'done')) = (${t.confirmedAt} is not null and ${t.confirmedBy} is not null)`,
    ),
    check(
      'schedule_slots_done_check',
      sql`(${t.state} = 'done') = (${t.doneAt} is not null and ${t.doneBy} is not null)`,
    ),
    check(
      'schedule_slots_cancel_reason_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
  ],
);

/**
 * A person away from a start to an end in one company (docs/03-roadmap-appendix/phase4.md §2,
 * "Unavailability before leave exists"): leave, training or other. Recorded by the company's
 * schedulers; Phase 5's approved leave writes into it. The board's conflict check reads it.
 */
export const unavailability = pgTable(
  'unavailability',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => principals.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    kind: text('kind').notNull(),
    note: text('note'),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    // A person's time away around a time: the conflict check's probe.
    index('unavailability_person_starts_idx').on(t.personId, t.startsAt),
    // The board's week and the Unavailability list of one company.
    index('unavailability_entity_starts_idx').on(t.entityId, t.startsAt),
    check('unavailability_kind_check', sql`${t.kind} in ('leave', 'training', 'other')`),
    check(
      'unavailability_time_check',
      sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '90 days'`,
    ),
  ],
);
