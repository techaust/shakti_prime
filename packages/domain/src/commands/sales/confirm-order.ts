import {
  ConfirmSalesOrderDto,
  DomainError,
  isStaleSizing,
  newId,
  SalesOrderRefInput,
  type AccountType,
  type CommissionBasis,
  type Money,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { latestSizing } from '../../queries/crm/latest-sizing';
import { readSalesOrder, salesOrderRecordOf } from '../../queries/sales/order-dto';
import { commissionAmount } from '../../sales/commission';
import { creditCheck, type CreditFacts } from '../../sales/credit-check';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import { transition } from '../../state-machines/define-machine';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
import { reopenOpportunity } from '../crm/reopen-opportunity';
import { winOpportunity } from '../crm/win-opportunity';
import { lockSalesOrder, writeSalesOrder, type SalesOrderRow } from './order-shared';

/** An amount the database answers as `numeric(14,2)` text, as money. */
function money(value: string | null): Money | null {
  if (value === null) return null;
  if (!/^\d{1,12}\.\d{2}$/.test(value)) {
    throw new DomainError('internal', `not a money amount: ${value}`);
  }
  return value;
}

/**
 * The credit facts of the order's customer in the order's company (SAL-07): for a dealer, the
 * newest terms, the newest outstanding entry and the confirmed unpaid orders since that entry's
 * date (`app.dealer_credit_position()`, which reads every order of the dealer, not only those the
 * caller reads); a customer who is not a dealer is never checked.
 */
async function creditFactsOf(
  ctx: CommandContext,
  row: SalesOrderRow,
  accountType: AccountType,
): Promise<CreditFacts> {
  const facts: CreditFacts = {
    accountType,
    creditLimit: null,
    creditDays: null,
    outstanding: '0.00',
    confirmedUnpaid: '0.00',
    orderValue: row.grandTotal,
    oldestOverdueDays: null,
    oldestOverdueInvoiceNo: null,
  };
  if (accountType !== 'dealer') return facts;
  const [position] = (await ctx.tx.execute(
    sql`select credit_limit::numeric(14, 2)::text as "creditLimit", credit_days as "creditDays",
               outstanding::numeric(14, 2)::text as "outstanding",
               oldest_overdue_days as "oldestOverdueDays",
               oldest_overdue_invoice_no as "oldestOverdueInvoiceNo",
               confirmed_unpaid::numeric(14, 2)::text as "confirmedUnpaid"
          from app.dealer_credit_position(${row.entityId}::smallint, ${row.accountId}::uuid, ${row.id}::uuid)`,
  )) as unknown as {
    creditLimit: string | null;
    creditDays: number | null;
    outstanding: string;
    oldestOverdueDays: number | null;
    oldestOverdueInvoiceNo: string | null;
    confirmedUnpaid: string;
  }[];
  if (!position) throw new DomainError('internal', 'the dealer credit position answered nothing');
  return {
    ...facts,
    creditLimit: money(position.creditLimit),
    creditDays: position.creditDays,
    outstanding: money(position.outstanding) ?? '0.00',
    confirmedUnpaid: money(position.confirmedUnpaid) ?? '0.00',
    oldestOverdueDays: position.oldestOverdueDays,
    oldestOverdueInvoiceNo: position.oldestOverdueInvoiceNo,
  };
}

/**
 * The lead of a confirmed order is won (`crm.opportunity.win`, which ends its open callbacks and
 * nurture calls); a lead in nurture is opened again first. A lead already won stays won, and a
 * lost lead is left as it is: reopening it is a person's decision.
 */
async function winLead(ctx: CommandContext, row: SalesOrderRow): Promise<void> {
  if (row.opportunityId === null) return;
  const o = schema.opportunities;
  const [lead] = await ctx.tx
    .select({ state: o.state })
    .from(o)
    .where(eq(o.id, row.opportunityId))
    .limit(1);
  const ref = { entityId: row.entityId, opportunityId: row.opportunityId };
  if (lead?.state === 'nurture') await ctx.run(reopenOpportunity, ref);
  if (lead?.state === 'open' || lead?.state === 'nurture') await ctx.run(winOpportunity, ref);
}

/** The lead's system size in kW and pump rating in HP from its newest sizing, when current. */
async function leadSize(
  ctx: CommandContext,
  row: SalesOrderRow & { opportunityId: string },
): Promise<{ kw: number | null; hp: number | null }> {
  const sizing = await latestSizing(ctx, {
    entityId: row.entityId,
    opportunityId: row.opportunityId,
  });
  if (sizing === null || isStaleSizing(sizing)) return { kw: null, hp: null };
  if (sizing.kind === 'pump') {
    return {
      kw: sizing.result.solar?.arrayKwp ?? null,
      hp: sizing.result.power.standardHp,
    };
  }
  return { kw: sizing.result.rooftop.recommendedKwp, hp: null };
}

/**
 * The referral partner's commission on the confirmed order of their lead (CRM-09): by the rule in
 * force on the confirmation date (`app.order_commission_rule()`, since the caller cannot read the
 * rules), worked out by `commissionAmount()` and recorded through
 * `app.record_commission_accrual()`, which checks it again. No rule, or a per-kW or per-HP rule
 * with no current sizing of the lead, records nothing: nothing is invented (CRM-5).
 */
async function accrueCommission(ctx: CommandContext, row: SalesOrderRow): Promise<void> {
  if (row.opportunityId === null) return;
  const [rule] = (await ctx.tx.execute(
    sql`select rule_id as "ruleId", partner_id as "partnerId", basis, amount::numeric(14, 2)::text as "amount"
          from app.order_commission_rule(${row.id}::uuid)`,
  )) as unknown as { ruleId: string; partnerId: string; basis: CommissionBasis; amount: string }[];
  if (!rule) return;
  const size =
    rule.basis === 'per_kw' || rule.basis === 'per_hp'
      ? await leadSize(ctx, { ...row, opportunityId: row.opportunityId })
      : { kw: null, hp: null };
  const commission = commissionAmount({
    basis: rule.basis,
    rate: money(rule.amount) ?? '0.00',
    taxableValue: row.subtotal,
    ...size,
  });
  if (commission === null) return;
  const id = newId();
  const [recorded] = (await ctx.tx.execute(
    sql`select app.record_commission_accrual(${id}::uuid, ${row.id}::uuid, ${rule.ruleId}::uuid,
                                             ${commission.measure}::numeric,
                                             ${commission.amount}::numeric) as id`,
  )) as unknown as { id: string | null }[];
  if (!recorded?.id) return;
  ctx.audit({
    aggregateType: 'commission_accrual',
    aggregateId: id,
    entityId: row.entityId,
    after: {
      salesOrderId: row.id,
      partnerId: rule.partnerId,
      commissionRuleId: rule.ruleId,
      commissionBasis: rule.basis,
      commissionAmount: commission.amount,
    },
  });
  ctx.emit({
    type: 'sales.commission.accrued',
    entityId: row.entityId,
    aggregateType: 'commission_accrual',
    aggregateId: id,
    payload: { orderId: row.id, partnerId: rule.partnerId, ruleId: rule.ruleId },
  });
}

/**
 * `sales.order.confirm` (docs/design/phase1.md §8.3, PRD SAL-06, SAL-07): confirms a draft order
 * after the dealer credit check (`creditCheck()`, SALE-5: the dealer's outstanding, the confirmed
 * orders not yet in it and this order against the limit, and the oldest overdue invoice against
 * the credit days). A block is not a refusal: the order stays a draft, held for credit with the
 * rule and the facts its sentence names (committed), the command answers `held`, and
 * `sales.order.credit_held` lets the Executive and the person who made the order know. An
 * Executive's release lets the next confirmation pass the block once. A customer who is not a
 * dealer passes. Confirming an order of a lead wins the lead and records its referral partner's
 * commission. People only.
 */
export const confirmSalesOrder = defineCommand({
  name: 'sales.order.confirm',
  permission: 'sales.order.confirm',
  minScope: 'own',
  peopleOnly: true,
  input: SalesOrderRefInput,
  output: ConfirmSalesOrderDto,
  auditFields: [...ORDER_AUDIT_FIELDS, 'commissionBasis', 'commissionAmount'],
  async handler(ctx, input) {
    const { row, accountType } = await lockSalesOrder(ctx, input.entityId, input.orderId);
    const credit = await creditFactsOf(ctx, row, accountType);
    const record = { ...salesOrderRecordOf(row, accountType), credit };
    const actor = { kind: 'principal' as const, principal: ctx.principal };
    const check = creditCheck(credit, record.creditRelease);

    if (check.blocked) {
      transition(salesOrderMachine, record, 'credit.hold', { actor, now: ctx.now, params: {} });
      const reason = check.failure.reason;
      await writeSalesOrder(ctx, row, {
        creditHeldAt: ctx.now,
        creditHoldReason: reason,
        creditHoldJson: check.failure.details ?? {},
      });
      ctx.audit({
        aggregateType: 'sales_order',
        aggregateId: row.id,
        entityId: row.entityId,
        before: { orderState: row.state, creditHoldReason: row.creditHoldReason },
        after: { orderState: row.state, creditHoldReason: reason },
      });
      ctx.emit({
        type: 'sales.order.credit_held',
        entityId: row.entityId,
        aggregateType: 'sales_order',
        aggregateId: row.id,
        payload: { accountId: row.accountId, createdBy: row.createdBy, reason },
      });
      return { outcome: 'held' as const, order: await readSalesOrder(ctx, row.entityId, row.id) };
    }

    const confirmed = transition(salesOrderMachine, record, 'confirm', {
      actor,
      now: ctx.now,
      params: {},
    });
    await writeSalesOrder(ctx, row, {
      state: confirmed.to,
      stateChangedAt: ctx.now,
      confirmedAt: ctx.now,
      confirmedBy: ctx.principal.id,
      creditHeldAt: null,
      creditHoldReason: null,
      creditHoldJson: null,
    });
    ctx.audit({
      aggregateType: 'sales_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { orderState: row.state, creditHoldReason: row.creditHoldReason },
      after: { orderState: confirmed.to, creditHoldReason: null, released: check.released },
    });
    ctx.emit({
      type: 'sales.order.confirmed',
      entityId: row.entityId,
      aggregateType: 'sales_order',
      aggregateId: row.id,
      payload: {
        accountId: row.accountId,
        opportunityId: row.opportunityId,
        released: check.released,
      },
    });
    await winLead(ctx, row);
    await accrueCommission(ctx, row);
    return {
      outcome: 'confirmed' as const,
      order: await readSalesOrder(ctx, row.entityId, row.id),
    };
  },
});
