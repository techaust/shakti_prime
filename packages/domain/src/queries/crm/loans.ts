import {
  CustomerLoanDto,
  DomainError,
  LoanGatesSchema,
  OrderLoanGateDto,
  type LoanGateAnswer,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';

/**
 * Customer loans' reads (docs/03-roadmap-appendix/phase4.md §6.2). Row security decides which
 * loans a caller reads (the customer's relationship in the loan's company); the gate answer comes
 * only from `app.order_loan_gate()`, which no code here second-guesses.
 */

const LOAN_COLUMNS = {
  id: schema.customerLoans.id,
  entityId: schema.customerLoans.entityId,
  accountId: schema.customerLoans.accountId,
  salesOrderId: schema.customerLoans.salesOrderId,
  lenderId: schema.customerLoans.lenderId,
  typedLenderName: schema.customerLoans.lenderName,
  listLenderName: schema.lenders.name,
  amount: schema.customerLoans.amount,
  state: schema.customerLoans.state,
  stateChangedAt: schema.customerLoans.stateChangedAt,
  sanctionedAmount: schema.customerLoans.sanctionedAmount,
  sanctionedAt: schema.customerLoans.sanctionedAt,
  disbursedAt: schema.customerLoans.disbursedAt,
  reference: schema.customerLoans.reference,
  rejectedReason: schema.customerLoans.rejectedReason,
  gatesJson: schema.customerLoans.gatesJson,
  createdAt: schema.customerLoans.createdAt,
};

interface LoanRow {
  id: string;
  entityId: number;
  accountId: string;
  salesOrderId: string;
  lenderId: string | null;
  typedLenderName: string | null;
  listLenderName: string | null;
  amount: string;
  state: string;
  stateChangedAt: Date;
  sanctionedAmount: string | null;
  sanctionedAt: Date | null;
  disbursedAt: Date | null;
  reference: string | null;
  rejectedReason: string | null;
  gatesJson: unknown;
  createdAt: Date;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** A loan row as its strict DTO; the lender's name from the list, or as typed. */
export function toCustomerLoanDto(row: LoanRow): CustomerLoanDto {
  return CustomerLoanDto.parse({
    id: row.id,
    entityId: row.entityId,
    accountId: row.accountId,
    salesOrderId: row.salesOrderId,
    lenderId: row.lenderId,
    lenderName: row.listLenderName ?? row.typedLenderName ?? '',
    amount: row.amount,
    state: row.state,
    stateChangedAt: iso(row.stateChangedAt),
    sanctionedAmount: row.sanctionedAmount,
    sanctionedAt: iso(row.sanctionedAt),
    disbursedAt: iso(row.disbursedAt),
    reference: row.reference,
    rejectedReason: row.rejectedReason,
    gates: LoanGatesSchema.parse(row.gatesJson),
    createdAt: iso(row.createdAt),
  });
}

/** One loan as the caller reads it; `loan_missing` when they cannot. */
export async function readCustomerLoan(
  ctx: Pick<RequestContext, 'tx'>,
  entityId: number,
  loanId: string,
): Promise<CustomerLoanDto> {
  const cl = schema.customerLoans;
  const [row] = await ctx.tx
    .select(LOAN_COLUMNS)
    .from(cl)
    .leftJoin(schema.lenders, eq(schema.lenders.id, cl.lenderId))
    .where(and(eq(cl.id, loanId), eq(cl.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `loan ${loanId} is not visible`, { reason: 'loan_missing' });
  }
  return toCustomerLoanDto(row);
}

/**
 * The order's loan gates, as `app.order_loan_gate()` alone answers them (J8's dispatch guard and
 * Phase 5's milestones read the same). `order_missing` for an order the caller may not ask about.
 */
export async function orderLoanGate(
  ctx: Pick<RequestContext, 'tx'>,
  orderId: string,
): Promise<OrderLoanGateDto> {
  const [result] = (await ctx.tx.execute(
    sql`select app.order_loan_gate(${orderId}::uuid) as gate`,
  )) as unknown as { gate: unknown }[];
  if (result?.gate === null || result?.gate === undefined) {
    throw new DomainError('not_found', `order ${orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  return OrderLoanGateDto.parse(result.gate);
}

/** The gates a move released: those pending before it and met after it. */
export function releasedGates(
  before: OrderLoanGateDto,
  after: OrderLoanGateDto,
): { dispatch: boolean; milestones: string[] } {
  const released = (was: LoanGateAnswer | undefined, now: LoanGateAnswer) =>
    was === 'pending' && now === 'met';
  return {
    dispatch: released(before.dispatch, after.dispatch),
    milestones: Object.entries(after.milestones)
      .filter(([key, now]) => released(before.milestones[key], now))
      .map(([key]) => key)
      .sort(),
  };
}
