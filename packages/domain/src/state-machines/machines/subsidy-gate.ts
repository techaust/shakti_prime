import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const SUBSIDY_GATE_STATES = ['pending', 'submitted', 'approved', 'rejected'] as const;
export type SubsidyGateState = (typeof SUBSIDY_GATE_STATES)[number];
export type SubsidyGateEvent = 'create' | 'submit' | 'approve' | 'reject' | 'resubmit';

export interface SubsidyGateRecord {
  state: SubsidyGateState | null;
  /** Requirement codes from `required_docs_json` with no document in the vault yet. */
  missingDocuments: readonly string[];
}

export interface SubsidyGateParams {
  reason?: string | null;
}

type G = Guard<SubsidyGateRecord, SubsidyGateParams>;

const documentsComplete: G = {
  description:
    'every document in `required_docs_json` is in the vault (a gate never closes with one missing)',
  check: (record) =>
    record.missingDocuments.length === 0
      ? undefined
      : {
          code: 'validation_failed',
          reason: 'documents_missing',
          details: { missing: record.missingDocuments },
        },
};

/**
 * One subsidy gate of a PM Surya Ghar application (BLUEPRINT §8.5 "a state machine with the
 * required documents for each gate", PRD PRJ-02 "a state machine per gate"), with the rejection
 * and resubmission loop.
 */
export const subsidyGateMachine = defineMachine<
  SubsidyGateState,
  SubsidyGateEvent,
  SubsidyGateRecord,
  SubsidyGateParams
>({
  name: 'subsidy_gate',
  title: 'Subsidy gate',
  summary:
    '`subsidy_gates.state`, one row per gate of a `subsidy_applications` row (portal registration, feasibility, net-meter/JIR and the others the workshop lists).',
  sources: ['BLUEPRINT §8.5, §19 item 2', 'PRD PRJ-02, PRJ-03', 'DATABASE §6.6 `subsidy_gates`'],
  states: SUBSIDY_GATE_STATES,
  initial: 'pending',
  terminal: ['approved'],
  proposedStates: ['pending', 'submitted', 'approved', 'rejected'],
  stateNotes: {
    rejected:
      'Returned by the portal or DISCOM with `rejection_reason`; documents are collected again.',
  },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'pending',
      permission: 'projects.write',
      system: true,
      note: 'Created with the subsidy application, one per gate of the template.',
      proposed: true,
    },
    {
      from: ['pending'],
      event: 'submit',
      to: 'submitted',
      permission: 'projects.write',
      guard: documentsComplete,
      effects: [{ key: 'build_pack', description: 'generate the DISCOM pack for the gate' }],
      proposed: true,
    },
    {
      from: ['submitted'],
      event: 'approve',
      to: 'approved',
      permission: 'projects.gate.approve',
      effects: [{ key: 'advance_project', description: 'lets the project leave the gated stage' }],
      note: "Records the portal's or DISCOM's approval.",
      proposed: true,
    },
    {
      from: ['submitted'],
      event: 'reject',
      to: 'rejected',
      permission: 'projects.gate.approve',
      guard: reasonGiven('the rejection reason is recorded'),
      effects: [
        {
          key: 'request_documents',
          description: 'ask the customer for the missing or corrected documents on WhatsApp',
        },
      ],
      proposed: true,
    },
    {
      from: ['rejected'],
      event: 'resubmit',
      to: 'submitted',
      permission: 'projects.write',
      guard: documentsComplete,
      proposed: true,
    },
  ],
});
