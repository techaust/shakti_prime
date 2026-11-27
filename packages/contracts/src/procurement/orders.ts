import { z } from 'zod';
import { ItemUnitSchema, MoneySchema, RateSchema, SignedMoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { SerialNoSchema, StockQtySchema } from '../inventory/stock';
import { CalendarDateSchema, QuantitySchema } from '../tax/engine';
import { RateInputSchema } from './quotes';

/**
 * Purchase orders, goods receipts and reorder rules (docs/03-roadmap-appendix/phase3.md §7.2).
 * A rate or an amount appears only in the `*WithRates*` shapes, which a query builds only for a
 * reader holding `procurement.rate.read`; every command answers a reference with neither, and no
 * event or audit row carries one.
 */

/** The `purchase_order` machine's states (`purchase_orders_state_check`). */
export const PURCHASE_ORDER_STATES = [
  'draft',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export const PurchaseOrderStateSchema = z.enum(PURCHASE_ORDER_STATES);
export type PurchaseOrderState = z.infer<typeof PurchaseOrderStateSchema>;

/** Who made the order: a person, or the reorder job (`purchase_orders_source_check`). */
export const PURCHASE_ORDER_SOURCES = ['manual', 'reorder'] as const;
export const PurchaseOrderSourceSchema = z.enum(PURCHASE_ORDER_SOURCES);
export type PurchaseOrderSource = z.infer<typeof PurchaseOrderSourceSchema>;

/** How it reached the vendor (`purchase_orders_sent_via_check`). */
export const PURCHASE_ORDER_SENT_VIA = ['email', 'by_hand'] as const;
export const PurchaseOrderSentViaSchema = z.enum(PURCHASE_ORDER_SENT_VIA);
export type PurchaseOrderSentVia = z.infer<typeof PurchaseOrderSentViaSchema>;

/** A goods receipt's states (`goods_receipts_state_check`). */
export const GOODS_RECEIPT_STATES = ['posted', 'reversed'] as const;
export const GoodsReceiptStateSchema = z.enum(GOODS_RECEIPT_STATES);
export type GoodsReceiptState = z.infer<typeof GoodsReceiptStateSchema>;

/** At most this many lines on one purchase order (`po_lines_line_no_check`). */
export const PO_LINES_MAX = 200;
/** At most this many serials in one goods receipt. */
export const RECEIPT_SERIALS_MAX = 1000;

const Reason = z.string().trim().min(1).max(300);
const Notes = z.string().trim().min(1).max(1000);

/**
 * A line as a person writes it: an item and its quantity in the item's purchase unit. The rate is
 * per purchase unit excluding GST and needs `procurement.rate.read`: typed (`rate`), filled from
 * the vendor's valid quote for the company or the group (`rateFromQuote`), or left out, when an
 * update keeps the rate the line had (for a reader of rates) and a new line has none.
 */
export const PurchaseOrderLineInput = z
  .object({
    itemId: IdSchema,
    qty: QuantitySchema,
    rate: RateInputSchema.nullable().optional(),
    rateFromQuote: z.boolean().optional(),
  })
  .strict()
  .refine(
    (line) => !(line.rateFromQuote === true && line.rate !== undefined && line.rate !== null),
    {
      message: 'a typed rate or the quote, not both',
      path: ['rateFromQuote'],
    },
  );
export type PurchaseOrderLineInput = z.input<typeof PurchaseOrderLineInput>;

const Lines = z
  .array(PurchaseOrderLineInput)
  .min(1)
  .max(PO_LINES_MAX)
  .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, {
    message: 'each item once',
  });

/** `procurement.po.create`: a draft purchase order of a company to a vendor, for a hub. */
export const CreatePurchaseOrderInput = z
  .object({
    entityId: EntityIdSchema,
    vendorId: IdSchema,
    deliverToWarehouseId: IdSchema,
    expectedAt: CalendarDateSchema.nullable().optional(),
    notes: Notes.nullable().optional(),
    lines: Lines,
  })
  .strict();
export type CreatePurchaseOrderInput = z.input<typeof CreatePurchaseOrderInput>;

/**
 * `procurement.po.update`: a draft's hub, expected date, notes and, when given, its lines as a
 * set (a line's rate kept, typed or filled from the quote as `PurchaseOrderLineInput` says).
 */
export const UpdatePurchaseOrderInput = z
  .object({
    purchaseOrderId: IdSchema,
    deliverToWarehouseId: IdSchema.optional(),
    expectedAt: CalendarDateSchema.nullable().optional(),
    notes: Notes.nullable().optional(),
    lines: Lines.optional(),
  })
  .strict();
export type UpdatePurchaseOrderInput = z.input<typeof UpdatePurchaseOrderInput>;

/** `procurement.po.approve`. */
export const ApprovePurchaseOrderInput = z.object({ purchaseOrderId: IdSchema }).strict();
export type ApprovePurchaseOrderInput = z.infer<typeof ApprovePurchaseOrderInput>;

/**
 * `procurement.po.send`: by email through the mailer to one of the vendor's people with an email
 * (the PDF follows from the event), or marked sent by hand.
 */
export const SendPurchaseOrderInput = z
  .object({
    purchaseOrderId: IdSchema,
    via: PurchaseOrderSentViaSchema,
    vendorContactId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => (v.via === 'email') === (v.vendorContactId !== undefined), {
    message: 'an email goes to one of the vendor’s people',
    path: ['vendorContactId'],
  });
export type SendPurchaseOrderInput = z.infer<typeof SendPurchaseOrderInput>;

/** `procurement.po.cancel` (draft, approved or sent) and `.close` (short-closed), with a reason. */
export const CancelPurchaseOrderInput = z
  .object({ purchaseOrderId: IdSchema, reason: Reason })
  .strict();
export type CancelPurchaseOrderInput = z.infer<typeof CancelPurchaseOrderInput>;
export const ClosePurchaseOrderInput = CancelPurchaseOrderInput;
export type ClosePurchaseOrderInput = CancelPurchaseOrderInput;

/** What every purchase order command answers: no rate, no amount. */
export const PurchaseOrderRefDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    poNo: z.string(),
    state: PurchaseOrderStateSchema,
  })
  .strict();
