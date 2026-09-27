import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const EXPENSE_CLAIM_STATES = [
  'draft',
  'submitted',
  'manager_approved',
  'approved',
  'rejected',
  'reimbursed',
] as const;
export type ExpenseClaimState = (typeof EXPENSE_CLAIM_STATES)[number];
export type ExpenseClaimEvent =
  'create' | 'submit' | 'manager.approve' | 'accounts.approve' | 'reject' | 'reimburse';

export interface ExpenseClaimRecord {
  state: ExpenseClaimState | null;
  /** The principal of the employee who claims. */
  claimantId: string;
  /** Who gave the manager approval, once given. */
  managerApproverId: string | null;
  lineCount: number;
  /** Every line carries its receipt photo. */
  receiptsComplete: boolean;
}

export interface ExpenseClaimParams {
  reason?: string | null;
}

type G = Guard<ExpenseClaimRecord, ExpenseClaimParams>;

const receipts: G = {
  description: 'at least one line, each with its receipt photo',
  check: (record) =>
    record.lineCount > 0 && record.receiptsComplete
      ? undefined
      : { code: 'validation_failed', reason: 'expense_receipts_missing' },
};

const notOwnClaim: G = {
  description: 'the approver is not the claimant',
  check: (record, { actor }) =>
    actor.kind === 'principal' && actor.principal.id === record.claimantId
      ? { code: 'forbidden', reason: 'expense_self_approval' }
      : undefined,
};

const accountsStep: G = {
  description: 'the Accounts step: a person other than the manager who approved',
  check: (record, { actor }) =>
    actor.kind === 'principal' && actor.principal.id !== record.managerApproverId
      ? undefined
      : { code: 'forbidden', reason: 'expense_accounts_step' },
};

/** Expense claim: manager → Accounts approval, then the monthly reimbursement (BLUEPRINT §8.8, PRD FIN-07). */
export const expenseClaimMachine = defineMachine<
  ExpenseClaimState,
  ExpenseClaimEvent,
  ExpenseClaimRecord,
  ExpenseClaimParams
>({
  name: 'expense_claim',
  title: 'Expense claim',
  summary:
    '`expense_claims.state`. Claims with receipt photos from the app or web, allocated to a project or overhead. Policy limits per category are a workshop input; the approver sees lines over the limit.',
  sources: [
    'BLUEPRINT §8.7, §8.8, §19 item 2',
    'PRD FIN-07',
    'SECURITY §3.2 `finance.expense.approve`',
  ],
  states: EXPENSE_CLAIM_STATES,
  initial: 'draft',
  terminal: ['rejected', 'reimbursed'],
  proposedStates: ['draft', 'submitted', 'manager_approved', 'approved', 'rejected', 'reimbursed'],
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'finance.expense.submit',
      note: 'Every staff role holds `finance.expense.submit` at own scope.',
    },
    {
      from: ['draft'],
      event: 'submit',
      to: 'submitted',
      permission: 'finance.expense.submit',
      guard: receipts,
    },
    {
      from: ['submitted'],
      event: 'manager.approve',
      to: 'manager_approved',
      permission: 'finance.expense.approve',
      scope: 'team',
      guard: notOwnClaim,
      effects: [{ key: 'set_manager', description: 'record the manager approver' }],
    },
    {
      from: ['manager_approved'],
      event: 'accounts.approve',
      to: 'approved',
      permission: 'finance.expense.verify',
      scope: 'entity',
      guard: allOf(notOwnClaim, accountsStep),
      effects: [
        {
          key: 'cost_entry',
          description: 'job cost entry of type `expense` when allocated to a project (restricted)',
        },
      ],
      note: 'The GM holds `finance.expense.approve` at entity scope for the manager step; the Accounts step needs `finance.expense.verify`, which only Accounts and the Executive hold.',
    },
    {
      from: ['submitted', 'manager_approved'],
      event: 'reject',
      to: 'rejected',
      permission: 'finance.expense.approve',
      scope: 'team',
      guard: allOf(reasonGiven(), notOwnClaim),
      proposed: true,
    },
    {
      from: ['approved'],
      event: 'reimburse',
      to: 'reimbursed',
      permission: 'finance.payment.write',
      system: true,
      effects: [
        { key: 'export_line', description: 'included in the monthly reimbursement export (HR-04)' },
      ],
    },
  ],
});
