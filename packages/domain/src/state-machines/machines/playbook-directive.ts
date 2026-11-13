import { allOf, defineMachine, reasonGiven, type Effect, type Guard } from '../define-machine';

export const PLAYBOOK_DIRECTIVE_STATES = ['draft', 'approved', 'retired'] as const;
export type PlaybookDirectiveState = (typeof PLAYBOOK_DIRECTIVE_STATES)[number];
export type PlaybookDirectiveEvent = 'create' | 'edit' | 'approve' | 'retire';

export interface PlaybookDirectiveRecord {
  state: PlaybookDirectiveState | null;
  /** The conflict check has run on the directive's current wording (`checked_at` is set). */
  checked: boolean;
  /** `conflicts_with`: approved directives this draft contradicts or overlaps, not yet resolved. */
  conflictsWith: readonly string[];
}

export interface PlaybookDirectiveParams {
  reason?: string | null;
}

type G = Guard<PlaybookDirectiveRecord, PlaybookDirectiveParams>;

const checkRan: G = {
  description: 'the conflict check has run on the current wording (`checked_at` is set)',
  check: (record) =>
    record.checked ? undefined : { code: 'conflict', reason: 'playbook_check_pending' },
};

const noConflict: G = {
  description: 'no unresolved conflict or overlap with an approved directive (`conflicts_with` is empty)',
  check: (record) =>
    record.conflictsWith.length === 0
      ? undefined
      : { code: 'conflict', reason: 'playbook_conflict_open' },
};

const RELOAD: Effect = {
  key: 'emit',
  description: 'event so the agents and Ask read the approved directives again',
};

/**
 * Playbook directive (BLUEPRINT §9.1, PRD AI-01, docs/03-roadmap-appendix/phase2.md §5.4): rules
 * Executives teach the Knowledge Brain. An Executive or a General Manager drafts one
 * (`knowledge.playbook.draft`), or the platform does from a Teach session or a vault file; only a
 * person holding `knowledge.playbook.approve` approves it, and no agent principal holds either
 * grant (SECURITY §3.3).
 */
export const playbookDirectiveMachine = defineMachine<
  PlaybookDirectiveState,
  PlaybookDirectiveEvent,
  PlaybookDirectiveRecord,
  PlaybookDirectiveParams
>({
  name: 'playbook_directive',
  title: 'Playbook directive',
  summary: '`playbook_directives.state`. Only approved directives steer the agents.',
  sources: [
    'BLUEPRINT §9.1, §19 item 2',
    'PRD AI-01',
    'DATABASE §6.9 `playbook_directives`',
    'docs/03-roadmap-appendix/phase2.md §5.4',
  ],
  states: PLAYBOOK_DIRECTIVE_STATES,
  initial: 'draft',
  terminal: ['retired'],
  stored: { table: 'playbook_directives', stateColumn: 'state' },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'knowledge.playbook.draft',
      scope: 'all',
      system: true,
      effects: [{ key: 'check_conflicts', description: 'run the conflict check on the wording' }],
      emits: 'knowledge.playbook.changed',
      note: 'Drafted by an Executive or a General Manager, or extracted by the Knowledge Brain from a Teach session or a vault file (the platform).',
    },
    {
      from: ['draft'],
      event: 'edit',
      to: 'draft',
      permission: 'knowledge.playbook.draft',
      scope: 'all',
      effects: [
        {
          key: 'check_conflicts',
          description: 'clear `conflicts_with` and run the conflict check again',
        },
      ],
      emits: 'knowledge.playbook.changed',
    },
    {
      from: ['draft'],
      event: 'approve',
      to: 'approved',
      permission: 'knowledge.playbook.approve',
      scope: 'all',
      guard: allOf(checkRan, noConflict),
      effects: [
        { key: 'set_approver', description: 'set `approved_by` and `approved_at`' },
        {
          key: 'recheck_drafts',
          description: 'drafts of the same type whose companies overlap are checked again',
        },
        RELOAD,
      ],
      emits: 'knowledge.playbook.changed',
    },
    {
      from: ['draft'],
      event: 'retire',
      to: 'retired',
      permission: 'knowledge.playbook.draft',
      scope: 'all',
      guard: reasonGiven(),
      effects: [{ key: 'set_retired', description: 'set `retired_reason` and `retired_at`' }],
      emits: 'knowledge.playbook.changed',
      note: 'A draft that will not be approved.',
    },
    {
      from: ['approved'],
      event: 'retire',
      to: 'retired',
      permission: 'knowledge.playbook.approve',
      scope: 'all',
      guard: reasonGiven(),
      effects: [
        { key: 'set_retired', description: 'set `retired_reason` and `retired_at`' },
        {
          key: 'settle_conflicts',
          description: 'open conflicts naming it are resolved as `other_retired`',
        },
        RELOAD,
      ],
      emits: 'knowledge.playbook.changed',
    },
  ],
});
