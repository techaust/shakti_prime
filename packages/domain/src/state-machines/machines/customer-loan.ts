import { CUSTOMER_LOAN_STATES, type CustomerLoanState, type Money } from '@shakti/contracts';
import { toPaise } from '../../money/paise';
import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export { CUSTOMER_LOAN_STATES, type CustomerLoanState };
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
    "`customer_loans.state`. The loan can hold back its order's dispatch until a state (`gates_json`); a payment milestone keeps its own loan gate and reads the state (Phase 5). A rejected loan keeps holding the dispatch back until a new loan replaces it or `crm.loan.gates.waive` records that the order no longer waits on one.",
  sources: ['BLUEPRINT §8.1, §19 item 2', 'PRD CRM-08', 'DATABASE §6.2 `customer_loans`'],
  states: CUSTOMER_LOAN_STATES,
  initial: 'applied',
  terminal: ['disbursed', 'rejected'],
  stored: { table: 'customer_loans', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'applied',
      permission: 'crm.account.write',
      note: "Against one order, in the order's company and for its customer; one active loan per order.",
      emits: 'crm.loan.created',
    },
    {
      from: ['applied'],
      event: 'sanction',
      to: 'sanctioned',
      permission: 'crm.account.write',
      guard: amountGiven,
      emits: 'crm.loan.sanctioned',
      effects: [
        { key: 'set_amount', description: 'record the sanctioned amount' },
        {
          key: 'release_gates',
          description:
            'release the dispatch when it waits for `sanctioned` (`crm.loan.gates_released`)',
        },
      ],
    },
    {
      from: ['sanctioned'],
      event: 'disburse',
      to: 'disbursed',
      permission: 'crm.account.write',
      guard: amountGiven,
      emits: 'crm.loan.disbursed',
      effects: [
        {
          key: 'release_gates',
          description:
            'release the dispatch when it waits for `disbursed` (CRM-08, `crm.loan.gates_released`)',
        },
      ],
    },
    {
      from: ['applied', 'sanctioned'],
      event: 'reject',
      to: 'rejected',
      permission: 'crm.account.write',
      guard: reasonGiven(),
      emits: 'crm.loan.rejected',
      effects: [
        {
          key: 'notify_owner',
          description: 'tell the opportunity owner so another route can be offered',
        },
        {
          key: 'keep_gates',
          description:
            'the dispatch stays held (`loan_rejected`) until a new loan or `crm.loan.gates.waive`',
        },
      ],
      proposed: true,
    },
  ],
});
