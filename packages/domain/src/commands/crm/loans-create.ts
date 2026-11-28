import {
  ACTIVE_LOAN_STATES,
  CreateCustomerLoanInput,
  CustomerLoanDto,
  DomainError,
  newId,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readCustomerLoan } from '../../queries/crm/loans';
import { transition } from '../../state-machines/define-machine';
import { customerLoanMachine } from '../../state-machines/machines/customer-loan';
import { LOAN_AUDIT_FIELDS } from './loans-shared';

/**
 * `crm.loan.create` (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08): a customer's loan
 * applied for on an order the caller reads and that is not cancelled, over a customer relationship
 * they may write. The loan names a lender of the company's list or, while the list has no active
 * lender, a name typed once. An order holds one active loan: a second is refused while one is
 * applied, sanctioned or disbursed (`loan_active_exists`), by this check and, for two at once, by
 * the unique index. What the loan holds back is in its gates, the dispatch on disbursal unless
 * chosen otherwise. People only.
 */
export const createCustomerLoan = defineCommand({
  name: 'crm.loan.create',
  permission: 'crm.account.write',
  minScope: 'own',
  peopleOnly: true,
  input: CreateCustomerLoanInput,
  output: CustomerLoanDto,
  auditFields: LOAN_AUDIT_FIELDS,
  constraintReasons: { customer_loans_active_unique: 'loan_active_exists' },
  // The lender's reference is the lender's own application or loan account number, which may
  // be twelve digits long.
  unmaskedFields: ['reference'],
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    const so = schema.salesOrders;
    const [order] = await ctx.tx
      .select({ id: so.id, accountId: so.accountId, state: so.state })
      .from(so)
      .where(and(eq(so.id, input.orderId), eq(so.entityId, input.entityId)))
      .limit(1);
    if (!order) {
      throw new DomainError('not_found', `order ${input.orderId} is not visible`, {
        reason: 'order_missing',
      });
    }
    if (order.state === 'cancelled') {
      throw new DomainError('conflict', `order ${order.id} is cancelled`, {
        reason: 'loan_order_cancelled',
      });
    }

    const l = schema.lenders;
    const lenderId = input.lenderId ?? null;
    const lenderName = input.lenderName ?? null;
    let shownLender: string;
    if (lenderId !== null) {
      const [lender] = await ctx.tx
        .select({ name: l.name })
        .from(l)
        .where(and(eq(l.id, lenderId), eq(l.entityId, input.entityId), eq(l.isActive, true)))
        .limit(1);
      if (!lender) {
        throw new DomainError('validation_failed', `lender ${lenderId} is not on the list`, {
          reason: 'loan_lender_missing',
        });
      }
      shownLender = lender.name;
    } else {
      const [listed] = await ctx.tx
        .select({ id: l.id })
        .from(l)
        .where(and(eq(l.entityId, input.entityId), eq(l.isActive, true)))
        .limit(1);
      if (listed) {
        throw new DomainError('validation_failed', 'the company has lenders to choose from', {
          reason: 'loan_lender_from_list',
        });
      }
      shownLender = lenderName ?? '';
    }

    const cl = schema.customerLoans;
    const [active] = await ctx.tx
      .select({ id: cl.id })
      .from(cl)
      .where(and(eq(cl.salesOrderId, order.id), inArray(cl.state, [...ACTIVE_LOAN_STATES])))
      .limit(1);
    if (active) {
      throw new DomainError('conflict', `order ${order.id} has an active loan`, {
        reason: 'loan_active_exists',
      });
    }

    const created = transition(customerLoanMachine, { state: null }, 'create', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    const id = newId();
    // No `returning`: the row is read back through its read policy below.
    await ctx.tx.insert(cl).values({
      id,
      entityId: input.entityId,
      accountId: order.accountId,
      salesOrderId: order.id,
      lenderId,
      lenderName,
      amount: input.amount,
      state: created.to,
      stateChangedAt: ctx.now,
      reference: input.reference ?? null,
      gatesJson: input.gates,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'customer_loan',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        loanState: created.to,
        loanAmount: input.amount,
        lenderName: shownLender,
        loanReference: input.reference ?? null,
        dispatchGate: input.gates.dispatch,
      },
    });
    ctx.emit({
      type: 'crm.loan.created',
      entityId: input.entityId,
      aggregateType: 'customer_loan',
      aggregateId: id,
      payload: { accountId: order.accountId, salesOrderId: order.id, state: 'applied' },
    });
    return readCustomerLoan(ctx, input.entityId, id);
  },
});
