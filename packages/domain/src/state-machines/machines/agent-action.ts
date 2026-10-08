import { AGENT_ACTION_STATES, type AgentActionState } from '@shakti/contracts';
import { defineMachine } from '../define-machine';

export type AgentActionEvent = 'propose' | 'execute' | 'approve' | 'reject' | 'dismiss';

export interface AgentActionRecord {
  state: AgentActionState | null;
}

/**
 * An action an agent proposed or took (docs/03-roadmap-appendix/phase1.md §7.1, BLUEPRINT §9.3). Suggest and
 * Needs approval file it as proposed, with an inbox item: a person approves (as it is, or edited)
 * or rejects a Needs approval one once, and dismisses a Suggest one, which they act on themselves.
 * Automatic files it and runs the command as the agent at once; it is not available in Phase 1.
 */
export const agentActionMachine = defineMachine<
  AgentActionState,
  AgentActionEvent,
  AgentActionRecord,
  Record<string, never>
>({
  name: 'agent_action',
  title: 'Agent action',
  summary:
    '`agent_actions.state`. What an agent proposed or did with one action type, the command it runs and its input; append-only except the decision, which the inbox commands record once.',
  sources: [
    'docs/03-roadmap-appendix/phase1.md §7.1',
    'BLUEPRINT §9.3',
    'PRD AI-04',
    'DATABASE §6.9',
  ],
  states: AGENT_ACTION_STATES,
  initial: 'proposed',
  terminal: ['executed', 'approved', 'rejected', 'dismissed'],
  stored: { table: 'agent_actions', stateColumn: 'state', changedAtColumn: 'decided_at' },
  transitions: [
    {
      from: 'new',
      event: 'propose',
      to: 'proposed',
      permission: null,
      permissionByInput: 'the permission of the command the action runs (`agents.run.record`)',
      note: 'Filed by the agent itself when its autonomy for the action type is Suggest or Needs approval and no kill switch is off; an inbox item comes with it.',
    },
    {
      from: ['proposed'],
      event: 'execute',
      to: 'executed',
      permission: null,
      permissionByInput: 'the permission of the command the action runs (`agents.run.record`)',
      note: 'At once, in the same run, when the autonomy is Automatic and no kill switch is off: the command runs as the agent, under the agent’s own permissions. Not in Phase 1: Automatic is refused until Phase 6, and a stored Automatic files a Needs approval suggestion.',
    },
    {
      from: ['proposed'],
      event: 'approve',
      to: 'approved',
      permission: 'agents.inbox.act',
      note: 'Needs approval only: runs the command as the person who approves, under their own permissions, as it was proposed or with the fields its action type lets them change (`agents.inbox.edit`). Refused while a kill switch stops the agent.',
    },
    {
      from: ['proposed'],
      event: 'reject',
      to: 'rejected',
      permission: 'agents.inbox.act',
      note: 'Needs approval only: nothing runs.',
    },
    {
      from: ['proposed'],
      event: 'dismiss',
      to: 'dismissed',
      permission: 'agents.inbox.act',
      note: 'Suggest only: the person has acted on it themselves, or chooses not to; nothing runs.',
    },
  ],
});
