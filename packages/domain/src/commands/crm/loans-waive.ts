import { CustomerLoanDto, DomainError, WaiveLoanGatesInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { orderLoanGate, readCustomerLoan, releasedGates } from '../../queries/crm/loans';
import { LOAN_AUDIT_FIELDS, lockCustomerLoan, writeCustomerLoan } from './loans-shared';

/**
 * `crm.loan.gates.waive` (docs/03-roadmap-appendix/phase4.md §6.2): a person who writes customers
 * across the company (`crm.account.write` at company scope) records, with a reason, that the order
 * no longer waits on the loan its lender turned down. Only the loan that holds the order back is
 * waived: the order's newest turned-down loan, while no other loan is under way and the gate answer
 * is `pending` for it (`loan_gates_not_held` otherwise). The waiver is kept on the loan, once; the
 * dispatch it held is released (`crm.loan.gates_released`, the loan's state `rejected`). A new loan
 * on the order replaces a turned-down one without a waiver. People only.
 */
export const waiveLoanGates = defineCommand({
  name: 'crm.loan.gates.waive',
  permission: 'crm.account.write',
  minScope: 'entity',
  peopleOnly: true,
  input: WaiveLoanGatesInput,
  output: CustomerLoanDto,
  auditFields: LOAN_AUDIT_FIELDS,
  async handler(ctx, input) {
    // The loan is locked first, so two waivers of one loan are taken one after the other and the
    // second finds nothing held.
    const { row } = await lockCustomerLoan(ctx, input.entityId, input.loanId);
    const before = await orderLoanGate(ctx, row.salesOrderId);
    if (before.loanId !== row.id || before.reason !== 'loan_rejected') {
      throw new DomainError('conflict', `loan ${row.id} holds nothing back`, {
        reason: 'loan_gates_not_held',
      });
    }
    await writeCustomerLoan(ctx, row, {
      gatesWaivedAt: ctx.now,
      gatesWaivedBy: ctx.principal.id,
      gatesWaivedReason: input.reason,
    });
    ctx.audit({
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { loanState: row.state, waiverReason: null },
      after: { loanState: row.state, waiverReason: input.reason },
    });
    if (releasedGates(before, await orderLoanGate(ctx, row.salesOrderId))) {
      ctx.emit({
        type: 'crm.loan.gates_released',
        entityId: row.entityId,
        aggregateType: 'customer_loan',
        aggregateId: row.id,
        payload: { salesOrderId: row.salesOrderId, state: 'rejected', dispatch: true },
      });
    }
    return readCustomerLoan(ctx, row.entityId, row.id);
  },
});
