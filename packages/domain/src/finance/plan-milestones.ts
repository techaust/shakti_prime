import {
  DomainError,
  type CalendarDate,
  type Money,
  type MilestoneDueRule,
  type MilestoneStep,
} from '@shakti/contracts';
import { divideHalfUp, moneyFromPaise, toPaise, toScaled } from '../money/paise';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/** What an order's loan answers for a gate (`app.order_loan_gate()`, J2). */
export type LoanGateAnswer = 'none' | 'pending' | 'met';

/** The moments an order has reached that a due rule may wait for. */
export interface MilestoneMoments {
  /** The day the order was confirmed (IST). */
  confirmedOn: CalendarDate | null;
  /** The day its first dispatch was made ready (D2); null until then. */
  readyToDispatchOn: CalendarDate | null;
  /** The day its installation was done (Phase 4 projects); null until then. */
  installedOn: CalendarDate | null;
  /** The date of its Tally sales invoice (TC3); null until then. */
  invoicedOn: CalendarDate | null;
}

/** A milestone as planned: its step, its amount, and where it starts. */
export interface PlannedMilestone {
  key: string;
  label: string;
  percent: string | null;
  amount: Money;
  dueRule: MilestoneDueRule;
  dueDays: number | null;
  loanGate: MilestoneStep['loanGate'];
  state: 'pending' | 'due';
  dueOn: CalendarDate | null;
}

/** `2026-11-27` plus `days`, as a calendar date. */
function addDays(day: CalendarDate, days: number): CalendarDate {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * The day a milestone's due rule falls on, given the moments the order has reached, or null while
 * the rule still waits. `today` stops a days-after-invoice rule before its day.
 */
export function milestoneDueOn(
  rule: MilestoneDueRule,
  dueDays: number | null,
  moments: MilestoneMoments,
  today: CalendarDate,
): CalendarDate | null {
  switch (rule) {
    case 'on_confirmation':
      return moments.confirmedOn;
    case 'before_dispatch':
      return moments.readyToDispatchOn;
    case 'on_installation':
      return moments.installedOn;
    case 'days_after_invoice': {
      if (moments.invoicedOn === null || dueDays === null) return null;
      const day = addDays(moments.invoicedOn, dueDays);
      return day <= today ? day : null;
    }
  }
}

/** Rounds paise to the rupee when documents round to the rupee (the tax engine's rule). */
function roundAmount(numerator: bigint, denominator: bigint): bigint {
  return WORKSHOP_DEFAULTS.tax.roundDocumentToRupee
    ? divideHalfUp(numerator, denominator * 100n) * 100n
    : divideHalfUp(numerator, denominator);
}

/**
 * Shares an order's total among the steps (docs/03-roadmap-appendix/phase5.md §5): the fixed
 * amounts first, then the percentages of what is left. The percentages are rounded as they add
 * up (each share is the rounded running total less the one before it), half-up to the rupee as
 * documents are, and never past the whole rupees left; the last step takes what remains, so the
 * amounts sum to the total exactly and none is below zero. Refused with
 * `milestone_amounts_exceed_total` when the fixed amounts pass the total.
 */
export function splitMilestoneAmounts(total: Money, steps: readonly MilestoneStep[]): Money[] {
  const whole = toPaise(total);
  const fixed = steps.reduce((sum, s) => sum + (s.amount === null ? 0n : toPaise(s.amount)), 0n);
  const rest = whole - fixed;
  if (rest < 0n) {
    throw new DomainError('validation_failed', 'the fixed amounts exceed the order total', {
      reason: 'milestone_amounts_exceed_total',
    });
  }
  const ceiling = WORKSHOP_DEFAULTS.tax.roundDocumentToRupee ? (rest / 100n) * 100n : rest;
  let share = 0n;
  let shared = 0n;
  const amounts = steps.slice(0, -1).map((step) => {
    if (step.amount !== null) return toPaise(step.amount);
    share += toScaled(step.percent ?? '0', 2);
    const upTo = roundAmount(rest * share, 10000n);
    const next = upTo < ceiling ? upTo : ceiling;
    const amount = next - shared;
    shared = next;
    return amount;
  });
  const last = whole - amounts.reduce((sum, a) => sum + a, 0n);
  return [...amounts, last].map(moneyFromPaise);
}

/**
 * An order's milestones from its terms: each step's amount (`splitMilestoneAmounts()`), and each
 * due from the day its rule falls on, unless a customer loan holds it back (a `customer_loan`
 * step the loan answers `pending`); the others wait as `pending`.
 */
export function planMilestones(
  total: Money,
  steps: readonly MilestoneStep[],
  moments: MilestoneMoments,
  loanGates: Readonly<Record<string, LoanGateAnswer>>,
  today: CalendarDate,
): PlannedMilestone[] {
  const amounts = splitMilestoneAmounts(total, steps);
  return steps.map((step, index) => {
    const dueOn = milestoneDueOn(step.dueRule, step.dueDays, moments, today);
    const held = step.loanGate === 'customer_loan' && loanGates[step.key] === 'pending';
    const due = dueOn !== null && !held;
    return {
      key: step.key,
      label: step.label,
      percent: step.percent,
      amount: amounts[index] ?? '0.00',
      dueRule: step.dueRule,
      dueDays: step.dueDays,
      loanGate: step.loanGate,
      state: due ? 'due' : 'pending',
      dueOn: due ? dueOn : null,
    };
  });
}
