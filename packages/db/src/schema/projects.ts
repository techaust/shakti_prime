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
import { accounts, customerSites } from './accounts';
import { actorsRequired, timestamps } from './columns';
import { entities } from './entities';
import { principals } from './principals';
import { salesOrders } from './sales-orders';

/** The segments a project is made for: those whose sale needs installation (phase 4 §2, question 1). */
const INSTALL_SEGMENTS = sql.raw(`('farmer_pumps', 'residential_rooftop', 'commercial_epc')`);

/**
 * The milestone checklist of one company and segment, as an Executive published it
 * (docs/03-roadmap-appendix/phase4.md §6.1, question 2 (a)). Every publish is a new version and no
 * version changes afterwards: the newest is the one a new project copies, and a project keeps the
 * version it copied (`projects.template_version_id`).
 */
export const projectFlowTemplates = pgTable(
  'project_flow_templates',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    segment: text('segment').notNull(),
    version: integer('version').notNull(),
    /** The steps in order: `{ key, title, requires }`, validated by `ProjectStepsSchema`. */
    stepsJson: jsonb('steps_json').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publishedBy: uuid('published_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    unique('project_flow_templates_version_unique').on(t.entityId, t.segment, t.version),
    unique('project_flow_templates_id_entity_unique').on(t.id, t.entityId),
    check('project_flow_templates_segment_check', sql`${t.segment} in ${INSTALL_SEGMENTS}`),
    check('project_flow_templates_version_check', sql`${t.version} >= 1`),
    check(
      'project_flow_templates_steps_check',
      sql`jsonb_typeof(${t.stepsJson}) = 'array' and jsonb_array_length(${t.stepsJson}) between 1 and 30`,
    ),
  ],
);

/**
 * An installation project (docs/03-roadmap-appendix/phase4.md §5, PRD PRJ-01): drafted from a
 * confirmed order of an install segment with a site, or made by a Project Manager for any
 * confirmed order. Its segment, scheme and flow are snapshotted when it is made; its state moves
 * through the `project_standard` machine. `project_no` comes from the company's series for the
 * financial year (`app.next_document_no()`).
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectNo: text('project_no').notNull(),
    /** The financial year of the series the number came from, `2026-27`. */
    fy: text('fy').notNull(),
    salesOrderId: uuid('sales_order_id').notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    siteId: uuid('site_id').references(() => customerSites.id),
    segment: text('segment').notNull(),
    scheme: text('scheme').notNull(),
    flow: text('flow').notNull(),
    /** The template version copied; null when the workshop's default steps were copied or none. */
    templateVersionId: uuid('template_version_id'),
    state: text('state').notNull().default('active'),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull().defaultNow(),
    /** The Project Manager who runs it; null until one is named. */
    ownerId: uuid('owner_id').references(() => principals.id),
    /** Locked at feasibility for a Surya Ghar project (J4). */
    sanctionedLoadKw: numeric('sanctioned_load_kw', { precision: 8, scale: 2 }),
    holdReason: text('hold_reason'),
    cancelReason: text('cancel_reason'),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    ...timestamps,
    ...actorsRequired,
  },
  (t) => [
    unique('projects_entity_project_no_unique').on(t.entityId, t.projectNo),
    // The key the milestones and assignments point at, so they stay in the project's company.
    unique('projects_id_entity_unique').on(t.id, t.entityId),
    foreignKey({
      name: 'projects_sales_order_fk',
      columns: [t.salesOrderId, t.entityId],
      foreignColumns: [salesOrders.id, salesOrders.entityId],
    }),
    foreignKey({
      name: 'projects_template_fk',
      columns: [t.templateVersionId, t.entityId],
      foreignColumns: [projectFlowTemplates.id, projectFlowTemplates.entityId],
    }),
    // An order has one project that is not cancelled.
    uniqueIndex('projects_sales_order_live_unique')
      .on(t.salesOrderId)
      .where(sql`${t.state} <> 'cancelled'`),
    // Every project of an order, for drafting's once-per-order check and the order page.
    index('projects_sales_order_idx').on(t.salesOrderId),
    // The list's default order by state, and Account 360's projects of a customer.
    index('projects_entity_state_updated_idx').on(t.entityId, t.state, t.updatedAt.desc(), t.id),
    index('projects_account_idx').on(t.accountId),
    index('projects_owner_idx').on(t.ownerId),
    check('projects_segment_check', sql`${t.segment} in ${INSTALL_SEGMENTS}`),
    check('projects_scheme_check', sql`${t.scheme} in ('none', 'pm_surya_ghar', 'pm_kusum')`),
    check('projects_flow_check', sql`${t.flow} in ('standard', 'surya_ghar')`),
    // A PM Surya Ghar project follows the subsidy flow; every other the standard one.
    check(
      'projects_flow_scheme_check',
      sql`(${t.flow} = 'surya_ghar') = (${t.scheme} = 'pm_surya_ghar')`,
    ),
    check(
      'projects_state_check',
      sql`${t.state} in ('active', 'on_hold', 'completed', 'cancelled')`,
    ),
    check(
      'projects_fy_check',
      sql`${t.fy} ~ '^[0-9]{4}-[0-9]{2}$' and right(${t.fy}, 2)::int = (left(${t.fy}, 4)::int + 1) % 100`,
    ),
    // A project on hold says why; one cancelled says why.
    check(
      'projects_hold_reason_check',
      sql`(${t.state} = 'on_hold') = (${t.holdReason} is not null)`,
    ),
    check(
      'projects_cancel_reason_check',
      sql`(${t.state} = 'cancelled') = (${t.cancelReason} is not null)`,
    ),
    check(
      'projects_sanctioned_load_check',
      sql`${t.sanctionedLoadKw} is null or ${t.sanctionedLoadKw} > 0`,
    ),
  ],
);

