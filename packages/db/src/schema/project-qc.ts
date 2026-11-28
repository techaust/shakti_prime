import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { projectMilestones, projects } from './projects';
import { vendors } from './vendors';

/** The segments a project is made for (`projects_segment_check`). */
const INSTALL_SEGMENTS = sql.raw(`('farmer_pumps', 'residential_rooftop', 'commercial_epc')`);

/**
 * A step's quality checklist for one company and segment (docs/03-roadmap-appendix/phase4.md §7.3,
 * PRD PRJ-02's QC step), as an Executive published it. Versioned as the flow templates are: every
 * publish is a new version, none changes afterwards, and an inspection keeps the version it was
 * filled on (`qc_inspections.checklist_id`). The newest version with no items takes the checklist
 * off the step.
 */
export const checklists = pgTable(
  'checklists',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    segment: text('segment').notNull(),
    /** The step's key in the project's checklist of steps (`project_milestones.key`). */
    stepKey: text('step_key').notNull(),
    version: integer('version').notNull(),
    /** The items in order: `{ key, label, kind, min?, max? }`, validated by `ChecklistItemsSchema`. */
    itemsJson: jsonb('items_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    unique('checklists_version_unique').on(t.entityId, t.segment, t.stepKey, t.version),
    unique('checklists_id_entity_unique').on(t.id, t.entityId),
    check('checklists_segment_check', sql`${t.segment} in ${INSTALL_SEGMENTS}`),
    check('checklists_step_key_check', sql`${t.stepKey} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('checklists_version_check', sql`${t.version} >= 1`),
    check(
      'checklists_items_check',
      sql`jsonb_typeof(${t.itemsJson}) = 'array' and jsonb_array_length(${t.itemsJson}) <= 40`,
    ),
  ],
);

/**
 * A project's filled checklist for one step (docs/03-roadmap-appendix/phase4.md §7.3): its answers
 * and photos, who submitted it and who signed it off or turned it down. A turned-down inspection
 * stays as it was and a new one is submitted; a step has at most one inspection that is not turned
 * down. The signer is never the submitter.
 */
export const qcInspections = pgTable(
  'qc_inspections',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectId: uuid('project_id').notNull(),
    milestoneId: uuid('milestone_id')
      .notNull()
      .references(() => projectMilestones.id),
    /** The checklist version the inspection was filled on, kept whatever is published later. */
    checklistId: uuid('checklist_id').notNull(),
    state: text('state').notNull().default('submitted'),
    /** One answer per item of the checklist, in its order: `{ key, value }` (`QcAnswersSchema`). */
    answersJson: jsonb('answers_json').notNull(),
    /** Every photo the answers name (file purpose `qc_photo`), for the files' checks. */
    photoFileIds: uuid('photo_file_ids').array().notNull().default(sql`'{}'::uuid[]`),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull(),
    submittedBy: uuid('submitted_by')
      .notNull()
      .references(() => principals.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => principals.id),
    rejectReason: text('reject_reason'),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: 'qc_inspections_project_fk',
      columns: [t.projectId, t.entityId],
      foreignColumns: [projects.id, projects.entityId],
    }),
    foreignKey({
      name: 'qc_inspections_checklist_fk',
      columns: [t.checklistId, t.entityId],
      foreignColumns: [checklists.id, checklists.entityId],
    }),
    // A step has one inspection waiting or signed off; a turned-down one makes way for the next.
    uniqueIndex('qc_inspections_milestone_live_unique')
      .on(t.milestoneId)
      .where(sql`${t.state} <> 'rejected'`),
    // The project page's QC tab, newest first.
    index('qc_inspections_project_idx').on(t.projectId, t.submittedAt, t.id),
    index('qc_inspections_checklist_idx').on(t.checklistId),
    check(
      'qc_inspections_state_check',
      sql`${t.state} in ('submitted', 'signed_off', 'rejected')`,
    ),
    check('qc_inspections_answers_check', sql`jsonb_typeof(${t.answersJson}) = 'array'`),
    check(
      'qc_inspections_photos_check',
      sql`cardinality(${t.photoFileIds}) <= 200 and array_position(${t.photoFileIds}, null) is null`,
    ),
    // A decided inspection says when and by whom; a waiting one neither.
    check(
      'qc_inspections_decided_check',
      sql`(${t.state} = 'submitted') = (${t.decidedAt} is null and ${t.decidedBy} is null)`,
    ),
    check(
      'qc_inspections_reject_reason_check',
      sql`(${t.state} = 'rejected') = (${t.rejectReason} is not null)`,
    ),
    check(
      'qc_inspections_reason_length_check',
      sql`${t.rejectReason} is null or length(${t.rejectReason}) between 1 and 300`,
    ),
    // The signer is never the submitter (PRD PRJ-02).
    check('qc_inspections_signer_check', sql`${t.decidedBy} is distinct from ${t.submittedBy}`),
  ],
);

/**
 * A labour, contractor or other direct charge on a project (docs/03-roadmap-appendix/phase4.md
 * §7.3, PRD PRJ-05; restricted, append-only): read and written only with `finance.cost.read`. A
 * correction is a reversal line: the same kind, vendor and rate with the quantity and amount
 * negated, pointing at the line it reverses, which is reversed once.
 */
export const projectCostLines = pgTable(
  'project_cost_lines',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').notNull(),
    /** The contractor (a vendor of kind `contractor`) for a contractor's charge; null otherwise. */
    vendorId: uuid('vendor_id').references(() => vendors.id),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    rate: numeric('rate', { precision: 14, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    note: text('note'),
    reversesId: uuid('reverses_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    foreignKey({
      name: 'project_cost_lines_project_fk',
      columns: [t.projectId, t.entityId],
      foreignColumns: [projects.id, projects.entityId],
    }),
    unique('project_cost_lines_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'project_cost_lines_reverses_fk',
      columns: [t.reversesId, t.entityId],
      foreignColumns: [t.id, t.entityId],
    }),
    // A line is reversed once.
    unique('project_cost_lines_reverses_unique').on(t.reversesId),
    // The project page's Costs tab, in the order the lines were added.
    index('project_cost_lines_project_idx').on(t.projectId, t.createdAt, t.id),
    index('project_cost_lines_vendor_idx').on(t.vendorId),
    check(
      'project_cost_lines_kind_check',
      sql`${t.kind} in ('labour', 'contractor', 'other_direct')`,
    ),
    check(
      'project_cost_lines_vendor_check',
      sql`(${t.kind} = 'contractor') = (${t.vendorId} is not null)`,
    ),
    check('project_cost_lines_rate_check', sql`${t.rate} > 0`),
    // A charge counts up; its reversal counts the same quantity down.
    check(
      'project_cost_lines_quantity_check',
      sql`(${t.reversesId} is null) = (${t.quantity} > 0) and ${t.quantity} <> 0`,
    ),
    check('project_cost_lines_amount_check', sql`${t.amount} = round(${t.quantity} * ${t.rate}, 2)`),
    check(
      'project_cost_lines_note_check',
      sql`${t.note} is null or length(${t.note}) between 1 and 300`,
    ),
  ],
);
