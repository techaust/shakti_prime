import { AUTH_AUDIT_EVENTS, AuditQueryInput, EVENT_TYPES, SegmentSchema } from '@shakti/contracts';
import { commands } from '@shakti/domain';
import { describe, expect, it } from 'vitest';
import en from '../../messages/en.json';
import {
  ACTION_FILTERS,
  actionKey,
  auditChanges,
  auditWindow,
  CONFIRM_METHODS,
  defaultWindow,
  eventNameKey,
  isNamedField,
  istToday,
  NAMED_FIELDS,
  SIGN_IN_DETAILS,
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

describe('every recorded action and event has a name', () => {
  const actions: Readonly<Record<string, string>> = en.activity.actions;
  const events: Readonly<Record<string, string>> = en.activity.events;

  it('names every command in the registry and every sign-in and account event', () => {
    const recorded = [...Object.keys(commands), ...AUTH_AUDIT_EVENTS];
    expect(recorded.length).toBeGreaterThan(30);
    expect(recorded.filter((command) => actionKey(command) === 'other')).toEqual([]);
    for (const command of recorded) expect(actions[actionKey(command)], command).toBeTruthy();
  });

  it('names the saved list views and the live updates connection of the branches to come', () => {
    for (const command of ['profile.view.save', 'profile.view.delete', 'realtime.token.issue']) {
      expect(actionKey(command), command).not.toBe('other');
    }
  });

  it('has a label for every name it gives, and no label it does not use', () => {
    const keys = new Set([...ACTION_FILTERS.map((a) => a.key), 'other']);
    expect(Object.keys(actions).sort()).toEqual([...keys].sort());
  });

  it('names every event type of the catalogue, and reads an unknown one in plain words', () => {
    const keys = EVENT_TYPES.map((type) => eventNameKey(type));
    expect(keys.filter((key) => key === undefined)).toEqual([]);
    expect(new Set(keys).size).toBe(EVENT_TYPES.length);
    expect(Object.keys(events).sort()).toEqual([...keys].sort());
    expect(eventNameKey('inventory.stock.moved')).toBeUndefined();
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

  it('names every field a command or a sign-in event records, other than ids', () => {
    // The keys of every `ctx.audit()` before and after in packages/domain/src/commands (the tax
    // rows spread their DTOs, the import preview its row counts) and the auth events' allow-lists.
    const recorded = [
      // admin.user.*, admin.session.revoke, profile.theme.set
      ...['displayName', 'email', 'phone', 'status', 'entityRoles', 'revokedSessions'],
      ...['twoFactorEnabled', 'theme', 'revokedAt', 'revokedReason'],
      // auth events
      ...['detail', 'method', 'revokeOtherSessions'],
      // org.entity.update, pricing.price.set
      ...['brandName', 'upiId', 'price', 'reason'],
      // crm.lead.create and the crm.opportunity.* moves
      ...['existingAccount', 'consent', 'state', 'lockedUntil', 'handover'],
      ...['lostReason', 'nurtureReason'],
      // tax.rate.set, tax.composite.set
      ...['hsn', 'ratePct', 'effectiveFrom', 'effectiveTo', 'sourceRef', 'segment'],
      ...['goodsSharePct', 'servicesSharePct', 'goodsRatePct', 'servicesRatePct'],
      // imports.job.*
      ...['kind', 'name', 'format', 'mapping', 'totalRows', 'validRows', 'invalidRows'],
      ...['skippedRows', 'suggested', 'batch', 'fromRow', 'toRow', 'rows', 'committedRows'],
      ...['batches', 'rolledBackRows', 'archived', 'failedBatch', 'failedRow', 'errorCode'],
      // integrations.dlq.replay
      ...['eventType', 'attempts', 'deadLetteredAt'],
    ];
    expect(recorded.filter((key) => !isNamedField(key))).toEqual([]);
    const rows = auditChanges(null, Object.fromEntries(recorded.map((key) => [key, 'x'])));
    expect(rows.filter((r) => r.field === undefined)).toEqual([]);
  });

  it('has a label for every named field, and no label for a field it does not name', () => {
    const labels: Readonly<Record<string, string>> = en.activity.fields;
    expect(Object.keys(labels).sort()).toEqual([...NAMED_FIELDS].sort());
  });

  it('has words for every coded value it reads from its own catalogue', () => {
    const values = en.activity.values;
    expect(Object.keys(values.signInDetail).sort()).toEqual([...SIGN_IN_DETAILS].sort());
    expect(Object.keys(values.method).sort()).toEqual([...CONFIRM_METHODS].sort());
    expect(Object.keys(values.segment).sort()).toEqual([...SegmentSchema.options].sort());
  });

  it('reads lead moves, tax rates and import runs as values, not raw data', () => {
    const lead = auditChanges(
      { state: 'open', stageId: 's1', lockedUntil: null },
      { state: 'lost', stageId: 's2', lostReason: 'price_too_high', handover: false },
    );
    expect(lead.map((r) => [r.field, r.before, r.after])).toEqual([
      [
        'state',
        { kind: 'code', group: 'state', value: 'open' },
        { kind: 'code', group: 'state', value: 'lost' },
      ],
      ['lockedUntil', { kind: 'empty' }, { kind: 'empty' }],
      ['handover', { kind: 'empty' }, { kind: 'yesNo', value: false }],
      [
        'lostReason',
        { kind: 'empty' },
        { kind: 'code', group: 'lostReason', value: 'price_too_high' },
      ],
    ]);

    const rate = auditChanges(null, {
      id: 'r1',
      hsn: '8413',
      ratePct: '12.00',
      effectiveFrom: '2026-10-01',
      effectiveTo: null,
      closedRateId: 'r0',
    });
    expect(rate.map((r) => [r.field, r.after])).toEqual([
      ['hsn', { kind: 'text', text: '8413' }],
      ['ratePct', { kind: 'percent', value: '12.00' }],
      ['effectiveFrom', { kind: 'date', iso: '2026-10-01' }],
      ['effectiveTo', { kind: 'empty' }],
    ]);

    const mapped = auditChanges(
      { state: 'uploaded', templateId: null, mapping: null },
      {
        state: 'mapped',
        templateId: 't1',
        mapping: { columns: { phone: 'Mobile', contactName: '' }, defaults: { siteType: 'farm' } },
      },
    );
    expect(mapped.find((r) => r.field === 'mapping')?.after).toEqual({
      kind: 'mapping',
      columns: [{ field: 'phone', column: 'Mobile' }],
      defaults: [{ field: 'siteType', value: 'farm' }],
    });
  });
});
