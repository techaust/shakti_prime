import { describe, expect, it } from 'vitest';
import {
  allOf,
  defineMachine,
  reasonGiven,
  transition,
  type Guard,
  type MachineSpec,
} from './define-machine';
import { everything, holding, platform } from './test-support';

type S = 'a' | 'b' | 'c';
type E = 'make' | 'go' | 'finish' | 'tick';
interface R {
  state: S | null;
  ok: boolean;
}
interface P {
  reason?: string | null;
}

const okGuard: Guard<R, P> = {
  description: 'the record is ok',
  check: (record) => (record.ok ? undefined : { code: 'conflict', reason: 'not_ok' }),
};

function spec(over: Partial<MachineSpec<S, E, R, P>> = {}): MachineSpec<S, E, R, P> {
  return {
    name: 'toy',
    title: 'Toy',
    summary: 'A toy machine.',
    sources: [],
    states: ['a', 'b', 'c'],
    initial: 'a',
    terminal: ['c'],
    transitions: [
      { from: 'new', event: 'make', to: 'a', permission: 'crm.lead.write' },
      { from: ['a'], event: 'go', to: 'b', permission: 'crm.lead.write', guard: okGuard },
      {
        from: ['a', 'b'],
        event: 'finish',
        to: 'c',
        permission: 'crm.lead.assign',
        scope: 'team',
        system: true,
        effects: [{ key: 'bell', description: 'ring the bell' }],
      },
      { from: ['b'], event: 'tick', to: 'b', permission: null, system: true },
    ],
    ...over,
  };
}

const toy = defineMachine(spec());
const now = new Date('2026-06-01T00:00:00Z');

