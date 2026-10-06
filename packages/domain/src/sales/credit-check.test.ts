import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { transition } from '../state-machines/define-machine';
import { salesOrderMachine, type SalesOrderRecord } from '../state-machines/machines/sales-order';
import { everything, holding } from '../state-machines/test-support';
import { creditCheck, type CreditFacts } from './credit-check';

const dealer: CreditFacts = {
  accountType: 'dealer',
  creditLimit: '100000.00',
  creditDays: 30,
  outstanding: '60000.00',
  confirmedUnpaid: '20000.00',
  orderValue: '20000.00',
  oldestOverdueDays: 30,
  oldestOverdueInvoiceNo: 'SMP/SI/2026-27/0042',
};

const release = { by: newId(), reason: 'Paid by cheque, clearing tomorrow' };

describe('creditCheck (design §7.4)', () => {
  it.each<[string, Partial<CreditFacts>, string | null]>([
    ['exactly at the limit passes (60k + 20k confirmed + 20k order = 100k)', {}, null],
    ['one paisa over the limit blocks', { orderValue: '20000.01' }, 'credit_limit_exceeded'],
    [
      'confirmed unpaid orders count towards exposure',
      { confirmedUnpaid: '20000.01' },
      'credit_limit_exceeded',
    ],
    ['overdue exactly the credit days passes', { oldestOverdueDays: 30 }, null],
    ['overdue beyond the credit days blocks', { oldestOverdueDays: 31 }, 'credit_overdue'],
    ['no overdue invoice passes', { oldestOverdueDays: null }, null],
    [
      'no credit days set skips the overdue rule',
      { creditDays: null, oldestOverdueDays: 400 },
      null,
    ],
    ['a dealer with no limit set is blocked', { creditLimit: null }, 'credit_limit_missing'],
    [
      'the limit rule is named before the overdue rule',
      { orderValue: '50000.00', oldestOverdueDays: 90 },
      'credit_limit_exceeded',
    ],
    [
      'a retail account is never checked',
      { accountType: 'household', creditLimit: null, oldestOverdueDays: 999 },
      null,
    ],
    [
      'a business account is never checked',
      { accountType: 'business', orderValue: '999999.00' },
      null,
    ],
  ])('%s', (_label, over, reason) => {
    const outcome = creditCheck({ ...dealer, ...over }, null);
    if (reason === null) {
      expect(outcome).toEqual({ blocked: false, released: false });
    } else {
      expect(outcome).toMatchObject({ blocked: true, failure: { code: 'conflict', reason } });
    }
  });

  it('the limit block names the limit and the exposure', () => {
    expect(creditCheck({ ...dealer, orderValue: '25000.00' }, null)).toEqual({
      blocked: true,
      failure: {
        code: 'conflict',
        reason: 'credit_limit_exceeded',
        details: { limit: '100000.00', exposure: '105000.00' },
      },
    });
  });

  it('the overdue block names the invoice', () => {
    expect(creditCheck({ ...dealer, oldestOverdueDays: 45 }, null)).toEqual({
      blocked: true,
      failure: {
        code: 'conflict',
        reason: 'credit_overdue',
        details: { invoiceNo: 'SMP/SI/2026-27/0042', overdueDays: 45, creditDays: 30 },
      },
    });
  });

  it('a release with a reason lets a blocked order through and says so', () => {
    expect(creditCheck({ ...dealer, oldestOverdueDays: 45 }, release)).toEqual({
      blocked: false,
      released: true,
    });
    expect(creditCheck({ ...dealer, creditLimit: null }, release)).toEqual({
      blocked: false,
      released: true,
    });
  });

  it('a release is not reported when nothing was blocked', () => {
    expect(creditCheck(dealer, release)).toEqual({ blocked: false, released: false });
  });

  it('a release without a reason or a releaser does not count', () => {
    for (const bad of [
      { by: release.by, reason: '  ' },
      { by: '', reason: release.reason },
    ]) {
      expect(creditCheck({ ...dealer, oldestOverdueDays: 45 }, bad)).toMatchObject({
        blocked: true,
      });
    }
  });
});

