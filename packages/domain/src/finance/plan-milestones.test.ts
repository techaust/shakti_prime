import type { MilestoneStep } from '@shakti/contracts';
import { describe, expect, it } from 'vitest';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { milestoneDueOn, planMilestones, splitMilestoneAmounts } from './plan-milestones';

const step = (over: Partial<MilestoneStep>): MilestoneStep => ({
  key: 'advance',
  label: 'Advance',
  percent: null,
  amount: null,
  dueRule: 'on_confirmation',
  dueDays: null,
  loanGate: 'none',
  ...over,
});

const paise = (amounts: readonly string[]): number =>
  amounts.reduce((sum, a) => sum + Math.round(Number(a) * 100), 0);

const NONE = { confirmedOn: null, readyToDispatchOn: null, installedOn: null, invoicedOn: null };
const TODAY = '2026-11-27';

describe('splitMilestoneAmounts', () => {
  it('halves a total to the rupee, the last step taking the remainder', () => {
    const steps = WORKSHOP_DEFAULTS.finance.milestoneSteps;
    expect(splitMilestoneAmounts('68209.00', steps)).toEqual(['34105.00', '34104.00']);
    expect(splitMilestoneAmounts('100.00', steps)).toEqual(['50.00', '50.00']);
    expect(splitMilestoneAmounts('1.00', steps)).toEqual(['1.00', '0.00']);
    expect(splitMilestoneAmounts('0.00', steps)).toEqual(['0.00', '0.00']);
  });

  it('takes fixed amounts first and shares the rest by percentage', () => {
    const steps = [
      step({ key: 'booking', amount: '5000.00' }),
      step({ key: 'material', percent: '60.00', dueRule: 'before_dispatch' }),
      step({ key: 'balance', percent: '40.00', dueRule: 'on_installation' }),
    ];
    expect(splitMilestoneAmounts('68209.00', steps)).toEqual(['5000.00', '37925.00', '25284.00']);
  });

  it('refuses fixed amounts above the total', () => {
    const steps = [step({ amount: '500.00' }), step({ key: 'balance', percent: '100.00' })];
    expect(() => splitMilestoneAmounts('499.00', steps)).toThrow(
      expect.objectContaining({ details: { reason: 'milestone_amounts_exceed_total' } }),
    );
    expect(splitMilestoneAmounts('500.00', steps)).toEqual(['500.00', '0.00']);
  });

  it('always sums exactly to the total, for awkward shares and totals', () => {
    const shares = [
      ['33.33', '33.33', '33.34'],
      ['10.00', '15.50', '24.50', '50.00'],
      ['0.01', '99.99'],
      ['99.99', '0.01'],
      ['12.50', '12.50', '12.50', '12.50', '12.50', '12.50', '12.50', '12.50'],
    ];
    for (const set of shares) {
      const steps = set.map((percent, i) => step({ key: `s${String(i)}`, percent }));
      for (let rupees = 0; rupees < 3000; rupees += 7) {
        for (const p of ['00', '49', '50', '99']) {
          const total = `${String(rupees * 113 + 1)}.${p}`;
          const amounts = splitMilestoneAmounts(total, steps);
          expect(paise(amounts)).toBe(Math.round(Number(total) * 100));
          // Every share but the last is whole rupees, as documents round.
          for (const a of amounts.slice(0, -1)) expect(a.endsWith('.00')).toBe(true);
        }
      }
    }
  });
});

describe('milestoneDueOn', () => {
  const moments = {
    confirmedOn: '2026-11-20',
    readyToDispatchOn: '2026-11-25',
    installedOn: null,
    invoicedOn: '2026-11-01',
  };

  it('falls on the moment its rule names, or waits for it', () => {
    expect(milestoneDueOn('on_confirmation', null, moments, TODAY)).toBe('2026-11-20');
    expect(milestoneDueOn('before_dispatch', null, moments, TODAY)).toBe('2026-11-25');
    expect(milestoneDueOn('on_installation', null, moments, TODAY)).toBeNull();
    expect(milestoneDueOn('on_confirmation', null, NONE, TODAY)).toBeNull();
  });

  it('counts days after the invoice, due only once the day has come', () => {
    expect(milestoneDueOn('days_after_invoice', 26, moments, TODAY)).toBe('2026-11-27');
    expect(milestoneDueOn('days_after_invoice', 27, moments, TODAY)).toBeNull();
    expect(milestoneDueOn('days_after_invoice', 30, { ...moments, invoicedOn: null }, TODAY)).toBe(
      null,
    );
    expect(
      milestoneDueOn('days_after_invoice', 30, { ...moments, invoicedOn: '2027-01-31' }, '2027-03-02'),
    ).toBe('2027-03-02');
  });
});

describe('planMilestones', () => {
  const confirmed = { ...NONE, confirmedOn: TODAY };

  it('brings an on-confirmation step due and leaves the others waiting', () => {
    const planned = planMilestones(
      '68209.00',
      WORKSHOP_DEFAULTS.finance.milestoneSteps,
      confirmed,
      {},
      TODAY,
    );
    expect(planned.map((m) => [m.key, m.amount, m.state, m.dueOn])).toEqual([
      ['advance', '34105.00', 'due', TODAY],
      ['balance', '34104.00', 'pending', null],
    ]);
  });

  it('keeps a loan-gated step pending while the loan answers pending, and due once met', () => {
    const steps = [
      step({ percent: '50.00', loanGate: 'customer_loan' }),
      step({ key: 'balance', percent: '50.00' }),
    ];
    const held = planMilestones('1000.00', steps, confirmed, { advance: 'pending' }, TODAY);
    expect(held.map((m) => m.state)).toEqual(['pending', 'due']);
    expect(held[0]?.dueOn).toBeNull();
    const met = planMilestones('1000.00', steps, confirmed, { advance: 'met' }, TODAY);
    expect(met.map((m) => m.state)).toEqual(['due', 'due']);
    const none = planMilestones('1000.00', steps, confirmed, {}, TODAY);
    expect(none.map((m) => m.state)).toEqual(['due', 'due']);
  });

  it('never holds a step with no loan gate, whatever the loan answers', () => {
    const steps = [step({ percent: '100.00' })];
    const planned = planMilestones('1000.00', steps, confirmed, { advance: 'pending' }, TODAY);
    expect(planned[0]?.state).toBe('due');
  });
});
