import {
  ACCOUNT_LOANS_LIMIT,
  AccountLoanRowDto,
  AccountLoansInput,
  CustomerLoanDto,
  DomainError,
  hasGrant,
  LenderDto,
  ListLendersInput,
  LoanGatesSchema,
  OrderLoanGateDto,
  OrderLoansDto,
  OrderLoansInput,
  type LoanGateAnswer,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';

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

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

function requireCompany(ctx: QueryContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * Whether the caller writes the customer's relationship in the company, as the loan policies
 * decide it (`crm.account.write` at entity scope, or over the relationship's team or owner), so
 * the screen offers only the moves the commands would take.
 */
async function writesCustomer(
  ctx: QueryContext,
  entityId: number,
  accountId: string,
): Promise<boolean> {
  const perms = ctx.principal.permissions;
  if (hasGrant(perms, 'crm.account.write', 'entity')) return true;
  if (!hasGrant(perms, 'crm.account.write', 'own')) return false;
  const ae = schema.accountEntities;
  const [here] = await ctx.tx
    .select({ ownerId: ae.ownerId, teamId: ae.teamId })
    .from(ae)
    .where(and(eq(ae.accountId, accountId), eq(ae.entityId, entityId)))
    .limit(1);
  if (!here) return false;
  return (
    (hasGrant(perms, 'crm.account.write', 'team') &&
      here.teamId !== null &&
      here.teamId === ctx.principal.teamId) ||
    here.ownerId === ctx.principal.id
  );
}

/**
 * The order's Loan tab (docs/03-roadmap-appendix/phase4.md §6.2): the order's loans newest first,
 * the gate answer from `app.order_loan_gate()`, the company's active lenders and whether the caller
 * may record and move a loan. Read with `crm.account.read`; `order_missing` for an order the caller
 * cannot read.
 */
export async function getOrderLoans(ctx: QueryContext, rawInput: unknown): Promise<OrderLoansDto> {
  const input = parseQueryInput(OrderLoansInput, rawInput, 'crm.loan.order');
  checkPermission(ctx.principal, 'crm.account.read', 'own');
  requireCompany(ctx, input.entityId);
  const so = schema.salesOrders;
  const [order] = await ctx.tx
    .select({ accountId: so.accountId, state: so.state })
    .from(so)
    .where(and(eq(so.id, input.orderId), eq(so.entityId, input.entityId)))
    .limit(1);
  if (!order) {
    throw new DomainError('not_found', `order ${input.orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  const cl = schema.customerLoans;
  const l = schema.lenders;
  const [rows, lenders, gate, writes] = await Promise.all([
    ctx.tx
      .select(LOAN_COLUMNS)
      .from(cl)
      .leftJoin(l, eq(l.id, cl.lenderId))
      .where(and(eq(cl.salesOrderId, input.orderId), eq(cl.entityId, input.entityId)))
      .orderBy(desc(cl.createdAt), desc(cl.id)),
    ctx.tx
      .select({ id: l.id, entityId: l.entityId, name: l.name, isActive: l.isActive })
      .from(l)
      .where(and(eq(l.entityId, input.entityId), eq(l.isActive, true)))
      .orderBy(asc(l.name), asc(l.id)),
    orderLoanGate(ctx, input.orderId),
    writesCustomer(ctx, input.entityId, order.accountId),
  ]);
  return OrderLoansDto.parse({
    entityId: input.entityId,
    orderId: input.orderId,
    accountId: order.accountId,
    loans: rows.map(toCustomerLoanDto),
    gate,
    lenders,
    canWrite: writes && order.state !== 'cancelled',
  });
}

/**
 * Account 360's loans (docs/03-roadmap-appendix/phase4.md §6.2): the customer's loans in one
 * company, newest first, at most `ACCOUNT_LOANS_LIMIT`, each with its order's number when the
 * caller reads the order. Row security reads them with the customer; the
 * `(account_id, entity_id, created_at)` index serves the order.
 */
export async function listAccountLoans(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<AccountLoanRowDto[]> {
  const input = parseQueryInput(AccountLoansInput, rawInput, 'crm.loan.account');
  checkPermission(ctx.principal, 'crm.account.read', 'own');
  requireCompany(ctx, input.entityId);
  const cl = schema.customerLoans;
  const l = schema.lenders;
  const so = schema.salesOrders;
  const rows = await ctx.tx
    .select({
      id: cl.id,
      entityId: cl.entityId,
      salesOrderId: cl.salesOrderId,
      soNo: so.soNo,
      typedLenderName: cl.lenderName,
      listLenderName: l.name,
      amount: cl.amount,
      sanctionedAmount: cl.sanctionedAmount,
      state: cl.state,
      stateChangedAt: cl.stateChangedAt,
    })
    .from(cl)
    .leftJoin(l, eq(l.id, cl.lenderId))
    .leftJoin(so, eq(so.id, cl.salesOrderId))
    .where(and(eq(cl.accountId, input.accountId), eq(cl.entityId, input.entityId)))
    .orderBy(desc(cl.createdAt), desc(cl.id))
    .limit(ACCOUNT_LOANS_LIMIT);
  return rows.map((r) =>
    AccountLoanRowDto.parse({
      id: r.id,
      entityId: r.entityId,
      salesOrderId: r.salesOrderId,
      soNo: r.soNo,
      lenderName: r.listLenderName ?? r.typedLenderName ?? '',
      amount: r.amount,
      sanctionedAmount: r.sanctionedAmount,
      state: r.state,
      stateChangedAt: r.stateChangedAt.toISOString(),
    }),
  );
}

/**
 * Settings › Lenders (docs/03-roadmap-appendix/phase4.md §6.2): one company's lenders by name,
 * those switched off too. Every principal acting in the company reads them; the page is the
 * Executive's.
 */
export async function listLenders(ctx: QueryContext, rawInput: unknown): Promise<LenderDto[]> {
  const input = parseQueryInput(ListLendersInput, rawInput, 'crm.lender.list');
  requireCompany(ctx, input.entityId);
  const l = schema.lenders;
  const rows = await ctx.tx
    .select({ id: l.id, entityId: l.entityId, name: l.name, isActive: l.isActive })
    .from(l)
    .where(eq(l.entityId, input.entityId))
    .orderBy(asc(l.name), asc(l.id));
  return rows.map((r) => LenderDto.parse(r));
}
