import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PROJECT_SURYA_GHAR_STATES = [
  'survey',
  'load_enhancement',
  'portal_registration',
  'feasibility',
  'agreement',
  'material',
  'installation',
  'qc',
  'net_metering',
  'dbt_tracking',
  'completed',
  'cancelled',
] as const;
export type ProjectSuryaGharState = (typeof PROJECT_SURYA_GHAR_STATES)[number];
export type ProjectSuryaGharEvent =
  | 'create'
  | 'load.enhance'
  | 'survey.complete'
  | 'load.sanctioned'
  | 'registration.approved'
  | 'feasibility.approved'
  | 'agreement.signed'
  | 'material.delivered'
  | 'installation.complete'
  | 'qc.signoff'
  | 'net_meter.installed'
  | 'subsidy.credited'
  | 'cancel';

export interface ProjectSuryaGharRecord {
  state: ProjectSuryaGharState | null;
  /** The survey found the sanctioned load too low for the system size. */
  loadEnhancementRequired: boolean;
  /** Every document the current stage's requirement template needs is in the vault. */
  documentsComplete: boolean;
  /** The `subsidy_gates` row for the current stage is `approved` (see the subsidy gate machine). */
  gateApproved: boolean;
  /** `subsidy_applications.sanctioned_load_kw`, locked once feasibility is approved. */
  sanctionedLoadKw: string | null;
  /** Every DCR/ALMM serial on the project is validated. */
  dcrSerialsValidated: boolean;
  /** The DBT credit to the customer is recorded. */
  subsidyCredited: boolean;
}

export interface ProjectSuryaGharParams {
  reason?: string | null;
}

type G = Guard<ProjectSuryaGharRecord, ProjectSuryaGharParams>;

const documents: G = {
  description: "the stage's required documents are in the vault (PRJ-03)",
  check: (record) =>
    record.documentsComplete
      ? undefined
      : { code: 'validation_failed', reason: 'documents_missing' },
};

const gate: G = {
  description: "the stage's subsidy gate is approved",
  check: (record) =>
    record.gateApproved ? undefined : { code: 'conflict', reason: 'subsidy_gate_open' },
};

const loadNeeded: G = {
  description: 'the survey found that the load must be enhanced',
  check: (record) =>
    record.loadEnhancementRequired
      ? undefined
      : { code: 'conflict', reason: 'load_enhancement_not_needed' },
};

const loadNotNeeded: G = {
  description: 'no load enhancement is needed',
  check: (record) =>
    record.loadEnhancementRequired
      ? { code: 'conflict', reason: 'load_enhancement_required' }
      : undefined,
};

const sanctionedLoad: G = {
  description: 'the sanctioned load is recorded',
  check: (record) =>
    record.sanctionedLoadKw
      ? undefined
      : { code: 'validation_failed', reason: 'sanctioned_load_missing' },
};

const dcrSerials: G = {
  description: 'every DCR/ALMM serial is validated',
  check: (record) =>
    record.dcrSerialsValidated
      ? undefined
      : { code: 'conflict', reason: 'dcr_serials_unvalidated' },
};

const credited: G = {
  description: 'the DBT subsidy credit is recorded',
  check: (record) =>
    record.subsidyCredited ? undefined : { code: 'conflict', reason: 'subsidy_not_credited' },
};

const OPEN_STATES = PROJECT_SURYA_GHAR_STATES.filter(
  (s): s is Exclude<ProjectSuryaGharState, 'completed' | 'cancelled'> =>
    s !== 'completed' && s !== 'cancelled',
);

/**
 * PM Surya Ghar rooftop subsidy flow (BLUEPRINT §8.5, PRD PRJ-02). Each approval stage waits for
 * its `subsidy_gates` row; rejection and resubmission loop inside the subsidy gate machine, so the
 * project stays at its stage until the gate is approved.
 */
export const projectSuryaGharMachine = defineMachine<
  ProjectSuryaGharState,
  ProjectSuryaGharEvent,
  ProjectSuryaGharRecord,
  ProjectSuryaGharParams
>({
  name: 'project_surya_ghar',
  title: 'Project, PM Surya Ghar flow',
  summary:
    '`projects.state` for the PM Surya Ghar flow template; the stages are the blueprint sequence survey → load enhancement (when required) → portal registration → feasibility → agreement → material → installation → QC → net-meter/JIR → DBT tracking.',
  sources: ['BLUEPRINT §8.5, §19 item 2', 'PRD PRJ-02, PRJ-03'],
  states: PROJECT_SURYA_GHAR_STATES,
  initial: 'survey',
  terminal: ['completed', 'cancelled'],
  proposedStates: ['completed', 'cancelled'],
  stateNotes: {
    load_enhancement: 'Only when the survey finds the sanctioned load too low.',
    feasibility: 'Approval locks the sanctioned load.',
    material: 'Material is dispatched to the site; DCR/ALMM serials are validated first.',
    net_metering: 'Net meter installed and the JIR recorded.',
  },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'survey',
      permission: 'projects.write',
      system: true,
      effects: [{ key: 'open_gates', description: 'create the subsidy application and its gates' }],
      note: 'The platform creates the project from a confirmed rooftop subsidy order.',
    },
    {
      from: ['survey'],
      event: 'load.enhance',
      to: 'load_enhancement',
      permission: 'projects.write',
      guard: allOf(loadNeeded, documents),
    },
    {
      from: ['survey'],
      event: 'survey.complete',
      to: 'portal_registration',
      permission: 'projects.write',
      guard: allOf(loadNotNeeded, documents),
    },
    {
      from: ['load_enhancement'],
      event: 'load.sanctioned',
      to: 'portal_registration',
      permission: 'projects.write',
      guard: documents,
    },
    {
      from: ['portal_registration'],
      event: 'registration.approved',
      to: 'feasibility',
      permission: 'projects.gate.approve',
      guard: gate,
    },
    {
      from: ['feasibility'],
      event: 'feasibility.approved',
      to: 'agreement',
      permission: 'projects.gate.approve',
      guard: allOf(gate, sanctionedLoad),
      effects: [
        {
          key: 'lock_sanctioned_load',
          description: 'lock `sanctioned_load_kw`; later sizing may not exceed it',
        },
      ],
    },
    {
      from: ['agreement'],
      event: 'agreement.signed',
      to: 'material',
      permission: 'projects.write',
      guard: documents,
    },
    {
      from: ['material'],
      event: 'material.delivered',
      to: 'installation',
      permission: 'projects.write',
      guard: dcrSerials,
      note: 'The dispatch machine also refuses to leave `ready` with unvalidated DCR serials.',
    },
    {
      from: ['installation'],
      event: 'installation.complete',
      to: 'qc',
      permission: 'projects.write',
      guard: documents,
    },
    {
      from: ['qc'],
      event: 'qc.signoff',
      to: 'net_metering',
      permission: 'projects.qc.signoff',
      guard: documents,
    },
    {
      from: ['net_metering'],
      event: 'net_meter.installed',
      to: 'dbt_tracking',
      permission: 'projects.gate.approve',
      guard: gate,
    },
    {
      from: ['dbt_tracking'],
      event: 'subsidy.credited',
      to: 'completed',
      permission: 'projects.write',
      guard: credited,
      effects: [
        { key: 'handover_kit', description: 'send the handover kit on WhatsApp' },
        { key: 'cmc_register', description: 'open the CMC register entry (PRJ-07)' },
      ],
    },
    {
      from: OPEN_STATES,
      event: 'cancel',
      to: 'cancelled',
      permission: 'projects.write',
      scope: 'entity',
      guard: reasonGiven(),
      proposed: true,
    },
  ],
});
