import { CustomerLoanDto, SanctionCustomerLoanInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { orderLoanGate, readCustomerLoan, releasedGates } from '../../queries/crm/loans';
import { transition } from '../../state-machines/define-machine';
import { customerLoanMachine } from '../../state-machines/machines/customer-loan';
import { LOAN_AUDIT_FIELDS, lockCustomerLoan, writeCustomerLoan } from './loans-shared';

/**
 * `crm.loan.sanction` (docs/03-roadmap-appendix/phase4.md §6.2): the lender sanctioned an applied
 * loan for an amount above zero (the machine's guard, `loan_amount_missing`), which the loan keeps
 * (`set_amount`); the lender's reference may come with it. What waited for the sanction is released
 * (`release_gates`): `crm.loan.gates_released` names it, as `app.order_loan_gate()` answers before
 * and after. People only.
 */
export const sanctionCustomerLoan = defineCommand({
  name: 'crm.loan.sanction',
  permission: 'crm.account.write',
  minScope: 'own',
  peopleOnly: true,
  input: SanctionCustomerLoanInput,
  output: CustomerLoanDto,
  auditFields: LOAN_AUDIT_FIELDS,
  // The lender's reference is the lender's own application or loan account number, which may
  // be twelve digits long.
  unmaskedFields: ['reference'],
  async handler(ctx, input) {
    const { row, state } = await lockCustomerLoan(ctx, input.entityId, input.loanId);
    const sanctioned = transition(customerLoanMachine, { state }, 'sanction', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { amount: input.sanctionedAmount },
    });
    const before = await orderLoanGate(ctx, row.salesOrderId);
    const reference = input.reference ?? row.reference;
    await writeCustomerLoan(ctx, row, {
      state: sanctioned.to,
      stateChangedAt: ctx.now,
      sanctionedAmount: input.sanctionedAmount,
      sanctionedAt: ctx.now,
      reference,
    });
    ctx.audit({
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { loanState: row.state, loanReference: row.reference },
      after: {
        loanState: sanctioned.to,
        sanctionedAmount: input.sanctionedAmount,
        loanReference: reference,
      },
    });
    ctx.emit({
      type: 'crm.loan.sanctioned',
      entityId: row.entityId,
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      payload: { accountId: row.accountId, salesOrderId: row.salesOrderId, state: 'sanctioned' },
    });
    // `release_gates`: what the gate answer held pending before the move and met after it.
    const released = releasedGates(before, await orderLoanGate(ctx, row.salesOrderId));
    if (released.dispatch || released.milestones.length > 0) {
      ctx.emit({
        type: 'crm.loan.gates_released',
        entityId: row.entityId,
        aggregateType: 'customer_loan',
        aggregateId: row.id,
        payload: { salesOrderId: row.salesOrderId, state: 'sanctioned', ...released },
      });
    }
    return readCustomerLoan(ctx, row.entityId, row.id);
  },
});
