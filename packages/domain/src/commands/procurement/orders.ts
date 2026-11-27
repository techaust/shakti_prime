import {
  ApprovePurchaseOrderInput,
  CancelPurchaseOrderInput,
  ClosePurchaseOrderInput,
  CreatePurchaseOrderInput,
  DomainError,
  newId,
  PO_PDF_AS_APPROVED,
  PO_PDF_CANCELLED,
  PurchaseOrderPdfDto,
  PurchaseOrderRefDto,
  RequestPurchaseOrderPdfInput,
  SendPurchaseOrderInput,
  UpdatePurchaseOrderInput,
  type PurchaseOrderPdfVersion,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { nextDocumentNo } from '../../numbering/next-document-no';
import { getPurchaseOrderPdf } from '../../queries/procurement/order-queries';
import { readsRates } from '../../queries/procurement/vendor-read';
import {
  activeVendor,
  assertRatesAllowed,
  deliveryHub,
  lockOrder,
  ORDER_CONSTRAINT_REASONS,
  orderLines,
  orderRecord,
  orderRef,
  orderTransition,
  setOrderState,
  writeLines,
  type KeptRate,
} from './po-shared';

/**
 * Purchase orders (docs/03-roadmap-appendix/phase3.md §7.2): drafted and edited with
 * `procurement.po.write`, approved with `procurement.po.approve` (question 5 (a)), sent, cancelled
 * and short-closed with `procurement.po.write`. A rate is written only under the caller's own
 * `procurement.rate.read`; no audit value, event or answer carries a rate or an amount.
 */

const ORDER_AUDIT_FIELDS = [
  'poNo',
  'state',
  'lineCount',
  'expectedAt',
  'poNotes',
  'approvedAt',
  'sentVia',
  'cancelReason',
  'closeReason',
] as const;

/** The company's code, for the order's number. */
async function entityCode(ctx: CommandContext, entityId: number): Promise<string> {
  const [row] = await ctx.tx
    .select({ code: schema.entities.code })
    .from(schema.entities)
    .where(eq(schema.entities.id, entityId))
    .limit(1);
  if (!row) throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  return row.code;
}

/**
 * Asks the render worker for an order's PDF of one version (ADR 0009, review R2): it prints the
 * order with its rates on the company's letterhead and stores it as a `purchase_order_pdf` file
 * whose id comes from the order and the version, so a second request finds the same file.
 */
function requestOrderPdf(
  ctx: CommandContext,
  row: { id: string; entityId: number },
  version: PurchaseOrderPdfVersion,
): void {
  ctx.emit({
    type: 'print.document.requested',
    entityId: row.entityId,
    aggregateType: 'purchase_order',
    aggregateId: row.id,
    payload: { documentType: 'purchase_order', documentId: row.id, version },
  });
}

/** `procurement.po.create`: a draft purchase order, numbered from the company's series. */
export const createPurchaseOrder = defineCommand({
  name: 'procurement.po.create',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CreatePurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  // The audit row keeps what was asked without any rate, which lives only in `po_line_rates`.
  auditInput: (input) => ({
    entityId: input.entityId,
    vendorId: input.vendorId,
    deliverToWarehouseId: input.deliverToWarehouseId,
    expectedAt: input.expectedAt ?? null,
    lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
  }),
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    if (!ctx.entityIds.includes(input.entityId)) {
      throw new DomainError('forbidden', 'entity outside the request scope', {
        entityId: input.entityId,
      });
    }
    assertRatesAllowed(ctx, input.lines);
    const vendor = await activeVendor(ctx, input.vendorId);
    const hub = await deliveryHub(ctx, input.deliverToWarehouseId);
    orderTransition(
      ctx,
      {
        state: null,
        lineCount: input.lines.length,
        linesComplete: false,
        grandTotalPaise: null,
        draftedBy: ctx.principal.id,
      },
      'create',
    );
    const code = await entityCode(ctx, input.entityId);
    const number = await nextDocumentNo(ctx, input.entityId, code, 'purchase_order');
    const id = newId();
    await ctx.tx.insert(schema.purchaseOrders).values({
      id,
      entityId: input.entityId,
      poNo: number.formatted,
      vendorId: vendor.id,
      deliverToWarehouseId: hub.id,
      state: 'draft',
      source: 'manual',
      expectedAt: input.expectedAt ?? null,
      draftedBy: ctx.principal.id,
      vendorStateCode: vendor.stateCode,
      placeOfSupplyStateCode: hub.stateCode,
      notes: input.notes ?? null,
      createdBy: ctx.principal.id,
    });
    const lineCount = await writeLines(
      ctx,
      { id, entityId: input.entityId, vendorId: vendor.id },
      input.lines,
    );
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: id,
      entityId: input.entityId,
      before: null,
      after: {
        poNo: number.formatted,
        state: 'draft',
        lineCount,
        expectedAt: input.expectedAt ?? null,
        vendorId: vendor.id,
        deliverToWarehouseId: hub.id,
      },
    });
    ctx.emit({
      type: 'procurement.po.drafted',
      entityId: input.entityId,
      aggregateType: 'purchase_order',
      aggregateId: id,
      payload: { source: 'manual', vendorId: vendor.id, lineCount },
    });
    return orderRef({ id, entityId: input.entityId, poNo: number.formatted }, 'draft');
  },
});

