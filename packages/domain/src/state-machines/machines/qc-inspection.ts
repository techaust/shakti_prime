import type { QcInspectionState } from '@shakti/contracts';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const QC_INSPECTION_STATES = ['submitted', 'signed_off', 'rejected'] as const satisfies
  readonly QcInspectionState[];
export type QcInspectionEvent = 'submit' | 'signoff' | 'reject';

export interface QcInspectionRecord {
  state: QcInspectionState | null;
  /** Who submitted the inspection; null before it exists. */
  submittedBy: string | null;
  /** Every item of its checklist has an answer of its kind, within its bounds. */
  answersComplete: boolean;
}

export interface QcInspectionParams {
  reason?: string | null;
}

type G = Guard<QcInspectionRecord, QcInspectionParams>;

const answersComplete: G = {
  description: 'every item of the checklist is answered, each as its kind asks',
  check: (record) =>
    record.answersComplete ? undefined : { code: 'validation_failed', reason: 'qc_answers_missing' },
};

const notTheSubmitter: G = {
  description: 'the person deciding is not the one who submitted it',
  check: (record, { actor }) =>
    actor.kind === 'principal' && actor.principal.id !== record.submittedBy
      ? undefined
      : { code: 'forbidden', reason: 'qc_signer_is_submitter' },
};

/**
 * A project's quality check of one step (docs/03-roadmap-appendix/phase4.md §7.3, the QC step of
 * PRD PRJ-02): filled on the step's checklist, then signed off or turned down by someone else. A
 * turned-down check stays as it was, and a new one is submitted for the step.
 */
export const qcInspectionMachine = defineMachine<
  QcInspectionState,
  QcInspectionEvent,
  QcInspectionRecord,
  QcInspectionParams
>({
  name: 'qc_inspection',
  title: 'QC inspection',
  summary:
    '`qc_inspections.state`, one row per filled checklist of a project step. A step with a checklist is marked done only once one of its inspections is signed off (`app.project_qc_signed_off()`).',
  sources: ['BLUEPRINT §8.5', 'PRD PRJ-02 (QC step)', 'phase 4 design §7.3'],
  states: QC_INSPECTION_STATES,
  initial: 'submitted',
  terminal: ['signed_off', 'rejected'],
  proposedStates: ['submitted', 'signed_off', 'rejected'],
  stored: { table: 'qc_inspections', stateColumn: 'state', changedAtColumn: 'decided_at' },
  transitions: [
    {
      from: 'new',
      event: 'submit',
      to: 'submitted',
      permission: 'projects.write',
      guard: answersComplete,
      emits: 'projects.qc.submitted',
      note: "On the open step of a project in progress, on the newest checklist of the project's company and segment for the step; a Field Engineer submits for a project they are on (`own`).",
      proposed: true,
    },
    {
      from: ['submitted'],
      event: 'signoff',
      to: 'signed_off',
      permission: 'projects.qc.signoff',
      scope: 'entity',
      guard: notTheSubmitter,
      emits: 'projects.qc.signed_off',
      note: 'The step may then be marked done (`projects.milestone.complete`).',
      proposed: true,
    },
    {
      from: ['submitted'],
      event: 'reject',
      to: 'rejected',
      permission: 'projects.qc.signoff',
      scope: 'entity',
      guard: allOf(notTheSubmitter, reasonGiven()),
      emits: 'projects.qc.rejected',
      note: 'A new inspection is submitted for the step.',
      proposed: true,
    },
  ],
});
