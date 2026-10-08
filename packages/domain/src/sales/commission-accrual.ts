import {
  DomainError,
  isStaleSizing,
  newId,
  type CommissionBasis,
  type Money,
} from '@shakti/contracts';
import type { schema } from '@shakti/db';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../command/context';
import { latestSizing } from '../queries/crm/latest-sizing';
import { commissionAmount } from './commission';

type SalesOrderRow = typeof schema.salesOrders.$inferSelect;

/** An amount the database answers as `numeric(14,2)` text, as money. */
export function numericMoney(value: string | null): Money | null {
  if (value === null) return null;
  if (!/^\d{1,12}\.\d{2}$/.test(value)) {
    throw new DomainError('internal', `not a money amount: ${value}`);
  }
  return value;
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
export async function accrueCommission(ctx: CommandContext, row: SalesOrderRow): Promise<void> {
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
    rate: numericMoney(rule.amount) ?? '0.00',
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