/**
 * `procurement.po.update`: a draft's hub, expected date, notes and lines. Lines given replace the
 * draft's lines as a set; a line whose rate is left out keeps the rate its item had, read under
 * the caller's own `procurement.rate.read` (without it, nothing is read and the rate is not kept).
 * Whoever writes the draft becomes its drafter.
 */
export const updatePurchaseOrder = defineCommand({
  name: 'procurement.po.update',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: UpdatePurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  auditInput: (input) => ({
    purchaseOrderId: input.purchaseOrderId,
    deliverToWarehouseId: input.deliverToWarehouseId,
    expectedAt: input.expectedAt,
    lines: input.lines?.map((l) => ({ itemId: l.itemId, qty: l.qty })),
  }),
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    assertRatesAllowed(ctx, input.lines ?? []);
    const row = await lockOrder(ctx, input.purchaseOrderId);
    const before = await orderLines(ctx, row.id);
    orderTransition(
      ctx,
      {
        state: row.state as 'draft',
        lineCount: input.lines?.length ?? before.length,
        linesComplete: false,
        grandTotalPaise: null,
        draftedBy: row.draftedBy,
      },
      'update',
    );
    const hub =
      input.deliverToWarehouseId === undefined
        ? { id: row.deliverToWarehouseId, stateCode: row.placeOfSupplyStateCode }
        : await deliveryHub(ctx, input.deliverToWarehouseId);
    const vendor = await activeVendor(ctx, row.vendorId);
    const expectedAt = input.expectedAt === undefined ? row.expectedAt : input.expectedAt;
    const notes = input.notes === undefined ? row.notes : input.notes;
    await ctx.tx
      .update(schema.purchaseOrders)
      .set({
        deliverToWarehouseId: hub.id,
        placeOfSupplyStateCode: hub.stateCode,
        vendorStateCode: vendor.stateCode,
        expectedAt,
        notes,
        draftedBy: ctx.principal.id,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.purchaseOrders.id, row.id));

    let lineCount = before.length;
    if (input.lines !== undefined) {
      // The rates the caller may keep: read under their own grant, by item.
      const kept = new Map<string, KeptRate>();
      if (readsRates(ctx.principal) && before.length > 0) {
        const r = schema.poLineRates;
        const rates = await ctx.tx
          .select({ poLineId: r.poLineId, unitRate: r.unitRate, quoteId: r.quoteId })
          .from(r)
          .where(
            and(
              inArray(
                r.poLineId,
                before.map((l) => l.id),
              ),
              isNotNull(r.unitRate),
            ),
          );
        const itemOf = new Map(before.map((l) => [l.id, l.itemId]));
        for (const rate of rates) {
          const itemId = itemOf.get(rate.poLineId);
          if (itemId !== undefined)
            kept.set(itemId, { unitRate: rate.unitRate, quoteId: rate.quoteId });
        }
      }
      await ctx.tx.delete(schema.poLines).where(eq(schema.poLines.poId, row.id));
      lineCount = await writeLines(
        ctx,
        { id: row.id, entityId: row.entityId, vendorId: row.vendorId },
        input.lines,
        kept,
      );
    }
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: {
        lineCount: before.length,
        expectedAt: row.expectedAt,
        poNotes: row.notes,
        deliverToWarehouseId: row.deliverToWarehouseId,
      },
      after: { lineCount, expectedAt, poNotes: notes, deliverToWarehouseId: hub.id },
    });
    return orderRef(row, 'draft');
  },
});

/**
 * `procurement.po.approve` (question 5 (a)): every line has its rate and GST rate; the approver
 * did not draft the order unless they are an Executive; one who is not an Executive approves only
 * a grand total including GST below `WORKSHOP_DEFAULTS.procurement.poApprovalFromRupees`. The
 * approver reads the rates to weigh the total, so the command also needs `procurement.rate.read`.
 */
export const approvePurchaseOrder = defineCommand({
  name: 'procurement.po.approve',
  permission: 'procurement.po.approve',
  minScope: 'entity',
  alsoRequires: [{ permission: 'procurement.rate.read', minScope: 'entity' }],
  peopleOnly: true,
  input: ApprovePurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const row = await lockOrder(ctx, input.purchaseOrderId);
    const to = orderTransition(ctx, await orderRecord(ctx, row), 'approve');
    await setOrderState(ctx, row, to, { approvedBy: ctx.principal.id, approvedAt: ctx.now });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state, approvedAt: null },
      after: { state: to, approvedAt: ctx.now.toISOString() },
    });
    ctx.emit({
      type: 'procurement.po.approved',
      entityId: row.entityId,
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      payload: { vendorId: row.vendorId },
    });
    // The PDF is printed as soon as the order is approved, ready to download or mail.
    requestOrderPdf(ctx, row, PO_PDF_AS_APPROVED);
    return orderRef(row, to);
  },
});

