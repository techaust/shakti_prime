import { DomainError, SalesOrderDto, SalesOrderReasonInput } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readSalesOrder, salesOrderRecordOf } from '../../queries/sales/order-dto';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import { transition } from '../../state-machines/define-machine';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
import { lockSalesOrder, writeSalesOrder } from './order-shared';

/**
 * `sales.order.cancel` (docs/03-roadmap-appendix/phase1.md §8.3, PRD SAL-06): the General Manager or the
 * Executive cancels a draft or confirmed order, with a reason. A confirmed order's referral
 * commission is cancelled with it (`app.cancel_commission_accrual()`). The lead stays won: the
 * opportunity machine has no move out of won. People only.
 */
export const cancelSalesOrder = defineCommand({
  name: 'sales.order.cancel',
  permission: 'sales.order.cancel',
  minScope: 'entity',
  peopleOnly: true,
  input: SalesOrderReasonInput,
  output: SalesOrderDto,
  auditFields: [...ORDER_AUDIT_FIELDS],
  async handler(ctx, input) {
    const { row, accountType } = await lockSalesOrder(ctx, input.entityId, input.orderId);
    const cancelled = transition(
      salesOrderMachine,
      salesOrderRecordOf(row, accountType),
      'cancel',
      {
        actor: { kind: 'principal', principal: ctx.principal },
        now: ctx.now,
        params: { reason: input.reason },
      },
    );
    if (cancelled.from !== 'draft' && cancelled.from !== 'confirmed') {
      throw new DomainError('internal', `cancel fired from ${String(cancelled.from)}`);
    }
    await writeSalesOrder(ctx, row, {
      state: cancelled.to,
      stateChangedAt: ctx.now,
      cancelReason: input.reason,
    });
    if (cancelled.from === 'confirmed' && row.opportunityId !== null) {
      const [result] = (await ctx.tx.execute(
        sql`select app.cancel_commission_accrual(${row.id}::uuid) as id`,
      )) as unknown as { id: string | null }[];
      if (result?.id) {
        ctx.audit({
          aggregateType: 'commission_accrual',
          aggregateId: result.id,
          entityId: row.entityId,
          before: { commissionState: 'accrued' },
          after: { commissionState: 'cancelled' },
        });
      }
    }
    ctx.audit({
      aggregateType: 'sales_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { orderState: row.state },
      after: { orderState: cancelled.to, cancelReason: input.reason },
    });
    ctx.emit({
      type: 'sales.order.cancelled',
      entityId: row.entityId,
      aggregateType: 'sales_order',
      aggregateId: row.id,
      payload: {
        accountId: row.accountId,
        opportunityId: row.opportunityId,
        fromState: cancelled.from,
      },
    });
    return readSalesOrder(ctx, row.entityId, row.id);
  },
});
