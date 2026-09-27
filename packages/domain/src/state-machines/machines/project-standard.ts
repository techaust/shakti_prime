import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PROJECT_STANDARD_STATES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStandardState = (typeof PROJECT_STANDARD_STATES)[number];
export type ProjectStandardEvent =
  'create' | 'milestone.complete' | 'hold' | 'resume' | 'complete' | 'cancel';

/** One `project_milestones` row as the guards read it, in checklist order. */
export interface MilestoneFact {
  code: string;
  done: boolean;
  /** Every document the milestone's requirement template needs is in the vault. */
  documentsComplete: boolean;
}

export interface ProjectStandardRecord {
  state: ProjectStandardState | null;
  milestones: readonly MilestoneFact[];
}

export interface ProjectStandardParams {
  milestoneCode?: string | null;
  reason?: string | null;
}

type G = Guard<ProjectStandardRecord, ProjectStandardParams>;

/** The default checklist (BLUEPRINT §8.5); Executives edit the steps in the flow template. */
export const STANDARD_MILESTONES = [
  'survey',
  'dispatch',
  'install',
  'commission',
  'handover',
] as const;

const nextMilestone: G = {
  description: 'the milestone is the next open one in checklist order',
  check: (record, { params }) => {
    const next = record.milestones.find((m) => !m.done);
    return next !== undefined && next.code === params.milestoneCode
      ? undefined
      : { code: 'conflict', reason: 'milestone_out_of_order' };
  },
};

const milestoneDocuments: G = {
  description: "the milestone's required documents are in the vault (PRJ-03)",
  check: (record, { params }) => {
    const milestone = record.milestones.find((m) => m.code === params.milestoneCode);
    return milestone?.documentsComplete === true
      ? undefined
      : { code: 'validation_failed', reason: 'documents_missing' };
  },
};

const allMilestonesDone: G = {
  description: 'every milestone is done',
  check: (record) =>
    record.milestones.every((m) => m.done)
      ? undefined
      : { code: 'conflict', reason: 'milestones_open' },
};

/**
 * Standard install flow (BLUEPRINT §8.5, PRD PRJ-01): farmer pumps, commercial EPC and other
 * non-subsidy jobs. The milestones are data in the flow template, so the project machine walks a
 * checklist rather than naming each step as a state.
 */
export const projectStandardMachine = defineMachine<
  ProjectStandardState,
  ProjectStandardEvent,
  ProjectStandardRecord,
  ProjectStandardParams
>({
  name: 'project_standard',
  title: 'Project, standard install flow',
  summary: `\`projects.state\` for flow templates of the standard kind; \`project_milestones.state\` holds each step. Default checklist: ${STANDARD_MILESTONES.join(' → ')}.`,
  sources: ['BLUEPRINT §8.5, §19 item 2', 'PRD PRJ-01, PRJ-03'],
  states: PROJECT_STANDARD_STATES,
  initial: 'active',
  terminal: ['completed', 'cancelled'],
  proposedStates: ['active', 'on_hold', 'completed', 'cancelled'],
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'active',
      permission: 'projects.write',
      system: true,
      effects: [
        { key: 'copy_checklist', description: 'copy the milestones from the flow template' },
      ],
      note: 'The platform creates the project from a confirmed sales order of an install segment.',
    },
    {
      from: ['active'],
      event: 'milestone.complete',
      to: 'active',
      permission: 'projects.write',
      guard: allOf(nextMilestone, milestoneDocuments),
      effects: [
        { key: 'mark_milestone', description: 'set the milestone done with `done_at`' },
        { key: 'emit', description: 'event for the milestone WhatsApp message' },
      ],
      proposed: true,
    },
    {
      from: ['active'],
      event: 'hold',
      to: 'on_hold',
      permission: 'projects.write',
      guard: reasonGiven(),
      proposed: true,
    },
    {
      from: ['on_hold'],
      event: 'resume',
      to: 'active',
      permission: 'projects.write',
      proposed: true,
    },
    {
      from: ['active'],
      event: 'complete',
      to: 'completed',
      permission: 'projects.write',
      guard: allMilestonesDone,
      effects: [
        { key: 'handover_kit', description: 'send the handover kit on WhatsApp' },
        { key: 'register_warranty', description: 'register warranty per serial' },
      ],
      proposed: true,
    },
    {
      from: ['active', 'on_hold'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'projects.write',
      scope: 'entity',
      guard: reasonGiven(),
      proposed: true,
    },
  ],
});