describe('confirming a sales order', () => {
  const record: SalesOrderRecord = {
    state: 'draft',
    accountType: 'dealer',
    fromAcceptedQuote: false,
    credit: { ...dealer, oldestOverdueDays: 45 },
    creditHeld: true,
    creditRelease: null,
    hasActiveDispatch: false,
    voucherLinked: false,
    balanceDue: '20000.00',
  };
  const now = new Date('2026-06-15T10:00:00+05:30');

  it('is blocked by the credit check', () => {
    expect(() =>
      transition(salesOrderMachine, record, 'confirm', { actor: everything(), now, params: {} }),
    ).toThrow(
      expect.objectContaining({
        code: 'conflict',
        details: expect.objectContaining({
          reason: 'credit_overdue',
          invoiceNo: 'SMP/SI/2026-27/0042',
        }) as unknown,
      }),
    );
  });

  it('goes through once an Executive set credit_release_by with a reason', () => {
    expect(
      transition(salesOrderMachine, { ...record, creditRelease: release }, 'confirm', {
        actor: everything(),
        now,
        params: {},
      }).to,
    ).toBe('confirmed');
  });

  it('only a holder of sales.credit.release may release', () => {
    const gm = holding([
      { key: 'sales.order.confirm', scope: 'entity' },
      { key: 'sales.order.create', scope: 'entity' },
    ]);
    expect(() =>
      transition(salesOrderMachine, record, 'credit.release', {
        actor: gm,
        now,
        params: { reason: release.reason },
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    const executive = holding([{ key: 'sales.credit.release', scope: 'all' }], 'executive');
    const result = transition(salesOrderMachine, record, 'credit.release', {
      actor: executive,
      now,
      params: { reason: release.reason },
    });
    expect(result.to).toBe('draft');
    expect(result.effects.map((e) => e.key)).toEqual(['set_credit_release']);
  });

  it('an agent can never release credit', () => {
    const agent = {
      kind: 'principal' as const,
      principal: {
        id: newId(),
        kind: 'agent' as const,
        roleKey: 'agent:sizing' as const,
        entityIds: [1],
        permissions: [{ key: 'sales.order.confirm' as const, scope: 'entity' as const }],
      },
    };
    expect(() =>
      transition(salesOrderMachine, record, 'credit.release', {
        actor: agent,
        now,
        params: { reason: 'x' },
      }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
  });
});

describe('the exposure and the hold (docs/design/phase1.md §8.3, SALE-5)', () => {
  const now = new Date('2026-06-15T10:00:00+05:30');
  const draft: SalesOrderRecord = {
    state: 'draft',
    accountType: 'dealer',
    fromAcceptedQuote: false,
    credit: { ...dealer, oldestOverdueDays: null, oldestOverdueInvoiceNo: null },
    creditHeld: false,
    creditRelease: null,
    hasActiveDispatch: false,
    voucherLinked: false,
    balanceDue: '20000.00',
  };

  it('counts the outstanding, the confirmed orders not yet in it and this order', () => {
    // 60k outstanding + 20k confirmed since the entry + 20k = 100k: at the limit.
    expect(creditCheck(draft.credit, null)).toEqual({ blocked: false, released: false });
    // Once Accounts' figure includes the confirmed orders, they are not counted twice.
    expect(
      creditCheck({ ...draft.credit, outstanding: '80000.00', confirmedUnpaid: '0.00' }, null),
    ).toEqual({ blocked: false, released: false });
    expect(
      creditCheck({ ...draft.credit, outstanding: '80000.00', confirmedUnpaid: '0.01' }, null),
    ).toMatchObject({
      blocked: true,
      failure: { reason: 'credit_limit_exceeded', details: { exposure: '100000.01' } },
    });
  });

  it('a blocked confirmation is held instead, and a clear one cannot be held', () => {
    const over = { ...draft, credit: { ...draft.credit, orderValue: '20000.01' } };
    const actor = everything();
    expect(() =>
      transition(salesOrderMachine, over, 'confirm', { actor, now, params: {} }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'credit_limit_exceeded' }) as unknown,
      }),
    );
    expect(transition(salesOrderMachine, over, 'credit.hold', { actor, now, params: {} }).to).toBe(
      'draft',
    );
    expect(() =>
      transition(salesOrderMachine, draft, 'credit.hold', { actor, now, params: {} }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'order_credit_clear' }) as unknown,
      }),
    );
  });

  it('a release needs a hold, and lets the held order through on its next confirmation', () => {
    const executive = holding([{ key: 'sales.credit.release', scope: 'all' }], 'executive');
    const held = {
      ...draft,
      credit: { ...draft.credit, orderValue: '50000.00' },
      creditHeld: true,
    };
    expect(() =>
      transition(salesOrderMachine, { ...held, creditHeld: false }, 'credit.release', {
        actor: executive,
        now,
        params: { reason: release.reason },
      }),
    ).toThrow(
      expect.objectContaining({
        details: expect.objectContaining({ reason: 'order_not_held' }) as unknown,
      }),
    );
    expect(
      transition(salesOrderMachine, held, 'credit.release', {
        actor: executive,
        now,
        params: { reason: release.reason },
      }).to,
    ).toBe('draft');
    const released = { ...held, creditHeld: false, creditRelease: release };
    expect(creditCheck(released.credit, released.creditRelease)).toEqual({
      blocked: false,
      released: true,
    });
    expect(
      transition(salesOrderMachine, released, 'confirm', {
        actor: everything(),
        now,
        params: {},
      }).to,
    ).toBe('confirmed');
  });
});
