import {
  CancelProformaInput,
  DomainError,
  IssueProformaInput,
  newId,
  ProformaDto,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { nextDocumentNo } from '../../numbering/next-document-no';
import { readProforma } from '../../queries/finance/finance-dto';
import { transition } from '../../state-machines/define-machine';
import { proformaMachine, type ProformaMachineState } from '../../state-machines/machines/proforma';
import { requireEntity } from '../crm/opportunity-shared';

/** The order a proforma is issued from, as the caller reads it; `order_missing` otherwise. */
async function readOrder(ctx: CommandContext, entityId: number, orderId: string) {
  const so = schema.salesOrders;
  const [row] = await ctx.tx
    .select()
    .from(so)
    .where(and(eq(so.id, orderId), eq(so.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `order ${orderId} is not visible`, {
      reason: 'order_missing',
    });
  }
  return row;
}

/**
 * `finance.proforma.issue` (docs/03-roadmap-appendix/phase5.md §6.1, question 3 (a)): Accounts
 * issue a proforma of a confirmed order. Its place of supply, totals and lines (prices, HSN codes,
 * tax rates and the tax split) are the order's, copied as they stand and never worked out again,
 * so a later change of a price or a rate never reaches it; the insert policies hold every copied
 * value to the order's. The number is the next of the company's `proforma` series for the
 * financial year, drawn in this transaction, so a refusal returns it and the series has no gaps.
 * One proforma of an order is live at a time. People only.
 */
export const issueProforma = defineCommand({
  name: 'finance.proforma.issue',
  permission: 'finance.proforma.write',
  minScope: 'entity',
  peopleOnly: true,
  input: IssueProformaInput,
  output: ProformaDto,
  auditFields: ['proformaNo', 'soNo', 'state', 'grandTotal'],
  constraintReasons: {
    proformas_order_live_unique: 'proforma_already_issued',
    proformas_entity_no_unique: 'concurrent_change',
  },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const order = await readOrder(ctx, input.entityId, input.orderId);
    const issued = transition(proformaMachine, { state: null, orderState: order.state }, 'issue', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    const p = schema.proformas;
    const [live] = await ctx.tx
      .select({ id: p.id })
      .from(p)
      .where(and(eq(p.salesOrderId, order.id), eq(p.state, 'issued')))
      .limit(1);
    if (live) {
      throw new DomainError('conflict', `order ${order.id} has a live proforma`, {
        reason: 'proforma_already_issued',
      });
    }
    const l = schema.salesOrderLines;
    const lines = await ctx.tx
      .select()
      .from(l)
      .where(eq(l.salesOrderId, order.id))
      .orderBy(asc(l.position));
    if (lines.length === 0) {
      throw new DomainError('internal', `order ${order.id} has no lines`);
    }
    const [entity] = await ctx.tx
      .select({ code: schema.entities.code })
      .from(schema.entities)
      .where(eq(schema.entities.id, order.entityId))
      .limit(1);
    if (!entity) throw new DomainError('internal', `company ${String(order.entityId)} is missing`);
    const number = await nextDocumentNo(ctx, order.entityId, entity.code, 'proforma');

    const id = newId();
    await ctx.tx.insert(p).values({
      id,
      entityId: order.entityId,
      proformaNo: number.formatted,
      fy: number.fy,
      salesOrderId: order.id,
      state: issued.to,
      placeOfSupplyState: order.placeOfSupplyState,
      supplyKind: order.supplyKind,
      subtotal: order.subtotal,
      cgst: order.cgst,
      sgst: order.sgst,
      igst: order.igst,
      taxTotal: order.taxTotal,
      roundOff: order.roundOff,
      grandTotal: order.grandTotal,
      createdBy: ctx.principal.id,
    });
    // The order's lines, copied value for value: nothing here is priced or taxed again.
    await ctx.tx.insert(schema.proformaLines).values(
      lines.map((line) => ({
        id: newId(),
        entityId: line.entityId,
        proformaId: id,
        salesOrderLineId: line.id,
        position: line.position,
        itemId: line.itemId,
        kitId: line.kitId,
        sku: line.sku,
        description: line.description,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        hsn: line.hsn,
        worksContract: line.worksContract,
        taxRateId: line.taxRateId,
        taxRatePct: line.taxRatePct,
        compositeRuleId: line.compositeRuleId,
        goodsRatePct: line.goodsRatePct,
        servicesRatePct: line.servicesRatePct,
        taxableValue: line.taxableValue,
        goodsTaxable: line.goodsTaxable,
        servicesTaxable: line.servicesTaxable,
        cgst: line.cgst,
        sgst: line.sgst,
        igst: line.igst,
        lineTotal: line.lineTotal,
      })),
    );
    ctx.audit({
      aggregateType: 'proforma',
      aggregateId: id,
      entityId: order.entityId,
      after: {
        proformaNo: number.formatted,
        soNo: order.soNo,
        state: issued.to,
        grandTotal: order.grandTotal,
      },
    });
    ctx.emit({
      type: 'finance.proforma.issued',
      entityId: order.entityId,
      aggregateType: 'proforma',
      aggregateId: id,
      payload: { orderId: order.id, lineCount: lines.length },
    });
    // The render worker prints it on the company's letterhead and attaches the PDF.
    ctx.emit({
      type: 'print.document.requested',
      entityId: order.entityId,
      aggregateType: 'proforma',
      aggregateId: id,
      payload: { documentType: 'proforma', documentId: id, version: 1 },
    });
    return readProforma(ctx, order.entityId, order.id, id);
  },
});

/**
 * `finance.proforma.cancel` (docs/03-roadmap-appendix/phase5.md §6.1): Accounts withdraw an issued
 * proforma, with a reason. Its number stays used: the series never gives it again, and the
 * order may be issued a new proforma. People only.
 */
export const cancelProforma = defineCommand({
  name: 'finance.proforma.cancel',
  permission: 'finance.proforma.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CancelProformaInput,
  output: ProformaDto,
  auditFields: ['state', 'cancelReason'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const p = schema.proformas;
    const [row] = await ctx.tx
      .select()
      .from(p)
      .where(and(eq(p.id, input.proformaId), eq(p.entityId, input.entityId)))
      .for('update')
      .limit(1);
    if (!row) {
      throw new DomainError('not_found', `proforma ${input.proformaId} is not visible`, {
        reason: 'proforma_missing',
      });
    }
    const cancelled = transition(
      proformaMachine,
      { state: row.state as ProformaMachineState, orderState: '' },
      'cancel',
      {
        actor: { kind: 'principal', principal: ctx.principal },
        now: ctx.now,
        params: { reason: input.reason },
      },
    );
    const done = await ctx.tx
      .update(p)
      .set({
        state: cancelled.to,
        cancelReason: input.reason,
        cancelledAt: ctx.now,
        cancelledBy: ctx.principal.id,
        updatedBy: ctx.principal.id,
      })
      .where(eq(p.id, row.id))
      .returning({ id: p.id });
    if (done.length !== 1) {
      throw new DomainError('forbidden', `proforma ${row.id} is outside the caller's scope`);
    }
    ctx.audit({
      aggregateType: 'proforma',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: cancelled.to, cancelReason: input.reason },
    });
    ctx.emit({
      type: 'finance.proforma.cancelled',
      entityId: row.entityId,
      aggregateType: 'proforma',
      aggregateId: row.id,
      payload: { orderId: row.salesOrderId },
    });
    // Printed again with "Cancelled" across it, so the copy people open says so (review finding 5).
    ctx.emit({
      type: 'print.document.requested',
      entityId: row.entityId,
      aggregateType: 'proforma',
      aggregateId: row.id,
      payload: { documentType: 'proforma', documentId: row.id, version: 2 },
    });
    return readProforma(ctx, row.entityId, row.salesOrderId, row.id);
  },
});
