import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PLAYBOOK_DIRECTIVE_STATES = ['draft', 'approved', 'retired'] as const;
export type PlaybookDirectiveState = (typeof PLAYBOOK_DIRECTIVE_STATES)[number];
export type PlaybookDirectiveEvent = 'create' | 'edit' | 'approve' | 'retire';

export interface PlaybookDirectiveRecord {
  state: PlaybookDirectiveState | null;
  /** `conflicts_with`: approved directives this draft contradicts, not yet resolved. */
  conflictsWith: readonly string[];
}

export interface PlaybookDirectiveParams {
  reason?: string | null;
}

type G = Guard<PlaybookDirectiveRecord, PlaybookDirectiveParams>;

const noConflict: G = {
  description: 'no unresolved conflict with an approved directive (`conflicts_with` is empty)',
  check: (record) =>
    record.conflictsWith.length === 0
      ? undefined
      : { code: 'conflict', reason: 'directive_conflict' },
};

/**
 * Playbook directive (BLUEPRINT §9.1, PRD AI-01): rules Executives teach the Knowledge Brain. An
 * agent may draft one; only a person holding `knowledge.playbook.approve` approves it, and no
 * agent principal may hold that permission (SECURITY §3.3).
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
  sources: ['BLUEPRINT §9.1, §19 item 2', 'PRD AI-01', 'DATABASE §6.9 `playbook_directives`'],
  states: PLAYBOOK_DIRECTIVE_STATES,
  initial: 'draft',
  terminal: ['retired'],
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'knowledge.playbook.approve',
      system: true,
      note: 'Drafted by an Executive, or extracted by the Knowledge Brain from a Teach session or upload (the platform).',
    },
    {
      from: ['draft'],
      event: 'edit',
      to: 'draft',
      permission: 'knowledge.playbook.approve',
      effects: [{ key: 'recheck_conflicts', description: 'recompute `conflicts_with`' }],
      proposed: true,
    },
    {
      from: ['draft'],
      event: 'approve',
      to: 'approved',
      permission: 'knowledge.playbook.approve',
      guard: noConflict,
      effects: [
        { key: 'set_approver', description: 'set `approved_by`' },
        { key: 'emit', description: 'event so the agents reload their directives' },
      ],
    },
    {
      from: ['draft', 'approved'],
      event: 'retire',
      to: 'retired',
      permission: 'knowledge.playbook.approve',
      guard: reasonGiven(),
      effects: [{ key: 'emit', description: 'event so the agents reload their directives' }],
    },
  ],
});
