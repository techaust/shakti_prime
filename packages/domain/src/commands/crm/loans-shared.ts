import { CustomerLoanStateSchema, DomainError, type CustomerLoanState } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';

/**
 * What the loan commands record in the audit trail besides ids: the loan's state, the amounts, the
 * lender's name, the lender's reference, the dispatch gate, the reason a lender gave for a
 * rejection and the reason a person gave for waiving a rejected loan's gates
 * (docs/03-roadmap-appendix/phase4.md §6.2).
 */
export const LOAN_AUDIT_FIELDS = [
  'loanState',
  'loanAmount',
  'sanctionedAmount',
  'lenderName',
  'loanReference',
  'dispatchGate',
  'rejectedReason',
  'waiverReason',
] as const;

export type CustomerLoanRow = typeof schema.customerLoans.$inferSelect;

/**
 * The loan a move starts from, locked for this transaction, as the caller reads it (row security:
 * the customer's relationship in the loan's company). `loan_missing` when they cannot read it or
 * it is of another company.
 */
export async function lockCustomerLoan(
  ctx: CommandContext,
  entityId: number,
  loanId: string,
): Promise<{ row: CustomerLoanRow; state: CustomerLoanState }> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const cl = schema.customerLoans;
  const [row] = await ctx.tx
    .select()
    .from(cl)
    .where(and(eq(cl.id, loanId), eq(cl.entityId, entityId)))
    .for('update')
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `loan ${loanId} is not visible`, { reason: 'loan_missing' });
  }
  return { row, state: CustomerLoanStateSchema.parse(row.state) };
}

/** The one write of a move: the update policy holds the caller to their scope over the customer. */
export async function writeCustomerLoan(
  ctx: CommandContext,
  row: CustomerLoanRow,
  change: Partial<
    Pick<
      CustomerLoanRow,
      | 'state'
      | 'stateChangedAt'
      | 'sanctionedAmount'
      | 'sanctionedAt'
      | 'disbursedAt'
      | 'reference'
      | 'rejectedReason'
      | 'gatesWaivedAt'
      | 'gatesWaivedBy'
      | 'gatesWaivedReason'
    >
  >,
): Promise<void> {
  const cl = schema.customerLoans;
  const updated = await ctx.tx
    .update(cl)
    .set({ ...change, updatedBy: ctx.principal.id })
    .where(eq(cl.id, row.id))
    .returning({ id: cl.id });
  if (updated.length === 0) {
    throw new DomainError('forbidden', `loan ${row.id} is outside the caller's scope`);
  }
}

/**
 * A sanction or payout is recorded only on an order the caller reads that is not cancelled, as a
 * loan is applied for (the update policy holds the same): `order_missing` or
 * `loan_order_cancelled`.
 */
export async function requireOpenOrder(ctx: CommandContext, row: CustomerLoanRow): Promise<void> {
  const so = schema.salesOrders;
  const [order] = await ctx.tx
    .select({ state: so.state })
    .from(so)
    .where(and(eq(so.id, row.salesOrderId), eq(so.entityId, row.entityId)))
    .limit(1);
  if (!order) {
    throw new DomainError('not_found', `order ${row.salesOrderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  if (order.state === 'cancelled') {
    throw new DomainError('conflict', `order ${row.salesOrderId} is cancelled`, {
      reason: 'loan_order_cancelled',
    });
  }
}