/**
 * `procurement.po.send`: by email to one of the vendor's people with an email address, or marked
 * sent by hand. The order is sent at once; the render worker takes `procurement.po.sent`, prints the
 * PDF as approved (or finds it stored) and, by email, mails it to that person, the sender's address
 * to reply to; when it cannot, the order stays sent and the sender is told to send the PDF
 * themselves.
 */
export const sendPurchaseOrder = defineCommand({
  name: 'procurement.po.send',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SendPurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const row = await lockOrder(ctx, input.purchaseOrderId);
    const to = orderTransition(ctx, await orderRecord(ctx, row), 'send');
    if (input.vendorContactId !== undefined) {
      const c = schema.vendorContacts;
      const [contact] = await ctx.tx
        .select({ id: c.id })
        .from(c)
        .where(
          and(eq(c.id, input.vendorContactId), eq(c.vendorId, row.vendorId), isNotNull(c.email)),
        )
        .limit(1);
      if (!contact) {
        throw new DomainError('validation_failed', 'the vendor’s person has no email address', {
          reason: 'purchase_order_contact_email_missing',
        });
      }
    }
    await setOrderState(ctx, row, to, { sentAt: ctx.now, sentVia: input.via });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state, sentVia: null },
      after: { state: to, sentVia: input.via, vendorContactId: input.vendorContactId ?? null },
    });
    ctx.emit({
      type: 'procurement.po.sent',
      entityId: row.entityId,
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      payload: {
        vendorId: row.vendorId,
        via: input.via,
        vendorContactId: input.vendorContactId ?? null,
        sentBy: ctx.principal.id,
      },
    });
    return orderRef(row, to);
  },
});

/** `procurement.po.cancel`: a draft, approved or sent order, with a reason. */
export const cancelPurchaseOrder = defineCommand({
  name: 'procurement.po.cancel',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: CancelPurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const row = await lockOrder(ctx, input.purchaseOrderId);
    const to = orderTransition(ctx, await orderRecord(ctx, row), 'cancel', {
      reason: input.reason,
    });
    await setOrderState(ctx, row, to, { cancelReason: input.reason });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state, cancelReason: null },
      after: { state: to, cancelReason: input.reason },
    });
    ctx.emit({
      type: 'procurement.po.cancelled',
      entityId: row.entityId,
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      payload: { vendorId: row.vendorId },
    });
    // An order cancelled after its approval prints again, marked cancelled; a draft never printed.
    if (row.approvedAt !== null) requestOrderPdf(ctx, row, PO_PDF_CANCELLED);
    return orderRef(row, to);
  },
});

/** `procurement.po.close`: a partly or fully received order, closed with a reason. */
export const closePurchaseOrder = defineCommand({
  name: 'procurement.po.close',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ClosePurchaseOrderInput,
  output: PurchaseOrderRefDto,
  auditFields: ORDER_AUDIT_FIELDS,
  constraintReasons: ORDER_CONSTRAINT_REASONS,
  async handler(ctx, input) {
    const row = await lockOrder(ctx, input.purchaseOrderId);
    const to = orderTransition(ctx, await orderRecord(ctx, row), 'close', {
      reason: input.reason,
    });
    await setOrderState(ctx, row, to, { closeReason: input.reason });
    ctx.audit({
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state, closeReason: null },
      after: { state: to, closeReason: input.reason },
    });
    ctx.emit({
      type: 'procurement.po.closed',
      entityId: row.entityId,
      aggregateType: 'purchase_order',
      aggregateId: row.id,
      payload: { vendorId: row.vendorId, shortClosed: row.state === 'partially_received' },
    });
    return orderRef(row, to);
  },
});

/**
 * `procurement.po.pdf.request`: a person who reads supplier rates asks for an order's PDF (review
 * R2). It answers the file of the version the order prints now, `ready` once the render worker
 * stored it; otherwise it asks the worker to print it, and the screen waits for that file. A
 * draft, an order never approved, or one the person may not read is `not_found`. Nothing changes,
 * so nothing is audited.
 */
export const requestPurchaseOrderPdf = defineCommand({
  name: 'procurement.po.pdf.request',
  permission: 'procurement.rate.read',
  minScope: 'entity',
  peopleOnly: true,
  input: RequestPurchaseOrderPdfInput,
  output: PurchaseOrderPdfDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const pdf = await getPurchaseOrderPdf(ctx, input);
    const ready = pdf.file?.status === 'ready' && pdf.file.deletedAt === null;
    if (!ready) {
      requestOrderPdf(ctx, { id: pdf.purchaseOrderId, entityId: pdf.entityId }, pdf.version);
    }
    return {
      purchaseOrderId: pdf.purchaseOrderId,
      entityId: pdf.entityId,
      fileId: pdf.fileId,
      ready,
    };
  },
});
