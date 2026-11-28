import { z } from 'zod';

/**
 * Project enumerations (J1, docs/03-roadmap-appendix/phase4.md §5). Each list-valued check
 * constraint of the project tables is paired with one of these in `enum-sync.test.ts`.
 */

/** `projects.state`, as the `project_standard` machine moves it. */
export const ProjectStateSchema = z.enum(['active', 'on_hold', 'completed', 'cancelled']);
export type ProjectState = z.infer<typeof ProjectStateSchema>;

/** Which machine a project follows: the standard checklist, or PM Surya Ghar's gates (J4). */
export const ProjectFlowSchema = z.enum(['standard', 'surya_ghar']);
export type ProjectFlow = z.infer<typeof ProjectFlowSchema>;

/**
 * The segments whose sale needs installation, so a project (question 1 (a)); never
 * `dealer_wholesale`.
 */
export const ProjectSegmentSchema = z.enum([
  'farmer_pumps',
  'residential_rooftop',
  'commercial_epc',
]);
export type ProjectSegment = z.infer<typeof ProjectSegmentSchema>;

/** `project_milestones.state`. */
export const MilestoneStateSchema = z.enum(['open', 'done', 'skipped']);
export type MilestoneState = z.infer<typeof MilestoneStateSchema>;

/**
 * Why the platform drafted no project for a confirmed order (`projects.project.draft`): the
 * order's lead is of no install segment, it names no site, the order already has a project, or it
 * is not (or no longer) confirmed or not in the company.
 */
export const DraftSkipReasonSchema = z.enum([
  'not_install_segment',
  'no_site',
  'already_drafted',
  'order_not_confirmed',
]);
export type DraftSkipReason = z.infer<typeof DraftSkipReasonSchema>;

/**
 * The cancel reason the platform records on the project of a cancelled order
 * (`projects.project.cancel_for_order`); the screens show it in words from the catalogue.
 */
export const PROJECT_ORDER_CANCELLED_REASON = 'order_cancelled';
