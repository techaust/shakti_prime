import {
  AGENT_MATRIX,
  AGENT_PRINCIPAL_IDS,
  hasGrant,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type PermissionKey,
} from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_TYPES,
  applyEdits,
  AUTOMATIC_AVAILABLE,
  automaticEarned,
  editableFields,
  summaryFields,
  wasEdited,
  withAssignee,
} from './action-types';
import { AGENT_DEFAULTS } from './agent-defaults';

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

  it('takes a time only with its offset', () => {
    for (const time of ['2031-01-02T09:30', '2031-01-02T09:30:00', '2031-01-02 09:30:00Z']) {
      expect(() => applyEdits(type, input, { dueAt: time })).toThrow(
        expect.objectContaining({ code: 'validation_failed' }) as Error,
      );
    }
    expect(applyEdits(type, input, { dueAt: '2031-01-02T09:30Z' }).dueAt).toBe(
      '2031-01-02T09:30:00.000Z',
    );
  });

  it('counts an edit as one only when a field changed, times compared as instants', () => {
    const proposed = { ...input, dueAt: '2031-01-01T15:30:00+05:30', title: 'Ask' };
    // The same moment written another way, and the same note: unedited.
    const same = applyEdits(type, proposed, { dueAt: '2031-01-01T10:00:00.000Z', title: 'Ask' });
    expect(wasEdited(type, proposed, same)).toBe(false);
    expect(wasEdited(type, proposed, applyEdits(type, proposed, {}))).toBe(false);
    expect(wasEdited(type, proposed, applyEdits(type, proposed, { title: 'Ask again' }))).toBe(
      true,
    );
    expect(
      wasEdited(type, proposed, applyEdits(type, proposed, { dueAt: '2031-01-01T10:01:00Z' })),
    ).toBe(true);
    expect(wasEdited(type, proposed, applyEdits(type, proposed, { title: '' }))).toBe(true);
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

describe('withAssignee and summaryFields', () => {
  const type = AGENT_ACTION_TYPES['crm.task.create'];
  if (type === undefined) throw new Error('crm.task.create is an action type');
  const person = '0199e2e0-0000-7000-8000-0000000000aa';
  const input = { entityId: 1, opportunityId: 'x', kind: 'follow_up', dueAt: 'soon' };

  it('fills the person a task is for from the inbox item, or requires one', () => {
    expect(withAssignee(type, input, person)).toEqual({ ...input, assigneeId: person });
    expect(withAssignee(type, { ...input, assigneeId: person }, undefined)).toEqual({
      ...input,
      assigneeId: person,
    });
    expect(withAssignee(type, input, undefined)).toBeUndefined();
    // The task and its inbox item name different people.
    expect(
      withAssignee(type, { ...input, assigneeId: person }, AGENT_PRINCIPAL_IDS['agent:triage']),
    ).toBeUndefined();
  });

  it('never gives a task to an agent or to the workers', () => {
    for (const service of [AGENT_PRINCIPAL_IDS['agent:copilot'], SYSTEM_WORKERS_PRINCIPAL_ID]) {
      expect(withAssignee(type, input, service)).toBeUndefined();
      expect(withAssignee(type, { ...input, assigneeId: service }, undefined)).toBeUndefined();
    }
  });

  it('shows who the task is for and its kind, read-only', () => {
    expect(
      summaryFields(type, { ...input, assigneeId: person }, new Map([[person, 'Neha Saini']])),
    ).toEqual([
      { name: 'assigneeId', kind: 'person', value: person, label: 'Neha Saini' },
      { name: 'kind', kind: 'code', value: 'follow_up', label: null },
    ]);
  });
});

describe('the promotion rule', () => {
  it('is not available in Phase 1', () => {
    expect(AUTOMATIC_AVAILABLE).toBe(false);
  });

  it('needs 200 decisions in its window, 95% approved unedited', () => {
    const { minDecided } = AGENT_DEFAULTS.promotion;
    expect(AGENT_DEFAULTS.promotion).toMatchObject({
      minDecided: 200,
      minUneditedShare: 0.95,
      windowDays: 90,
      countedAutonomy: 'needs_approval',
    });
    expect(automaticEarned(minDecided, 190)).toBe(true);
    expect(automaticEarned(minDecided, 189)).toBe(false);
    expect(automaticEarned(minDecided - 1, minDecided - 1)).toBe(false);
    expect(automaticEarned(0, 0)).toBe(false);
  });
});
