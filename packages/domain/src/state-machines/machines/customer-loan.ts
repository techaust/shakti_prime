import type { Money } from '@shakti/contracts';
import { toPaise } from '../../money/paise';
import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const CUSTOMER_LOAN_STATES = ['applied', 'sanctioned', 'disbursed', 'rejected'] as const;
export type CustomerLoanState = (typeof CUSTOMER_LOAN_STATES)[number];
export type CustomerLoanEvent = 'create' | 'sanction' | 'disburse' | 'reject';

export interface CustomerLoanRecord {
  state: CustomerLoanState | null;
}

export interface CustomerLoanParams {
  /** The sanctioned or disbursed amount the event records. */
  amount?: Money | null;
  reason?: string | null;
}

type G = Guard<CustomerLoanRecord, CustomerLoanParams>;

const amountGiven: G = {
  description: 'the amount is recorded and above zero',
  check: (_record, { params }) =>
    params.amount && toPaise(params.amount) > 0n
      ? undefined
      : { code: 'validation_failed', reason: 'loan_amount_missing' },
};

/** Customer loan: a bank or scheme loan, including the PM Surya Ghar loan route (BLUEPRINT §8.1). */
export const customerLoanMachine = defineMachine<
  CustomerLoanState,
  CustomerLoanEvent,
  CustomerLoanRecord,
  CustomerLoanParams
>({
  name: 'customer_loan',
  title: 'Customer loan',
  summary:
    '`customer_loans.state`. Loan status can gate payment milestones and dispatch (`gates_json`).',
  sources: ['BLUEPRINT §8.1, §19 item 2', 'PRD CRM-08', 'DATABASE §6.2 `customer_loans`'],
  states: CUSTOMER_LOAN_STATES,
  initial: 'applied',
  terminal: ['disbursed', 'rejected'],
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'applied',
      permission: 'crm.account.write',
      note: 'Against the account and, usually, the opportunity.',
    },
    {
      from: ['applied'],
      event: 'sanction',
      to: 'sanctioned',
      permission: 'crm.account.write',
      guard: amountGiven,
      effects: [
        { key: 'set_amount', description: 'record the sanctioned amount' },
        {
          key: 'release_gates',
          description: 'release milestones and dispatches gated on `sanctioned`',
        },
      ],
    },
    {
      from: ['sanctioned'],
      event: 'disburse',
      to: 'disbursed',
      permission: 'crm.account.write',
      guard: amountGiven,
      effects: [
        {
          key: 'release_gates',
          description: 'release milestones and dispatches gated on `disbursed` (CRM-08)',
        },
      ],
    },
    {
      from: ['applied', 'sanctioned'],
      event: 'reject',
      to: 'rejected',
      permission: 'crm.account.write',
      guard: reasonGiven(),
      effects: [
        {
          key: 'notify_owner',
          description: 'tell the opportunity owner so another route can be offered',
        },
      ],
      proposed: true,
    },
  ],
});