describe('defineMachine', () => {
  it('lists the events and the illegal-move reason', () => {
    expect(toy.events).toEqual(['make', 'go', 'finish', 'tick']);
    expect(toy.illegalReason).toBe('toy_transition_not_allowed');
  });

  it.each<[string, Partial<MachineSpec<S, E, R, P>>, RegExp]>([
    ['a name that is not snake_case', { name: 'Toy-Machine' }, /snake_case/],
    ['a duplicate state', { states: ['a', 'b', 'c', 'a'] }, /duplicate state/],
    ['an initial state outside the list', { initial: 'z' as S }, /initial state/],
    [
      'a target outside the list',
      { transitions: [{ from: ['a'], event: 'go', to: 'z' as S, permission: 'crm.lead.write' }] },
      /unknown state z/,
    ],
    [
      'two transitions for one event from one state',
      {
        transitions: [
          { from: 'new', event: 'make', to: 'a', permission: 'crm.lead.write' },
          { from: ['a'], event: 'go', to: 'b', permission: 'crm.lead.write' },
          { from: ['a'], event: 'go', to: 'c', permission: 'crm.lead.write' },
          { from: ['b'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
        ],
      },
      /two transitions for go from a/,
    ],
    [
      'a creation event outside the initial state',
      { transitions: [{ from: 'new', event: 'make', to: 'b', permission: 'crm.lead.write' }] },
      /creates the record outside a/,
    ],
    [
      'an event nobody may fire',
      {
        transitions: [
          { from: ['a'], event: 'go', to: 'b', permission: null },
          { from: ['b'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
        ],
      },
      /not fired by the platform/,
    ],
    [
      'a new permission that already exists',
      {
        transitions: [
          {
            from: ['a'],
            event: 'go',
            to: 'b',
            permission: 'crm.lead.write',
            newPermission: 'crm.lead.read',
          },
          { from: ['b'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
        ],
      },
      /already exists/,
    ],
    [
      'a way out of a terminal state',
      {
        transitions: [
          { from: ['a'], event: 'go', to: 'b', permission: 'crm.lead.write' },
          { from: ['b'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
          { from: ['c'], event: 'tick', to: 'a', permission: 'crm.lead.write' },
        ],
      },
      /leaves terminal state c/,
    ],
    [
      'a dead end that is not terminal',
      {
        transitions: [
          { from: ['a'], event: 'go', to: 'b', permission: 'crm.lead.write' },
          { from: ['a'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
        ],
      },
      /b is not terminal but has no way out/,
    ],
    [
      'an unreachable state',
      {
        transitions: [
          { from: ['a'], event: 'finish', to: 'c', permission: 'crm.lead.write' },
          { from: ['b'], event: 'go', to: 'c', permission: 'crm.lead.write' },
        ],
      },
      /b is unreachable/,
    ],
  ])('refuses %s', (_label, over, message) => {
    expect(() => defineMachine(spec(over))).toThrow(message);
  });
});

describe('transition', () => {
  it('creates a record from nothing with the creation event only', () => {
    expect(
      transition(toy, { state: null, ok: true }, 'make', { actor: everything(), now, params: {} }),
    ).toEqual({
      from: null,
      to: 'a',
      event: 'make',
      effects: [],
    });
    expect(() =>
      transition(toy, { state: null, ok: true }, 'go', { actor: everything(), now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'conflict' }));
    expect(() =>
      transition(toy, { state: 'a', ok: true }, 'make', { actor: everything(), now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'conflict' }));
  });

  it('returns the target and the effects', () => {
    expect(
      transition(toy, { state: 'b', ok: true }, 'finish', { actor: everything(), now, params: {} }),
    ).toEqual({
      from: 'b',
      to: 'c',
      event: 'finish',
      effects: [{ key: 'bell', description: 'ring the bell' }],
    });
  });

  it('answers conflict with the machine reason for an illegal move', () => {
    expect(() =>
      transition(toy, { state: 'c', ok: true }, 'go', { actor: everything(), now, params: {} }),
    ).toThrow(
      expect.objectContaining({
        code: 'conflict',
        details: { reason: 'toy_transition_not_allowed', state: 'c', event: 'go' },
      }),
    );
  });

  it('checks the permission and its scope', () => {
    const own = holding([{ key: 'crm.lead.assign', scope: 'own' }]);
    const team = holding([{ key: 'crm.lead.assign', scope: 'team' }]);
    expect(() =>
      transition(toy, { state: 'a', ok: true }, 'finish', { actor: own, now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(
      transition(toy, { state: 'a', ok: true }, 'finish', { actor: team, now, params: {} }).to,
    ).toBe('c');
  });

  it('lets the platform fire only the events marked for it', () => {
    expect(
      transition(toy, { state: 'b', ok: true }, 'tick', { actor: platform, now, params: {} }).to,
    ).toBe('b');
    expect(
      transition(toy, { state: 'a', ok: true }, 'finish', { actor: platform, now, params: {} }).to,
    ).toBe('c');
    expect(() =>
      transition(toy, { state: 'a', ok: true }, 'go', { actor: platform, now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it('refuses a person an event only the platform fires', () => {
    expect(() =>
      transition(toy, { state: 'b', ok: true }, 'tick', { actor: everything(), now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });

  it("answers a guard's own code and reason", () => {
    expect(() =>
      transition(toy, { state: 'a', ok: false }, 'go', { actor: everything(), now, params: {} }),
    ).toThrow(expect.objectContaining({ code: 'conflict', details: { reason: 'not_ok' } }));
  });
});

describe('guard helpers', () => {
  const ctx = (reason?: string | null) => ({
    actor: everything(),
    now,
    params: reason === undefined ? {} : { reason },
  });

  it('reasonGiven wants a non-blank reason', () => {
    const guard = reasonGiven<R, P>();
    expect(guard.check({ state: 'a', ok: true }, ctx('customer changed plans'))).toBeUndefined();
    for (const blank of [undefined, null, '', '   ']) {
      expect(guard.check({ state: 'a', ok: true }, ctx(blank))).toEqual({
        code: 'validation_failed',
        reason: 'transition_reason_missing',
      });
    }
  });

  it('allOf stops at the first refusal and joins the descriptions', () => {
    const both = allOf(okGuard, reasonGiven<R, P>());
    expect(both.description).toBe('the record is ok; a reason is given');
    expect(both.check({ state: 'a', ok: false }, ctx(null))).toMatchObject({ reason: 'not_ok' });
    expect(both.check({ state: 'a', ok: true }, ctx(null))).toMatchObject({
      reason: 'transition_reason_missing',
    });
    expect(both.check({ state: 'a', ok: true }, ctx('why'))).toBeUndefined();
  });
});
