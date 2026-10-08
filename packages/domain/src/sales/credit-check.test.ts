import { newId } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { transition } from '../state-machines/define-machine';
import { salesOrderMachine, type SalesOrderRecord } from '../state-machines/machines/sales-order';
import { everything, holding } from '../state-machines/test-support';
import { creditCheck, invoiceAgeDays, type CreditFacts } from './credit-check';

/** The day of every check below, 15 June 2026 in IST. */
const NOW = new Date('2026-06-15T10:00:00+05:30');

/** The date of an invoice that is `days` days old on the day of the checks. */
function invoiceOf(days: number): string {
  return new Date(Date.UTC(2026, 5, 15 - days)).toISOString().slice(0, 10);
}

const dealer: CreditFacts = {
  accountType: 'dealer',
  creditLimit: '100000.00',
  creditDays: 30,
  outstanding: '60000.00',
  confirmedUnpaid: '20000.00',
  orderValue: '20000.00',
  oldestUnpaidInvoiceDate: invoiceOf(30),
  oldestUnpaidInvoiceNo: 'SMP/SI/2026-27/0042',
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
    [
      'an invoice exactly the credit days old passes',
      { oldestUnpaidInvoiceDate: invoiceOf(30) },
      null,
    ],
    [
      'an invoice older than the credit days blocks',
      { oldestUnpaidInvoiceDate: invoiceOf(31) },
      'credit_overdue',
    ],
    ['no unpaid invoice passes', { oldestUnpaidInvoiceDate: null }, null],
    [
      'no credit days set skips the overdue rule',
      { creditDays: null, oldestUnpaidInvoiceDate: invoiceOf(400) },
      null,
    ],
    ['a dealer with no limit set is blocked', { creditLimit: null }, 'credit_limit_missing'],
    [
      'the limit rule is named before the overdue rule',
      { orderValue: '50000.00', oldestUnpaidInvoiceDate: invoiceOf(90) },
      'credit_limit_exceeded',
    ],
    [
      'a retail account is never checked',
      { accountType: 'household', creditLimit: null, oldestUnpaidInvoiceDate: invoiceOf(999) },
      null,
    ],
    [
      'a business account is never checked',
      { accountType: 'business', orderValue: '999999.00' },
      null,
    ],
  ])('%s', (_label, over, reason) => {
    const outcome = creditCheck({ ...dealer, ...over }, null, NOW);
    if (reason === null) {
      expect(outcome).toEqual({ blocked: false, released: false });
    } else {
      expect(outcome).toMatchObject({ blocked: true, failure: { code: 'conflict', reason } });
    }
  });

  it('the limit block names the limit and the exposure', () => {
    expect(creditCheck({ ...dealer, orderValue: '25000.00' }, null, NOW)).toEqual({
      blocked: true,
      failure: {
        code: 'conflict',
        reason: 'credit_limit_exceeded',
        details: { limit: '100000.00', exposure: '105000.00' },
      },
    });
  });

  it('the overdue block names the invoice and its age', () => {
    expect(creditCheck({ ...dealer, oldestUnpaidInvoiceDate: invoiceOf(45) }, null, NOW)).toEqual({
      blocked: true,
      failure: {
        code: 'conflict',
        reason: 'credit_overdue',
        details: { invoiceNo: 'SMP/SI/2026-27/0042', invoiceAgeDays: 45, creditDays: 30 },
      },
    });
  });

  it('a release with a reason lets a blocked order through and says so', () => {
    expect(
      creditCheck({ ...dealer, oldestUnpaidInvoiceDate: invoiceOf(45) }, release, NOW),
    ).toEqual({
      blocked: false,
      released: true,
    });
    expect(creditCheck({ ...dealer, creditLimit: null }, release, NOW)).toEqual({
      blocked: false,
      released: true,
    });
  });

  it('the age of the invoice is worked out on the day of the check', () => {
    const facts = { ...dealer, oldestUnpaidInvoiceDate: invoiceOf(30) };
    expect(creditCheck(facts, null, NOW)).toEqual({ blocked: false, released: false });
    // The same figure a day later: the invoice is 31 days old, past the 30 credit days.
    expect(creditCheck(facts, null, new Date('2026-06-16T10:00:00+05:30'))).toMatchObject({
      blocked: true,
      failure: { reason: 'credit_overdue', details: { invoiceAgeDays: 31 } },
    });
    // Late in the evening in IST is still the same IST day, whatever UTC says.
    expect(creditCheck(facts, null, new Date('2026-06-15T23:30:00+05:30'))).toEqual({
      blocked: false,
      released: false,
    });
  });

  it('counts days between two dates', () => {
    expect(invoiceAgeDays('2026-05-16', '2026-06-15')).toBe(30);
    expect(invoiceAgeDays('2026-06-15', '2026-06-15')).toBe(0);
    expect(invoiceAgeDays('2025-12-31', '2026-01-01')).toBe(1);
  });

  it('a release is not reported when nothing was blocked', () => {
    expect(creditCheck(dealer, release, NOW)).toEqual({ blocked: false, released: false });
  });

  it('a release without a reason or a releaser does not count', () => {
    for (const bad of [
      { by: release.by, reason: '  ' },
      { by: '', reason: release.reason },
    ]) {
      expect(
        creditCheck({ ...dealer, oldestUnpaidInvoiceDate: invoiceOf(45) }, bad, NOW),
      ).toMatchObject({
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
    credit: { ...dealer, oldestUnpaidInvoiceDate: invoiceOf(45) },
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

describe('the exposure and the hold (docs/03-roadmap-appendix/phase1.md §8.3, SALE-5)', () => {
  const now = new Date('2026-06-15T10:00:00+05:30');
  const draft: SalesOrderRecord = {
    state: 'draft',
    accountType: 'dealer',
    fromAcceptedQuote: false,
    credit: { ...dealer, oldestUnpaidInvoiceDate: null, oldestUnpaidInvoiceNo: null },
    creditHeld: false,
    creditRelease: null,
    hasActiveDispatch: false,
    voucherLinked: false,
    balanceDue: '20000.00',
  };

  it('counts the outstanding, the confirmed orders not yet in it and this order', () => {
    // 60k outstanding + 20k confirmed since the entry + 20k = 100k: at the limit.
    expect(creditCheck(draft.credit, null, NOW)).toEqual({ blocked: false, released: false });
    // Once Accounts' figure includes the confirmed orders, they are not counted twice.
    expect(
      creditCheck({ ...draft.credit, outstanding: '80000.00', confirmedUnpaid: '0.00' }, null, NOW),
    ).toEqual({ blocked: false, released: false });
    expect(
      creditCheck({ ...draft.credit, outstanding: '80000.00', confirmedUnpaid: '0.01' }, null, NOW),
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
    expect(creditCheck(released.credit, released.creditRelease, NOW)).toEqual({
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
