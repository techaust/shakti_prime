import type { LoanGateAnswer } from '../../finance/plan-milestones';
import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PAYMENT_MILESTONE_MACHINE_STATES = [
  'pending',
  'due',
  'part_paid',
  'paid',
  'waived',
] as const;
export type PaymentMilestoneMachineState = (typeof PAYMENT_MILESTONE_MACHINE_STATES)[number];
export type PaymentMilestoneEvent = 'plan' | 'fall_due' | 'pay_part' | 'pay' | 'waive';

/** What the milestone commands preload for the guards. */
export interface PaymentMilestoneRecord {
  state: PaymentMilestoneMachineState | null;
  /** The moment its due rule names has come (`milestoneRuleMet()`). */
  ruleMet: boolean;
  /** What the order's loan answers for it, where a loan may hold it back; `none` otherwise. */
  loanGate: LoanGateAnswer;
}

export interface PaymentMilestoneParams {
  reason?: string | null;
}

const fallsDue: Guard<PaymentMilestoneRecord, PaymentMilestoneParams> = {
  description:
    "its due rule's moment has come (the order confirmed, ready to dispatch, installed, or the days after the invoice passed), and no customer loan holds it back (`app.order_loan_gate()` answers it `pending`)",
  check: (record) =>
    record.ruleMet && record.loanGate !== 'pending'
      ? undefined
      : { code: 'conflict', reason: 'milestone_not_due' },
};

/**
 * A payment milestone of an order (docs/03-roadmap-appendix/phase5.md §5, §6.1, question 6 (a)):
 * planned from the company's terms when the order is confirmed, due by its rule, paid from Tally
 * receipts (TC3) or waived by the Executive.
 */
export const paymentMilestoneMachine = defineMachine<
  PaymentMilestoneMachineState,
  PaymentMilestoneEvent,
  PaymentMilestoneRecord,
  PaymentMilestoneParams
>({
  name: 'payment_milestone',
  title: 'Payment milestone',
  summary:
    "`payment_milestones.state`. One step of an order's payment terms: its share of the total, when it falls due and whether a customer loan may hold it back. An unpaid before-dispatch milestone keeps the order's dispatch from leaving (`app.order_dispatch_payment_gate()`).",
  sources: [
    'docs/03-roadmap-appendix/phase5.md §5, §6.1, question 6 (a)',
    'PRD FIN-01',
    'DATABASE §6.7 `payment_milestones`',
  ],
  states: PAYMENT_MILESTONE_MACHINE_STATES,
  initial: 'pending',
  terminal: ['paid', 'waived'],
  stateNotes: {
    pending: 'Waits for its due rule, or for a customer loan that holds it back.',
    part_paid: 'Tally receipts paid part of it (TC3).',
  },
  stored: { table: 'payment_milestones', stateColumn: 'state' },
  transitions: [
    {
      from: 'new',
      event: 'plan',
      to: 'pending',
      permission: 'finance.payment.write',
      scope: 'entity',
      system: true,
      effects: [
        {
          key: 'split',
          description:
            "the order's total shared by the steps: fixed amounts first, then the percentages of the rest, each rounded to the rupee, the last taking what is left, so the milestones add up to the total",
        },
      ],
      note: "Planned once per order from the company's current terms for its segment (or the named default), by the platform when the order is confirmed or by Accounts by hand.",
    },
    {
      from: ['pending'],
      event: 'fall_due',
      to: 'due',
      permission: 'finance.payment.write',
      scope: 'entity',
      system: true,
      guard: fallsDue,
      effects: [{ key: 'set_due_on', description: 'record the day it fell due (IST)' }],
      note: 'An on-confirmation milestone falls due as it is planned; the dispatch (D2), the installation and the Tally invoice (TC3) bring the others due.',
    },
    {
      from: ['pending', 'due', 'part_paid'],
      event: 'pay_part',
      to: 'part_paid',
      permission: null,
      system: true,
      note: 'A Tally receipt applied to it, short of its amount (TC3).',
      proposed: true,
    },
    {
      from: ['pending', 'due', 'part_paid'],
      event: 'pay',
      to: 'paid',
      permission: null,
      system: true,
      note: 'Tally receipts applied to it reach its amount (TC3).',
    },
    {
      from: ['pending', 'due', 'part_paid'],
      event: 'waive',
      to: 'waived',
      permission: 'finance.payment.write',
      scope: 'all',
      guard: reasonGiven(),
      emits: 'finance.milestone.waived',
      effects: [
        {
          key: 'set_waiver',
          description:
            'keep who waived it, when and why (audited); a dispatch no longer waits for it',
        },
      ],
    },
  ],
});
