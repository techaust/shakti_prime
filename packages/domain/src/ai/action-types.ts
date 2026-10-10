import {
  AGENT_PRINCIPAL_IDS,
  DomainError,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  TRIAGE_ACTION_TYPES,
  TriagePipelineProposalInput,
  TriageScoreProposalInput,
  type AgentAutonomy,
  type AgentRoleKey,
  type InboxFieldDto,
  type InboxSubjectType,
  type InboxSummaryDto,
} from '@shakti/contracts';
import type { z } from 'zod';
import type { AnyCommand, Requirement } from '../command/define-command';
import { suggestDuplicate } from '../commands/crm/duplicates';
import { assignOpportunity } from '../commands/crm/assign-opportunity';
import { createTask } from '../commands/crm/tasks';
import { AGENT_DEFAULTS } from './agent-defaults';

// The actions an agent may propose or take (docs/03-roadmap-appendix/phase1.md §7.1, §9). An action
// type is the name of the command the action runs: approving it runs that command as the person who
// approves, and Automatic (not in Phase 1) runs it as the agent. A shadow-only kind runs no command
// (no command moves a lead between pipelines or changes a score by hand): it is only ever recorded
// in Shadow, whatever autonomy is set. Each agent named here must hold the permissions the action
// needs itself, and none is a command for people only (`action-types.test.ts`).

/** A field of a suggestion a person may change before approving it (`agents.inbox.edit`). */
export interface EditableField {
  name: string;
  kind: InboxFieldDto['kind'];
  /** For text: the longest value the command accepts, which the edit form keeps to. */
  maxLength?: number;
}

/** An input that changes the outcome and that a person cannot change: shown read-only. */
export interface SummaryField {
  name: string;
  kind: InboxSummaryDto['kind'];
}

export interface AgentActionType {
  /** The action type: the command's name, or a shadow-only kind's own. */
  name: string;
  /** The command the action runs; undefined for a shadow-only kind, which never runs. */
  command: AnyCommand | undefined;
  /** What a proposal's input must be: the command's input, or the shadow-only kind's. */
  input: z.ZodType;
  /** The permissions the agent itself must hold to propose it, the first the command's own. */
  requirements: readonly [Requirement, ...Requirement[]];
  /** The agents that may propose or take it. */
  agents: readonly AgentRoleKey[];
  /** What an inbox item for it is about. */
  subjectType: InboxSubjectType;
  /** The input key holding the subject's id. */
  subjectKey: string;
  /**
   * The input key naming the person the work is for, when the command has one: filled from the
   * proposal's assignee when the agent leaves it out, required, and never an agent or the workers.
   */
  assigneeKey?: string;
  /** Every other input that changes the outcome, shown read-only on the inbox card. */
  summary: readonly SummaryField[];
  editable: readonly EditableField[];
}

type Details = Omit<AgentActionType, 'name' | 'command' | 'input' | 'requirements'>;

/** An action type that runs a command: named by it, with its input and its permissions. */
function commanded(command: AnyCommand, details: Details): AgentActionType {
  const permission = command.permission;
  if (typeof permission !== 'string') {
    throw new DomainError('internal', `${command.name} names its permission by input`);
  }
  return {
    name: command.name,
    command,
    input: command.input,
    requirements: [
      { permission, minScope: command.minScope ?? 'own' },
      ...(command.alsoRequires ?? []),
    ],
    ...details,
  };
}

/** A shadow-only kind: recorded in Shadow under the permission it names, never run. */
function shadowOnly(
  name: string,
  input: z.ZodType,
  requirement: Requirement,
  details: Details,
): AgentActionType {
  return { name, command: undefined, input, requirements: [requirement], ...details };
}

/** The Triage agent's proposals are about a lead and are for nobody in particular. */
const ABOUT_A_LEAD = { subjectType: 'opportunity', subjectKey: 'opportunityId' } as const;

export const AGENT_ACTION_TYPES: Readonly<Record<string, AgentActionType>> = Object.fromEntries(
  [
    // A follow-up on a lead (the Caller Co-pilot's follow-up tasks, SECURITY §3.3).
    commanded(createTask, {
      agents: ['agent:copilot'],
      subjectType: 'opportunity',
      subjectKey: 'opportunityId',
      assigneeKey: 'assigneeId',
      summary: [
        { name: 'assigneeId', kind: 'person' },
        { name: 'kind', kind: 'code' },
      ],
      editable: [
        { name: 'dueAt', kind: 'date_time' },
        { name: 'title', kind: 'text', maxLength: 80 },
      ],
    }),
    // The Triage agent (A1, SECURITY §3.3): who should take a new lead, among the people of the
    // company who work on leads. The item, under Suggest or Needs approval, is for whoever acts
    // on the company's inbox, never the person proposed.
    commanded(assignOpportunity, {
      agents: ['agent:triage'],
      ...ABOUT_A_LEAD,
      summary: [{ name: 'ownerId', kind: 'person' }],
      editable: [],
    }),
    // Two open leads of one customer and segment that D1 already put forward, which the agent
    // would link as one enquiry.
    commanded(suggestDuplicate, {
      agents: ['agent:triage'],
      ...ABOUT_A_LEAD,
      summary: [],
      editable: [],
    }),
    shadowOnly(
      TRIAGE_ACTION_TYPES.pipeline,
      TriagePipelineProposalInput,
      { permission: 'crm.lead.write', minScope: 'entity' },
      { agents: ['agent:triage'], ...ABOUT_A_LEAD, summary: [], editable: [] },
    ),
    shadowOnly(
      TRIAGE_ACTION_TYPES.score,
      TriageScoreProposalInput,
      { permission: 'crm.lead.write', minScope: 'entity' },
      { agents: ['agent:triage'], ...ABOUT_A_LEAD, summary: [], editable: [] },
    ),
  ].map((t) => [t.name, t]),
);

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

