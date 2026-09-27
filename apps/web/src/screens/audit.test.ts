import { AuditQueryInput } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import {
  ACTION_FILTERS,
  actionKey,
  auditChanges,
  auditWindow,
  defaultWindow,
  istToday,
  wordsOf,
} from './audit';

describe('the Activity log window', () => {
  it('opens on the last seven days in India, today included', () => {
    // 20:00 UTC on the 27th is already the 28th in India.
    const now = new Date('2026-09-27T20:00:00Z');
    expect(istToday(now)).toBe('2026-09-28');
    expect(defaultWindow(now)).toEqual({ from: '2026-09-22', to: '2026-09-28' });
  });

  it('runs from the start of the first day to the end of the last, India time', () => {
    const window = auditWindow('2026-09-22', '2026-09-28');
    expect(window).toEqual({
      ok: true,
      from: '2026-09-22T00:00:00+05:30',
      to: '2026-09-29T00:00:00+05:30',
    });
    if (window.ok) {
      expect(AuditQueryInput.safeParse({ from: window.from, to: window.to }).success).toBe(true);
    }
    expect(auditWindow('2026-09-28', '2026-09-28')).toMatchObject({ ok: true });
  });

  it('allows 93 days and no more, which the reader also accepts', () => {
    const longest = auditWindow('2026-01-01', '2026-04-03');
    expect(longest).toMatchObject({ ok: true });
    if (longest.ok) {
      expect(AuditQueryInput.safeParse({ from: longest.from, to: longest.to }).success).toBe(true);
    }
    expect(auditWindow('2026-01-01', '2026-04-04')).toEqual({
      ok: false,
      problem: 'windowTooLong',
    });
  });

  it('names the problem with a backwards or missing date', () => {
    expect(auditWindow('2026-09-28', '2026-09-27')).toEqual({
      ok: false,
      problem: 'windowBackwards',
    });
    expect(auditWindow(undefined, '2026-09-27')).toEqual({ ok: false, problem: 'dateMissing' });
    expect(auditWindow('', '2026-09-27')).toEqual({ ok: false, problem: 'dateMissing' });
  });
});

describe('recorded actions', () => {
  it('have a name on screen, and one without a name yet reads as another change', () => {
    expect(actionKey('crm.lead.create')).toBe('leadCreate');
    expect(actionKey('auth.sign_in')).toBe('signIn');
    expect(actionKey('inventory.stock.move')).toBe('other');
    expect(ACTION_FILTERS.map((a) => a.command)).toContain('admin.user.two_factor.reset');
  });
});

describe('what changed', () => {
  it('lists named fields in plain values and leaves ids out', () => {
    const rows = auditChanges(
      { status: 'active' },
      { status: 'suspended', revokedSessions: 2, userId: 'x' },
    );
    expect(rows).toEqual([
      {
        field: 'status',
        label: '',
        before: { kind: 'userStatus', value: 'active' },
        after: { kind: 'userStatus', value: 'suspended' },
      },
      {
        field: 'revokedSessions',
        label: '',
        before: { kind: 'empty' },
        after: { kind: 'number', value: 2 },
      },
    ]);
  });

  it('reads roles, prices, times and a recorded consent', () => {
    const rows = auditChanges(
      { entityRoles: [{ entityId: 1, roleKey: 'accounts', roleId: 'r' }], price: '100.00' },
      {
        entityRoles: [{ entityId: 2, roleKey: 'store_manager' }],
        price: '24750.00',
        revokedAt: '2026-09-27T10:00:00.000Z',
        consent: null,
        existingAccount: true,
      },
    );
    expect(rows.map((r) => [r.field, r.before, r.after])).toEqual([
      [
        'entityRoles',
        { kind: 'roles', roles: [{ entityId: 1, roleKey: 'accounts' }] },
        { kind: 'roles', roles: [{ entityId: 2, roleKey: 'store_manager' }] },
      ],
      ['price', { kind: 'money', amount: '100.00' }, { kind: 'money', amount: '24750.00' }],
      ['revokedAt', { kind: 'empty' }, { kind: 'time', iso: '2026-09-27T10:00:00.000Z' }],
      ['existingAccount', { kind: 'empty' }, { kind: 'yesNo', value: true }],
      ['consent', { kind: 'empty' }, { kind: 'yesNo', value: false }],
    ]);
  });

  it('lists anything else under its name in plain words, one plain value per line', () => {
    const rows = auditChanges(null, {
      textVersion: 'v2',
      site: { village: 'Chomu', siteId: 'x', pin: null },
      tags: ['new', 'hot'],
    });
    expect(rows).toEqual([
      {
        field: undefined,
        label: 'Text version',
        before: { kind: 'empty' },
        after: { kind: 'text', text: 'v2' },
      },
      {
        field: undefined,
        label: 'Site: Village',
        before: { kind: 'empty' },
        after: { kind: 'text', text: 'Chomu' },
      },
      {
        field: undefined,
        label: 'Tags',
        before: { kind: 'empty' },
        after: { kind: 'text', text: 'new, hot' },
      },
    ]);
  });

  it('writes a field name in plain words', () => {
    expect(wordsOf('textVersion')).toBe('Text version');
    expect(wordsOf('sign_in')).toBe('Sign in');
  });
});
