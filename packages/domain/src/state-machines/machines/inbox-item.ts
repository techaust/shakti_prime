import { INBOX_ITEM_STATES, type InboxItemState } from '@shakti/contracts';
import { defineMachine } from '../define-machine';

export type InboxItemEvent = 'file' | 'decide';

export interface InboxItemRecord {
  state: InboxItemState | null;
}

/**
 * An item of a person's Agent Inbox (docs/design/phase1.md §7.1): open until someone it is for
 * decides on it. An agent's suggestion is done when it is approved, edited, rejected or dismissed.
 */
export const inboxItemMachine = defineMachine<
  InboxItemState,
  InboxItemEvent,
  InboxItemRecord,
  Record<string, never>
>({
  name: 'inbox_item',
  title: 'Inbox item',
  summary:
    '`inbox_items.state`. An agent’s suggestion, or work routed to someone, in the Agent Inbox of the person, team or company it is for; scope follows `agents.inbox.act` with the assignee as the owner.',
  sources: ['docs/design/phase1.md §7.1', 'PRD AI-04', 'DATABASE §6.9'],
  states: INBOX_ITEM_STATES,
  initial: 'open',
  terminal: ['done'],
  stored: { table: 'inbox_items', stateColumn: 'state', changedAtColumn: 'done_at' },
  transitions: [
    {
      from: 'new',
      event: 'file',
      to: 'open',
      permission: null,
      permissionByInput: 'the permission of the command the suggestion runs (`agents.run.record`)',
      note: 'Filed by an agent with the action it proposes; only an agent files one in Phase 1.',
    },
    {
      from: ['open'],
      event: 'decide',
      to: 'done',
      permission: 'agents.inbox.act',
      note: 'With the decision on its action: approved, edited, rejected or dismissed.',
    },
  ],
});