export type PurchaseOrderRefDto = z.infer<typeof PurchaseOrderRefDto>;

/**
 * `procurement.grn.post`: goods received against a sent purchase order, line by line, in the
 * line's purchase unit, into a bin of the order's hub (its receiving bin when none is named); a
 * serial-tracked item's serials, scanned or typed, exactly as many as the stock units received.
 */
export const GoodsReceiptLineInput = z
  .object({
    poLineId: IdSchema,
    qty: QuantitySchema,
    binId: IdSchema.nullable().optional(),
    serialNos: z.array(SerialNoSchema).max(RECEIPT_SERIALS_MAX).optional(),
  })
  .strict();
export type GoodsReceiptLineInput = z.input<typeof GoodsReceiptLineInput>;

export const PostGoodsReceiptInput = z
  .object({
    purchaseOrderId: IdSchema,
    vendorInvoiceNo: z.string().trim().min(1).max(40).nullable().optional(),
    vendorInvoiceDate: CalendarDateSchema.nullable().optional(),
    lines: z
      .array(GoodsReceiptLineInput)
      .min(1)
      .max(PO_LINES_MAX)
      .refine((lines) => new Set(lines.map((l) => l.poLineId)).size === lines.length, {
        message: 'each line once',
      }),
  })
  .strict();
export type PostGoodsReceiptInput = z.input<typeof PostGoodsReceiptInput>;

/** `procurement.grn.reverse`: the whole receipt, with a reason. */
export const ReverseGoodsReceiptInput = z.object({ receiptId: IdSchema, reason: Reason }).strict();
export type ReverseGoodsReceiptInput = z.infer<typeof ReverseGoodsReceiptInput>;

/** What the receipt commands answer: no rate. */
export const GoodsReceiptRefDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    grnNo: z.string(),
    purchaseOrderId: IdSchema,
    state: GoodsReceiptStateSchema,
    purchaseOrderState: PurchaseOrderStateSchema,
    movementCount: z.number().int().min(0),
  })
  .strict();
export type GoodsReceiptRefDto = z.infer<typeof GoodsReceiptRefDto>;

/** A quantity of a reorder rule, in the stock unit: at most three decimals. */
const RuleQty = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/);

/** `procurement.reorder_rule.set`: one rule per company, item and hub, made or changed. */
export const SetReorderRuleInput = z
  .object({
    entityId: EntityIdSchema,
    itemId: IdSchema,
    warehouseId: IdSchema,
    reorderLevel: RuleQty,
    reorderQty: RuleQty.refine((v) => Number(v) > 0, { message: 'above zero' }),
  })
  .strict();
