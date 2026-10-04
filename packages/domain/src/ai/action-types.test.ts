import { AGENT_MATRIX, hasGrant, type PermissionKey } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_TYPES,
  applyEdits,
  AUTOMATIC_MIN_DECIDED,
  automaticEarned,
  editableFields,
} from './action-types';

// The actions an agent may propose or take: each runs a command the agent may run itself, never
// a command for people only, and a person may change only the fields its type names.

describe('AGENT_ACTION_TYPES', () => {
  it('names each type by its command, open to agents that hold its permission', () => {
    for (const [name, type] of Object.entries(AGENT_ACTION_TYPES)) {
      expect(type.command.name).toBe(name);
      expect(type.command.peopleOnly).not.toBe(true);
      expect(typeof type.command.permission).toBe('string');
      expect(type.agents.length).toBeGreaterThan(0);
      const permission = type.command.permission as PermissionKey;
      for (const agent of type.agents) {
        const holds = hasGrant(AGENT_MATRIX[agent], permission, type.command.minScope ?? 'own');
        expect({ agent, name, holds }).toEqual({ agent, name, holds: true });
      }
    }
  });
});

describe('applyEdits', () => {
  const type = AGENT_ACTION_TYPES['crm.task.create'];
  if (type === undefined) throw new Error('crm.task.create is an action type');
  const input = {
    entityId: 1,
    opportunityId: 'x',
    kind: 'follow_up',
    dueAt: '2031-01-01T10:00:00.000Z',
  };

  it('changes only the editable fields', () => {
    expect(
      applyEdits(type, input, { dueAt: '2031-01-02T09:30:00+05:30', title: ' Ask again ' }),
    ).toEqual({ ...input, dueAt: '2031-01-02T04:00:00.000Z', title: 'Ask again' });
    expect(() => applyEdits(type, input, { kind: 'callback' })).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'agent_field_not_editable' }) as unknown,
      }) as Error,
    );
    expect(() => applyEdits(type, input, { dueAt: 'tomorrow' })).toThrow();
  });

  it('removes a text cleared to nothing', () => {
    expect(applyEdits(type, { ...input, title: 'Old' }, { title: '' })).toEqual(input);
  });

  it('shows the fields with their values', () => {
    expect(editableFields(type, input)).toEqual([
      { name: 'dueAt', kind: 'date_time', value: input.dueAt, maxLength: null },
      { name: 'title', kind: 'text', value: null, maxLength: 80 },
    ]);
  });
});

describe('automaticEarned', () => {
  it('needs 200 decided suggestions, 95% approved unedited', () => {
    expect(automaticEarned(AUTOMATIC_MIN_DECIDED, 190)).toBe(true);
    expect(automaticEarned(AUTOMATIC_MIN_DECIDED, 189)).toBe(false);
    expect(automaticEarned(AUTOMATIC_MIN_DECIDED - 1, AUTOMATIC_MIN_DECIDED - 1)).toBe(false);
    expect(automaticEarned(0, 0)).toBe(false);
  });
});
