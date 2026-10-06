import { SalesOrderDto, SalesOrderReasonInput } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { readSalesOrder, salesOrderRecordOf } from '../../queries/sales/order-dto';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import { transition } from '../../state-machines/define-machine';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
import { lockSalesOrder, writeSalesOrder } from './order-shared';

/**
 * `sales.credit.release` (docs/design/phase1.md §8.3, PRD SAL-07): the Executive releases the
 * credit hold of a draft order, with a reason, in their own name (audited; a trigger refuses any
 * other request that sets the release). The hold is cleared and the next confirmation passes the
 * credit check once. Held by no agent (SECURITY §3.3), and people only besides.
 */
export const releaseCredit = defineCommand({
  name: 'sales.credit.release',
  permission: 'sales.credit.release',
  minScope: 'all',
  peopleOnly: true,
  input: SalesOrderReasonInput,
  output: SalesOrderDto,
  auditFields: [...ORDER_AUDIT_FIELDS],
  async handler(ctx, input) {
    const { row, accountType } = await lockSalesOrder(ctx, input.entityId, input.orderId);
    transition(salesOrderMachine, salesOrderRecordOf(row, accountType), 'credit.release', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: input.reason },
    });
    await writeSalesOrder(ctx, row, {
      creditHeldAt: null,
      creditHoldReason: null,
      creditHoldJson: null,
      creditReleaseBy: ctx.principal.id,
      creditReleaseReason: input.reason,
      creditReleasedAt: ctx.now,
    });
    ctx.audit({
      aggregateType: 'sales_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { creditHoldReason: row.creditHoldReason, creditReleaseReason: row.creditReleaseReason },
      after: { creditHoldReason: null, creditReleaseReason: input.reason },
    });
    ctx.emit({
      type: 'sales.order.credit_released',
      entityId: row.entityId,
      aggregateType: 'sales_order',
      aggregateId: row.id,
      payload: { accountId: row.accountId },
    });
    return readSalesOrder(ctx, row.entityId, row.id);
  },
});
