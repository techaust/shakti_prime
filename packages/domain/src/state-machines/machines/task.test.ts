import { describe, expect, it } from 'vitest';
import { transition } from '../define-machine';
import { everything, holding, platform } from '../test-support';
import { taskMachine } from './task';

const now = new Date('2026-10-01T10:00:00Z');
const actor = everything();
const at = (ms: number) => new Date(now.getTime() + ms);

describe('the task machine', () => {
  it('creates an open task due now or later, with a minute of grace', () => {
    for (const dueAt of [now, at(3_600_000), at(-60_000)]) {
      expect(
        transition(taskMachine, { state: null }, 'create', { actor, now, params: { dueAt } }).to,
      ).toBe('open');
    }
  });

  it('refuses a due time more than a minute past, or none at all', () => {
    for (const params of [{ dueAt: at(-60_001) }, {}]) {
      expect(() =>
        transition(taskMachine, { state: 'open' }, 'reschedule', { actor, now, params }),
      ).toThrow(expect.objectContaining({ details: { reason: 'task_due_in_past' } }));
    }
  });

  it('completes, reschedules and cancels an open task only', () => {
    expect(
      transition(taskMachine, { state: 'open' }, 'complete', { actor, now, params: {} }).to,
    ).toBe('done');
    expect(
      transition(taskMachine, { state: 'open' }, 'cancel', { actor, now, params: {} }).to,
    ).toBe('cancelled');
    for (const state of ['done', 'cancelled'] as const) {
      for (const event of ['complete', 'cancel', 'reschedule'] as const) {
        expect(() =>
          transition(taskMachine, { state }, event, { actor, now, params: { dueAt: at(1) } }),
        ).toThrow(
          expect.objectContaining({
            details: expect.objectContaining({ reason: 'task_transition_not_allowed' }) as unknown,
          }),
        );
      }
    }
  });

  it('needs crm.lead.write, and a person', () => {
    const reader = holding([{ key: 'crm.lead.read', scope: 'entity' }]);
    expect(() =>
      transition(taskMachine, { state: 'open' }, 'complete', { actor: reader, now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() =>
      transition(taskMachine, { state: 'open' }, 'complete', { actor: platform, now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });
});
