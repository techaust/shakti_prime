import { CustomerLoanDto, DisburseCustomerLoanInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { orderLoanGate, readCustomerLoan, releasedGates } from '../../queries/crm/loans';
import { transition } from '../../state-machines/define-machine';
import { customerLoanMachine } from '../../state-machines/machines/customer-loan';
import {
  LOAN_AUDIT_FIELDS,
  lockCustomerLoan,
  requireOpenOrder,
  writeCustomerLoan,
} from './loans-shared';

/**
 * `crm.loan.disburse` (docs/03-roadmap-appendix/phase4.md §6.2, CRM-08): the lender paid out a
 * sanctioned loan. The machine's guard asks for the sanctioned amount recorded and above zero
 * (`loan_amount_missing`); the lender's reference may come with it. Only on an order the caller
 * reads that is not cancelled (`loan_order_cancelled`). A dispatch that waited for the disbursal,
 * the default, is released (`release_gates`): `crm.loan.gates_released`, as `app.order_loan_gate()`
 * answers before and after. People only.
 */
export const disburseCustomerLoan = defineCommand({
  name: 'crm.loan.disburse',
  permission: 'crm.account.write',
  minScope: 'own',
  peopleOnly: true,
  input: DisburseCustomerLoanInput,
  output: CustomerLoanDto,
  auditFields: LOAN_AUDIT_FIELDS,
  // The lender's reference is the lender's own application or loan account number, which may
  // be twelve digits long.
  unmaskedFields: ['reference'],
  async handler(ctx, input) {
    const { row, state } = await lockCustomerLoan(ctx, input.entityId, input.loanId);
    const disbursed = transition(customerLoanMachine, { state }, 'disburse', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { amount: row.sanctionedAmount },
    });
    await requireOpenOrder(ctx, row);
    const before = await orderLoanGate(ctx, row.salesOrderId);
    const reference = input.reference ?? row.reference;
    await writeCustomerLoan(ctx, row, {
      state: disbursed.to,
      stateChangedAt: ctx.now,
      disbursedAt: ctx.now,
      reference,
    });
    ctx.audit({
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { loanState: row.state, loanReference: row.reference },
      after: { loanState: disbursed.to, loanReference: reference },
    });
    ctx.emit({
      type: 'crm.loan.disbursed',
      entityId: row.entityId,
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      payload: { accountId: row.accountId, salesOrderId: row.salesOrderId, state: 'disbursed' },
    });
    // `release_gates`: the dispatch, when the gate answer held it pending before the move and
    // not after it.
    const released = releasedGates(before, await orderLoanGate(ctx, row.salesOrderId));
    if (released) {
      ctx.emit({
        type: 'crm.loan.gates_released',
        entityId: row.entityId,
        aggregateType: 'customer_loan',
        aggregateId: row.id,
        payload: { salesOrderId: row.salesOrderId, state: 'disbursed', dispatch: true },
      });
    }
    return readCustomerLoan(ctx, row.entityId, row.id);
  },
});
