import {
  DomainError,
  type AgentAutonomy,
  type AgentRoleKey,
  type InboxFieldDto,
  type InboxSubjectType,
} from '@shakti/contracts';
import type { AnyCommand } from '../command/define-command';
import { createTask } from '../commands/crm/tasks';

// The actions an agent may propose or take (docs/design/phase1.md §7.1). An action type is the name
// of the command the action runs: approving it runs that command as the person who approves, and
// Automatic runs it as the agent. A command joins this list with the slice whose agent needs it
// (A1 adds the Triage agent's); each agent named here must hold the command's permission itself,
// and none is a command for people only (`action-types.test.ts`).

/** A field of a suggestion a person may change before approving it (`agents.inbox.edit`). */
export interface EditableField {
  name: string;
  kind: InboxFieldDto['kind'];
  /** For text: the longest value the command accepts, which the edit form keeps to. */
  maxLength?: number;
}

export interface AgentActionType {
  /** The command the action runs; its name is the action type's. */
  command: AnyCommand;
  /** The agents that may propose or take it. */
  agents: readonly AgentRoleKey[];
  /** What an inbox item for it is about. */
  subjectType: InboxSubjectType;
  /** The input key holding the subject's id. */
  subjectKey: string;
  editable: readonly EditableField[];
}

export const AGENT_ACTION_TYPES: Readonly<Record<string, AgentActionType>> = {
  // A follow-up on a lead (the Caller Co-pilot's follow-up tasks, SECURITY §3.3).
  'crm.task.create': {
    command: createTask,
    agents: ['agent:copilot'],
    subjectType: 'opportunity',
    subjectKey: 'opportunityId',
    editable: [
      { name: 'dueAt', kind: 'date_time' },
      { name: 'title', kind: 'text', maxLength: 80 },
    ],
  },
};

/** The action type, or `validation_failed` with `agent_action_unknown`. */
export function actionTypeOf(name: string): AgentActionType {
  const found = Object.hasOwn(AGENT_ACTION_TYPES, name) ? AGENT_ACTION_TYPES[name] : undefined;
  if (found === undefined) {
    throw new DomainError('validation_failed', `no agent action type ${name}`, {
      reason: 'agent_action_unknown',
    });
  }
  return found;
}

/** The editable fields of an action's input, as the inbox shows them. */
export function editableFields(
  type: AgentActionType,
  input: Readonly<Record<string, unknown>>,
): InboxFieldDto[] {
  return type.editable.map((field) => {
    const value = input[field.name];
    return {
      name: field.name,
      kind: field.kind,
      value: typeof value === 'string' ? value : null,
      maxLength: field.maxLength ?? null,
    };
  });
}

/**
 * The input with a person's changes applied: only the editable fields, each a value of its kind.
 * The command the action runs checks the result again.
 */
export function applyEdits(
  type: AgentActionType,
  input: Readonly<Record<string, unknown>>,
  changes: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const cleared = new Set<string>();
  for (const [name, raw] of Object.entries(changes)) {
    const field = type.editable.find((f) => f.name === name);
    if (field === undefined) {
      throw new DomainError('validation_failed', `${name} cannot be changed`, {
        reason: 'agent_field_not_editable',
        issues: [{ path: `changes.${name}`, message: 'agent_field_not_editable' }],
      });
    }
    const value = raw.trim();
    if (field.kind === 'date_time') {
      if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
        throw new DomainError('validation_failed', `${name} is not a time`, {
          issues: [{ path: `changes.${name}`, message: 'invalid' }],
        });
      }
      out[name] = new Date(value).toISOString();
    } else if (value === '') {
      cleared.add(name);
    } else {
      out[name] = value;
    }
  }
  return Object.fromEntries(Object.entries(out).filter(([key]) => !cleared.has(key)));
}

/** The record a change to Automatic needs (BLUEPRINT §9.3, SECURITY §6, PRD AI-04). */
export const AUTOMATIC_MIN_DECIDED = 200;
export const AUTOMATIC_MIN_UNEDITED_SHARE = 0.95;

/** Whether an action type's decisions so far allow Automatic. */
export function automaticEarned(decided: number, approvedUnedited: number): boolean {
  return (
    decided >= AUTOMATIC_MIN_DECIDED && approvedUnedited >= AUTOMATIC_MIN_UNEDITED_SHARE * decided
  );
}

/** The autonomy that applies when no setting names one: the agent only suggests. */
export const DEFAULT_AUTONOMY: AgentAutonomy = 'suggest';
