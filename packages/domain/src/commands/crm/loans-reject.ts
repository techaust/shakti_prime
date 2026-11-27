import { CustomerLoanDto, DomainError, RejectCustomerLoanInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readCustomerLoan } from '../../queries/crm/loans';
import { transition } from '../../state-machines/define-machine';
import { customerLoanMachine } from '../../state-machines/machines/customer-loan';
import { LOAN_AUDIT_FIELDS, lockCustomerLoan, writeCustomerLoan } from './loans-shared';

/**
 * `crm.loan.reject` (docs/03-roadmap-appendix/phase4.md §6.2): the lender turned down an applied or
 * sanctioned loan, with the reason they gave. The order may take another loan, and until it does,
 * or a person records that it no longer waits on one (`crm.loan.gates.waive`), the turned-down
 * loan keeps holding back what it held (`app.order_loan_gate()` answers `pending`, reason
 * `loan_rejected`). `crm.loan.rejected` brings the notify worker, which tells the owner of the
 * order's lead, or of the customer where the order has none, so they offer another route
 * (`notify_owner`). People only.
 */
export const rejectCustomerLoan = defineCommand({
  name: 'crm.loan.reject',
  permission: 'crm.account.write',
  minScope: 'own',
  peopleOnly: true,
  input: RejectCustomerLoanInput,
  output: CustomerLoanDto,
  auditFields: LOAN_AUDIT_FIELDS,
  async handler(ctx, input) {
    const { row, state } = await lockCustomerLoan(ctx, input.entityId, input.loanId);
    const rejected = transition(customerLoanMachine, { state }, 'reject', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: input.reason },
    });
    if (rejected.from !== 'applied' && rejected.from !== 'sanctioned') {
      throw new DomainError('internal', `reject fired from ${String(rejected.from)}`);
    }
    await writeCustomerLoan(ctx, row, {
      state: rejected.to,
      stateChangedAt: ctx.now,
      rejectedReason: input.reason,
    });
    const so = schema.salesOrders;
    const [order] = await ctx.tx
      .select({ opportunityId: so.opportunityId })
      .from(so)
      .where(eq(so.id, row.salesOrderId))
      .limit(1);
    ctx.audit({
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { loanState: row.state },
      after: { loanState: rejected.to, rejectedReason: input.reason },
    });
    ctx.emit({
      type: 'crm.loan.rejected',
      entityId: row.entityId,
      aggregateType: 'customer_loan',
      aggregateId: row.id,
      payload: {
        accountId: row.accountId,
        salesOrderId: row.salesOrderId,
        opportunityId: order?.opportunityId ?? null,
        fromState: rejected.from,
        state: 'rejected',
        rejectedBy: ctx.principal.id,
      },
    });
    return readCustomerLoan(ctx, row.entityId, row.id);
  },
});