export type SetReorderRuleInput = z.input<typeof SetReorderRuleInput>;

/** `procurement.reorder_rule.remove`. */
export const RemoveReorderRuleInput = z.object({ ruleId: IdSchema }).strict();
export type RemoveReorderRuleInput = z.infer<typeof RemoveReorderRuleInput>;

export const ReorderRuleDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    itemId: IdSchema,
    warehouseId: IdSchema,
    reorderLevel: StockQtySchema,
    reorderQty: StockQtySchema,
  })
  .strict();
export type ReorderRuleDto = z.infer<typeof ReorderRuleDto>;

/** `procurement.reorder.draft` (the platform's reorder job), one company at a time. */
export const DraftReorderInput = z.object({ entityId: EntityIdSchema }).strict();
export type DraftReorderInput = z.infer<typeof DraftReorderInput>;

export const ReorderDraftDto = z
  .object({
    entityId: EntityIdSchema,
    purchaseOrderIds: z.array(IdSchema),
    /** Items below their level with no preferred active vendor: nothing drafted for them. */
    itemsWithoutVendor: z.number().int().min(0),
  })
  .strict();
export type ReorderDraftDto = z.infer<typeof ReorderDraftDto>;

/** A purchase order line as every reader of the order sees it: no rate, no amount. */
export const PurchaseOrderLineDto = z
  .object({
    id: IdSchema,
    lineNo: z.number().int().min(1),
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    isSerialTracked: z.boolean(),
    serialPattern: z.string().nullable(),
    qty: StockQtySchema,
    purchaseUnit: ItemUnitSchema,
    stockUnit: ItemUnitSchema,
    unitFactor: StockQtySchema,
    qtyReceived: StockQtySchema,
    hsn: z.string(),
    taxRatePct: z.string().nullable(),
  })
  .strict();
export type PurchaseOrderLineDto = z.infer<typeof PurchaseOrderLineDto>;

/** A line with its rate and amount: only for a reader holding `procurement.rate.read`. */
export const PurchaseOrderLineWithRateDto = PurchaseOrderLineDto.extend({
  unitRate: RateSchema.nullable(),
  amount: MoneySchema.nullable(),
  quoteId: IdSchema.nullable(),
}).strict();
export type PurchaseOrderLineWithRateDto = z.infer<typeof PurchaseOrderLineWithRateDto>;

const orderFields = {
  id: IdSchema,
  entityId: EntityIdSchema,
  poNo: z.string(),
  vendorId: IdSchema,
  vendorName: z.string(),
  deliverToWarehouseId: IdSchema,
  hubName: z.string(),
  state: PurchaseOrderStateSchema,
  source: PurchaseOrderSourceSchema,
  expectedAt: CalendarDateSchema.nullable(),
  /** Past its expected date by `WORKSHOP_DEFAULTS.procurement.overdueAfterDays`, still open. */
  overdue: z.boolean(),
  draftedBy: IdSchema,
  draftedByName: z.string().nullable(),
  approvedBy: IdSchema.nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  sentAt: z.string().nullable(),
  sentVia: PurchaseOrderSentViaSchema.nullable(),
  cancelReason: z.string().nullable(),
  closeReason: z.string().nullable(),
  vendorStateCode: z.string().nullable(),
  placeOfSupplyStateCode: z.string(),
  notes: z.string().nullable(),
  createdAt: z.string(),
};

/** A purchase order as every reader sees it (the General Manager, the Store Manager): no values. */
export const PurchaseOrderDto = z
  .object({ ...orderFields, lines: z.array(PurchaseOrderLineDto) })
  .strict();
export type PurchaseOrderDto = z.infer<typeof PurchaseOrderDto>;

/** The tax split and totals of an order whose every line has its rate and GST rate. */
export const PurchaseOrderTotalsDto = z
  .object({
    subtotal: MoneySchema,
    cgst: MoneySchema,
    sgst: MoneySchema,
    igst: MoneySchema,
    taxTotal: MoneySchema,
    roundOff: SignedMoneySchema,
    grandTotal: MoneySchema,
  })
  .strict();
export type PurchaseOrderTotalsDto = z.infer<typeof PurchaseOrderTotalsDto>;

