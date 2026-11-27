import { describe, expect, it } from 'vitest';
import { MilestoneStepsSchema } from './milestones';

const step = {
  key: 'advance',
  label: 'Advance',
  percent: '50.00',
  amount: null,
  dueRule: 'on_confirmation',
  dueDays: null,
  loanGate: 'none',
} as const;
const balance = { ...step, key: 'balance', label: 'Balance', dueRule: 'before_dispatch' } as const;

describe('MilestoneStepsSchema', () => {
  it('takes steps whose percentages sum to 100, a fixed amount before them', () => {
    expect(MilestoneStepsSchema.safeParse([step, balance]).success).toBe(true);
    expect(
      MilestoneStepsSchema.safeParse([
        { ...step, key: 'booking', percent: null, amount: '5000.00' },
        { ...balance, percent: '100.00' },
      ]).success,
    ).toBe(true);
    expect(
      MilestoneStepsSchema.safeParse([
        { ...step, percent: '33.33' },
        { ...balance, percent: '33.33' },
        { ...balance, key: 'final', percent: '33.34' },
      ]).success,
    ).toBe(true);
  });

  it('refuses shares that do not sum to 100, a repeated key, or a fixed last step', () => {
    expect(MilestoneStepsSchema.safeParse([step, { ...balance, percent: '40.00' }]).success).toBe(
      false,
    );
    expect(MilestoneStepsSchema.safeParse([step, { ...balance, key: 'advance' }]).success).toBe(
      false,
    );
    expect(
      MilestoneStepsSchema.safeParse([
        { ...step, percent: '100.00' },
        { ...balance, percent: null, amount: '100.00' },
      ]).success,
    ).toBe(false);
    expect(MilestoneStepsSchema.safeParse([]).success).toBe(false);
  });

  it('asks a step for a percentage or an amount, and days only after the invoice', () => {
    expect(
      MilestoneStepsSchema.safeParse([{ ...step, percent: '100.00', amount: '10.00' }]).success,
    ).toBe(false);
    expect(
      MilestoneStepsSchema.safeParse([{ ...step, percent: '100.00', dueDays: 30 }]).success,
    ).toBe(false);
    expect(
      MilestoneStepsSchema.safeParse([
        { ...step, percent: '100.00', dueRule: 'days_after_invoice', dueDays: 30 },
      ]).success,
    ).toBe(true);
    expect(
      MilestoneStepsSchema.safeParse([
        { ...step, percent: '100.00', dueRule: 'days_after_invoice', dueDays: null },
      ]).success,
    ).toBe(false);
    expect(MilestoneStepsSchema.safeParse([{ ...step, key: 'Advance', percent: '100.00' }]).success).toBe(false);
  });
});