/**
 * The people on a project (docs/03-roadmap-appendix/phase4.md §5): what a Field Engineer's or a
 * Lead Converter's `own` scope reads, with the project's owner (`app.project_is_mine()`). Crews
 * join with J5's scheduling board.
 */
export const projectAssignments = pgTable(
  'project_assignments',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectId: uuid('project_id').notNull(),
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
      name: 'project_assignments_project_fk',
      columns: [t.projectId, t.entityId],
      foreignColumns: [projects.id, projects.entityId],
    }).onDelete('cascade'),
    unique('project_assignments_person_unique').on(t.projectId, t.personId),
    // The `own` predicate's probe: the projects a person is on.
    index('project_assignments_person_idx').on(t.personId, t.projectId),
  ],
);

/**
 * One step of a project's copied checklist (docs/03-roadmap-appendix/phase4.md §5): done in order
 * through the `project_standard` machine's `milestone.complete`. `title` is the Executive's words
 * from the template, or null for a step of the workshop's default list, which the screens name
 * from the message catalogue. `requires` lists the document requirement keys (J3) the step needs.
 */
export const projectMilestones = pgTable(
  'project_milestones',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    projectId: uuid('project_id').notNull(),
    position: smallint('position').notNull(),
    key: text('key').notNull(),
    title: text('title'),
    state: text('state').notNull().default('open'),
    skipReason: text('skip_reason'),
    requires: jsonb('requires').notNull().default([]),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'project_milestones_project_fk',
      columns: [t.projectId, t.entityId],
      foreignColumns: [projects.id, projects.entityId],
    }),
    unique('project_milestones_position_unique').on(t.projectId, t.position),
    unique('project_milestones_key_unique').on(t.projectId, t.key),
    check('project_milestones_state_check', sql`${t.state} in ('open', 'done', 'skipped')`),
    check('project_milestones_key_check', sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check('project_milestones_position_check', sql`${t.position} >= 1`),
    check('project_milestones_requires_check', sql`jsonb_typeof(${t.requires}) = 'array'`),
    // A done step says when and by whom; a skipped one why; an open one neither.
    check(
      'project_milestones_done_check',
      sql`(${t.state} = 'done') = (${t.doneAt} is not null and ${t.doneBy} is not null)`,
    ),
    check(
      'project_milestones_skip_check',
      sql`(${t.state} = 'skipped') = (${t.skipReason} is not null)`,
    ),
  ],
);
