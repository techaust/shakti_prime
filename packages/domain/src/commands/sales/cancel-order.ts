import { DomainError, SalesOrderDto, SalesOrderReasonInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { readSalesOrder, salesOrderRecordOf } from '../../queries/sales/order-dto';
import { ORDER_AUDIT_FIELDS } from '../../sales/save-order';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { salesOrderMachine } from '../../state-machines/machines/sales-order';
import { lockSalesOrder, writeSalesOrder } from './order-shared';
import { lockQuote, quoteRecordOf } from './quote-shared';

/**
 * The accepted quote of a cancelled order, draft or confirmed, is withdrawn with the cancel reason
 * (the quote machine's `order.cancel`), keeping how it was accepted, so its lead has no accepted
 * quote left and may be quoted and accepted again (DOM-4), and merged while it is open.
 */
async function withdrawAcceptedQuote(
  ctx: CommandContext,
  entityId: number,
  quoteId: string,
  reason: string,
): Promise<void> {
  const quote = await lockQuote(ctx, entityId, quoteId);
  const withdrawn = transition(quoteMachine, quoteRecordOf(quote), 'order.cancel', {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: { reason },
  });
  const done = await ctx.tx
    .update(schema.quotes)
    .set({
      state: withdrawn.to,
      stateChangedAt: ctx.now,
      withdrawnReason: reason,
      updatedBy: ctx.principal.id,
    })
    .where(eq(schema.quotes.id, quote.id))
    .returning({ id: schema.quotes.id });
  if (done.length !== 1) {
    throw new DomainError('forbidden', `quote ${quote.id} is outside the caller's scope`);
  }
  ctx.audit({
    aggregateType: 'quote',
    aggregateId: quote.id,
    entityId: quote.entityId,
    before: { state: quote.state },
    after: { state: withdrawn.to, withdrawnReason: reason },
  });
}

/**
 * `sales.order.cancel` (docs/03-roadmap-appendix/phase1.md §8.3, PRD SAL-06): the General Manager or the
 * Executive cancels a draft or confirmed order, with a reason. A confirmed order's referral
 * commission is cancelled with it (`app.cancel_commission_accrual()`). A credit hold ends with the
 * order (DOM-5): the audit row keeps the rule it was held for. The order's accepted quote is
 * withdrawn with the reason, so the lead may take another sale (DOM-4); the lead of a confirmed
 * order stays won, since the opportunity machine has no move out of won, and its next confirmed
 * order earns its own commission, the cancelled one's being cancelled. People only.
 */
export const cancelSalesOrder = defineCommand({
  name: 'sales.order.cancel',
  permission: 'sales.order.cancel',
  minScope: 'entity',
  peopleOnly: true,
  input: SalesOrderReasonInput,
  output: SalesOrderDto,
  auditFields: [...ORDER_AUDIT_FIELDS, 'state', 'withdrawnReason'],
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
      creditHeldAt: null,
      creditHoldReason: null,
      creditHoldJson: null,
    });
    if (row.quoteId !== null && row.opportunityId !== null) {
      await withdrawAcceptedQuote(ctx, row.entityId, row.quoteId, input.reason);
      ctx.emit({
        type: 'sales.quote.withdrawn',
        entityId: row.entityId,
        aggregateType: 'quote',
        aggregateId: row.quoteId,
        payload: { opportunityId: row.opportunityId },
      });
    }
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
      before: { orderState: row.state, creditHoldReason: row.creditHoldReason },
      after: { orderState: cancelled.to, cancelReason: input.reason, creditHoldReason: null },
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
