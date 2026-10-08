// The Agent Inbox's and the agents screen's reading of agents (docs/03-roadmap-appendix/phase1.md §7.1). Pure
// functions, so the screens and their tests share them; browser code, so no contracts values.

import type en from '../../messages/en.json';

/** An action type's name under `agents.actionTypes`. */
export type ActionTypeNameKey = keyof (typeof en)['agents']['actionTypes'];

/** An editable field's name under `agents.fields`. */
export type AgentFieldNameKey = keyof (typeof en)['agents']['fields'];

/**
 * The name key of each action type an agent may propose: every type of `AGENT_ACTION_TYPES` in the
 * domain (a test checks the two lists agree).
 */
export const ACTION_TYPE_NAMES: Readonly<Record<string, ActionTypeNameKey>> = {
  'crm.task.create': 'taskCreate',
};

/** The name key of an action type, or undefined for one this screen does not know yet. */
export function actionTypeName(type: string | null): ActionTypeNameKey | undefined {
  return type !== null && Object.hasOwn(ACTION_TYPE_NAMES, type)
    ? ACTION_TYPE_NAMES[type]
    : undefined;
}

/** A read-only input's name under `agents.inbox.summary`. */
export type AgentSummaryNameKey = keyof (typeof en)['agents']['inbox']['summary'];

const FIELD_NAMES: readonly AgentFieldNameKey[] = ['dueAt', 'title'];
const SUMMARY_NAMES: readonly AgentSummaryNameKey[] = ['assigneeId', 'kind'];

/** The name key of a read-only input, or undefined for one this screen does not know yet. */
export function agentSummaryName(name: string): AgentSummaryNameKey | undefined {
  return (SUMMARY_NAMES as readonly string[]).includes(name)
    ? (name as AgentSummaryNameKey)
    : undefined;
}

/** The name key of an editable field, or undefined for one this screen does not know yet. */
export function agentFieldName(name: string): AgentFieldNameKey | undefined {
  return (FIELD_NAMES as readonly string[]).includes(name)
    ? (name as AgentFieldNameKey)
    : undefined;
}

/** What a key press does on the inbox list, or undefined for a key it leaves alone. */
export type InboxKeyAction =
  'next' | 'previous' | 'approve' | 'edit' | 'reject' | 'open' | 'dismiss';

export function inboxKeyAction(event: {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): InboxKeyAction | undefined {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined;
  switch (event.key) {
    case 'j':
    case 'J':
    case 'ArrowDown':
      return 'next';
    case 'k':
    case 'K':
    case 'ArrowUp':
      return 'previous';
    case 'a':
    case 'A':
      return 'approve';
    case 'e':
    case 'E':
      return 'edit';
    case 'r':
    case 'R':
      return 'reject';
    case 'o':
    case 'O':
      return 'open';
    case 'd':
    case 'D':
      return 'dismiss';
    default:
      return undefined;
  }
}

/**
 * Rupees typed into the spending limit, as whole paise: digits with at most two after the point;
 * empty means no limit. Undefined for anything else.
 */
export function paiseFromRupees(typed: string): number | null | undefined {
  const value = typed.trim().replaceAll(',', '');
  if (value === '') return null;
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value);
  if (match === null) return undefined;
  const rupees = Number(match[1]);
  const paise = Number((match[2] ?? '').padEnd(2, '0'));
  return rupees * 100 + paise;
}

/** Whole paise as rupees for the limit's field: `500`, or `500.50`. */
export function rupeesFromPaise(paise: number | null): string {
  if (paise === null) return '';
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${String(rupees)}.${String(rest).padStart(2, '0')}`;
}

/** Whole paise as the money string the rupee formatter reads. */
export function moneyFromPaise(paise: number): string {
  return `${String(Math.floor(paise / 100))}.${String(paise % 100).padStart(2, '0')}`;
}