/** A purchase order with its rates and totals: only for a reader holding `procurement.rate.read`. */
export const PurchaseOrderWithRatesDto = z
  .object({
    ...orderFields,
    lines: z.array(PurchaseOrderLineWithRateDto),
    /** Null until every line has its rate and GST rate. */
    totals: PurchaseOrderTotalsDto.nullable(),
  })
  .strict();
export type PurchaseOrderWithRatesDto = z.infer<typeof PurchaseOrderWithRatesDto>;

/** Procurement › Orders: a page of a company's purchase orders in one state, newest first. */
export const ListPurchaseOrdersInput = z
  .object({
    entityId: EntityIdSchema,
    state: PurchaseOrderStateSchema,
    cursor: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListPurchaseOrdersInput = z.input<typeof ListPurchaseOrdersInput>;

export const PurchaseOrderRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    poNo: z.string(),
    vendorName: z.string(),
    hubName: z.string(),
    state: PurchaseOrderStateSchema,
    source: PurchaseOrderSourceSchema,
    expectedAt: CalendarDateSchema.nullable(),
    overdue: z.boolean(),
    lineCount: z.number().int().min(0),
    createdAt: z.string(),
  })
  .strict();
export type PurchaseOrderRowDto = z.infer<typeof PurchaseOrderRowDto>;

export const PurchaseOrderPageDto = z
  .object({
    items: z.array(PurchaseOrderRowDto),
    nextCursor: z.string().nullable(),
    /** The company's reorder drafts no person has opened yet: the alerts on top of the list. */
    reorderAlerts: z.array(PurchaseOrderRowDto),
    /** How many orders the company has in each state. */
    counts: z.record(z.string(), z.number().int().min(0)),
  })
  .strict();
export type PurchaseOrderPageDto = z.infer<typeof PurchaseOrderPageDto>;

export const GetPurchaseOrderInput = z.object({ purchaseOrderId: IdSchema }).strict();
export type GetPurchaseOrderInput = z.infer<typeof GetPurchaseOrderInput>;

/** Procurement › Receipts: a page of a company's goods receipts, newest first. */
export const ListGoodsReceiptsInput = z
  .object({
    entityId: EntityIdSchema,
    purchaseOrderId: IdSchema.optional(),
    cursor: z.string().max(1024).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListGoodsReceiptsInput = z.input<typeof ListGoodsReceiptsInput>;

export const GoodsReceiptRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    grnNo: z.string(),
    purchaseOrderId: IdSchema,
    poNo: z.string(),
    vendorName: z.string(),
    hubName: z.string(),
    state: GoodsReceiptStateSchema,
    receivedAt: z.string(),
    receivedByName: z.string().nullable(),
    vendorInvoiceNo: z.string().nullable(),
    lineCount: z.number().int().min(0),
    serialCount: z.number().int().min(0),
  })
  .strict();
export type GoodsReceiptRowDto = z.infer<typeof GoodsReceiptRowDto>;

export const GoodsReceiptPageDto = z
  .object({ items: z.array(GoodsReceiptRowDto), nextCursor: z.string().nullable() })
  .strict();
export type GoodsReceiptPageDto = z.infer<typeof GoodsReceiptPageDto>;

/** A bin goods may be received into at the order's hub. */
export const ReceivingBinDto = z
  .object({
    id: IdSchema,
    code: z.string(),
    kind: z.enum(['receiving', 'storage', 'quarantine']),
  })
  .strict();
export type ReceivingBinDto = z.infer<typeof ReceivingBinDto>;

/** Receive goods: the order as every reader sees it, and the bins of its hub. */
export const ReceiveGoodsDto = z
  .object({ order: PurchaseOrderDto, bins: z.array(ReceivingBinDto) })
  .strict();
export type ReceiveGoodsDto = z.infer<typeof ReceiveGoodsDto>;

/** The reorder rules of an item in a company, for its stock card. */
export const ListReorderRulesInput = z
  .object({ entityId: EntityIdSchema, itemId: IdSchema })
  .strict();
export type ListReorderRulesInput = z.infer<typeof ListReorderRulesInput>;

export const ReorderRuleRowDto = ReorderRuleDto.extend({ hubName: z.string() }).strict();
export type ReorderRuleRowDto = z.infer<typeof ReorderRuleRowDto>;