/** Whether an action type is only ever recorded in Shadow (it runs no command). */
export function isShadowOnly(name: string): boolean {
  return Object.hasOwn(AGENT_ACTION_TYPES, name) && AGENT_ACTION_TYPES[name]?.command === undefined;
}

/** The principals no work may be for: the agents and the event workers. */
const SERVICE_PRINCIPALS: ReadonlySet<string> = new Set([
  ...Object.values(AGENT_PRINCIPAL_IDS),
  SYSTEM_WORKERS_PRINCIPAL_ID,
]);

/**
 * The proposal's input with the person the work is for filled in from the inbox item's assignee
 * when the agent left it out. Undefined when the action type names such a person and nobody is
 * named, the two differ, or a service principal is named (`agent_proposal_invalid`).
 */
export function withAssignee(
  type: AgentActionType,
  input: Readonly<Record<string, unknown>>,
  itemAssigneeId: string | undefined,
): Record<string, unknown> | undefined {
  const key = type.assigneeKey;
  if (key === undefined) return { ...input };
  const named = input[key];
  if (named !== undefined && typeof named !== 'string') return undefined;
  if (named !== undefined && itemAssigneeId !== undefined && named !== itemAssigneeId) {
    return undefined;
  }
  const assignee = named ?? itemAssigneeId;
  if (assignee === undefined || SERVICE_PRINCIPALS.has(assignee)) return undefined;
  return { ...input, [key]: assignee };
}

/** The read-only inputs of an action, as the inbox shows them; `names` holds people's names. */
export function summaryFields(
  type: AgentActionType,
  input: Readonly<Record<string, unknown>>,
  names: ReadonlyMap<string, string>,
): InboxSummaryDto[] {
  return type.summary.map((field) => {
    const raw = input[field.name];
    const value = typeof raw === 'string' && raw.length <= 64 ? raw : null;
    return {
      name: field.name,
      kind: field.kind,
      value,
      label: field.kind === 'person' && value !== null ? (names.get(value) ?? null) : null,
    };
  });
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

/** A time with its date, its hour and minute, and its offset from UTC (`Z` or `+05:30`). */
const TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * The input with a person's changes applied: only the editable fields, each a value of its kind,
 * a time only with its offset. The command the action runs checks the result again.
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
      if (!TIME_WITH_OFFSET.test(value) || Number.isNaN(Date.parse(value))) {
        throw new DomainError('validation_failed', `${name} is not a time with its offset`, {
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

/** Whether two values of a field are the same: times as instants, text as written. */
function sameValue(field: EditableField, a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (field.kind === 'date_time' && typeof a === 'string' && typeof b === 'string') {
    return Date.parse(a) === Date.parse(b);
  }
  return a === b;
}

/** Whether a person's edit changed any editable field of the proposed input. */
export function wasEdited(
  type: AgentActionType,
  proposed: Readonly<Record<string, unknown>>,
  decided: Readonly<Record<string, unknown>>,
): boolean {
  return type.editable.some((f) => !sameValue(f, proposed[f.name], decided[f.name]));
}

/** Whether Automatic may be set at all yet (`AGENT_DEFAULTS.automaticAvailable`). */
export const AUTOMATIC_AVAILABLE: boolean = AGENT_DEFAULTS.automaticAvailable;

/**
 * Whether an action type's record in one company allows Automatic under the promotion rule
 * (`AGENT_DEFAULTS.promotion`): enough Needs approval decisions in the window, and enough of them
 * approved without an edit.
 */
export function automaticEarned(decided: number, approvedUnedited: number): boolean {
  const rule = AGENT_DEFAULTS.promotion;
  return decided >= rule.minDecided && approvedUnedited >= rule.minUneditedShare * decided;
}

/** The autonomy that applies when no setting names one: the agent only suggests. */
export const DEFAULT_AUTONOMY: AgentAutonomy = 'suggest';

/**
 * The autonomy an agent starts at when no setting names one (`AGENT_DEFAULTS.startingAutonomy`):
 * the Triage agent in Shadow, every other agent at Suggest.
 */
export function startingAutonomy(agent: AgentRoleKey): AgentAutonomy {
  const starting: Partial<Record<AgentRoleKey, AgentAutonomy>> = AGENT_DEFAULTS.startingAutonomy;
  return starting[agent] ?? DEFAULT_AUTONOMY;
}
