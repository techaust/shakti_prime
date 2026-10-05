import { hasGrant } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const OPPORTUNITY_STATES = ['open', 'nurture', 'won', 'lost'] as const;
export type OpportunityMachineState = (typeof OPPORTUNITY_STATES)[number];
export type OpportunityEvent =
  'create' | 'stage.move' | 'assign' | 'nurture' | 'reopen' | 'win' | 'lose';

/** What the opportunity commands preload for the guards. */
export interface OpportunityRecord {
  state: OpportunityMachineState | null;
  pipelineId: string;
  /** `stage_exit_rules_json` of the current stage: the fields that must be filled to leave it. */
  exitRequiredFields: readonly string[];
  /** The opportunity's filled fields, by the names the exit rules use. */
  fields: Readonly<Record<string, unknown>>;
  lockedUntil: Date | null;
  stateChangedAt: Date | null;
  /** An accepted quote or a confirmed sales order references this opportunity. */
  hasAcceptedQuoteOrConfirmedOrder: boolean;
}

export interface OpportunityParams {
  targetStage?: { id: string; pipelineId: string } | null;
  reason?: string | null;
}

type G = Guard<OpportunityRecord, OpportunityParams>;

const DAY_MS = 86_400_000;

/** Whether a lead detail an exit rule names is filled in (the workspace's checklist shows each). */
export function exitFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const stageInPipeline: G = {
  description: 'the target stage belongs to the opportunity pipeline',
  check: (record, { params }) => {
    if (!params.targetStage) return { code: 'validation_failed', reason: 'stage_missing' };
    return params.targetStage.pipelineId === record.pipelineId
      ? undefined
      : { code: 'validation_failed', reason: 'stage_other_pipeline' };
  },
};

const exitRulesMet: G = {
  description: 'the exit rules of the current stage are met (its required fields are filled)',
  check: (record) => {
    const missing = record.exitRequiredFields.filter(
      (field) => !exitFieldFilled(record.fields[field]),
    );
    return missing.length === 0
      ? undefined
      : { code: 'validation_failed', reason: 'stage_fields_missing', details: { missing } };
  },
};

const lockFree: G = {
  description:
    'the ownership lock has passed, or the caller holds crm.lead.assign at team scope or wider; the platform handover always passes',
  check: (record, { actor, now }) => {
    if (actor.kind === 'system') return undefined;
    if (record.lockedUntil === null || record.lockedUntil.getTime() <= now.getTime()) {
      return undefined;
    }
    return hasGrant(actor.principal.permissions, 'crm.lead.assign', 'team')
      ? undefined
      : { code: 'conflict', reason: 'opportunity_locked' };
  },
};

const reopenWindow: G = {
  description: `from lost: lost within the last ${String(WORKSHOP_DEFAULTS.opportunity.reopenWindowDays)} days`,
  check: (record, { now }) => {
    if (record.state !== 'lost') return undefined;
    const since = record.stateChangedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return now.getTime() - since <= WORKSHOP_DEFAULTS.opportunity.reopenWindowDays * DAY_MS
      ? undefined
      : { code: 'conflict', reason: 'reopen_window_passed' };
  },
};

const hasOrder: G = {
  description: 'an accepted quote or a confirmed sales order references the opportunity',
  check: (record) =>
    record.hasAcceptedQuoteOrConfirmedOrder
      ? undefined
      : { code: 'conflict', reason: 'win_needs_order' },
};

/** Opportunity (design §7.2). Stage moves happen inside `open`. */
export const opportunityMachine = defineMachine<
  OpportunityMachineState,
  OpportunityEvent,
  OpportunityRecord,
  OpportunityParams
>({
  name: 'opportunity',
  title: 'Opportunity',
  summary:
    '`opportunities.state`. One per enquiry per entity; the pipeline stage (`stage_id`) moves only while the opportunity is open.',
  sources: [
    'docs/design/backend-weeks-3-5.md §7.2',
    'BLUEPRINT §8.1, §8.2',
    'PRD CRM-03, CRM-05, TEL-02',
  ],
  states: OPPORTUNITY_STATES,
  initial: 'open',
  terminal: ['won'],
  stateNotes: {
    open: 'Being worked; stage moves and assignment happen here.',
    nurture:
      'Parked on a nurture cadence with a reason (`crm.opportunity.nurture`); `crm.opportunity.reopen` brings it back to open.',
    won: 'Closed with an accepted quote or a confirmed order.',
    lost: 'Closed without a sale; may be reopened for a limited time.',
  },
  stored: { table: 'opportunities', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'open',
      permission: 'crm.lead.write',
      system: true,
      note: 'Created by `crm.lead.create` (manual entry) or by lead ingestion (the platform).',
      emits: 'crm.lead.created',
      proposed: true,
    },
    {
      from: ['open'],
      event: 'stage.move',
      to: 'open',
      permission: 'crm.lead.write',
      guard: allOf(stageInPipeline, exitRulesMet),
      emits: 'crm.opportunity.stage_moved',
      effects: [
        { key: 'set_stage', description: 'update `stage_id`' },
        {
          key: 'handover_if_qualified',
          description:
            'when the target stage is `qualified`, run the handover: weighted round-robin over Lead Converters by presence, capacity, language and segment (TEL-02), within 10 s',
        },
      ],
    },
    {
      from: ['open'],
      event: 'assign',
      to: 'open',
      permission: 'crm.lead.assign',
      system: true,
      guard: lockFree,
      emits: 'crm.opportunity.assigned',
      effects: [
        { key: 'set_owner', description: 'set `owner_id` and `team_id`' },
        {
          key: 'lock_owner',
          description: `set \`locked_until\` = now + the pipeline's \`lock_hours\` (${String(WORKSHOP_DEFAULTS.opportunity.handoverLockHours)} h, the workshop default, when the pipeline has none)`,
        },
      ],
    },
    {
      from: ['open'],
      event: 'nurture',
      to: 'nurture',
      permission: 'crm.lead.write',
      guard: reasonGiven(),
      effects: [
        {
          key: 'schedule_nurture',
          description: `nurture call tasks for the lead's owner on day ${WORKSHOP_DEFAULTS.calling.nurtureCallDays.join(', ')} after the lead enters nurture, at the start of calling hours (the owner's default for workshop CALL-5); a workflow engine is a later choice`,
        },
      ],
      emits: 'crm.opportunity.nurtured',
    },
    {
      from: ['nurture', 'lost'],
      event: 'reopen',
      to: 'open',
      permission: 'crm.lead.write',
      guard: reopenWindow,
      effects: [{ key: 'first_open_stage', description: 'stage = the first open stage' }],
      emits: 'crm.opportunity.reopened',
    },
    {
      from: ['open'],
      event: 'win',
      to: 'won',
      permission: 'crm.lead.write',
      guard: hasOrder,
      emits: 'crm.opportunity.won',
    },
    {
      from: ['open', 'nurture'],
      event: 'lose',
      to: 'lost',
      permission: 'crm.lead.write',
      guard: reasonGiven('a lost-reason code is given'),
      emits: 'crm.opportunity.lost',
    },
  ],
});
