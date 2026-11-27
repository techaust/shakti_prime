import {
  DomainError,
  GetPurchaseOrderInput,
  purchaseOrderPdfVersion,
  RequestPurchaseOrderPdfInput,
  GoodsReceiptPageDto,
  hasGrant,
  ListGoodsReceiptsInput,
  ListPurchaseOrdersInput,
  ListReorderRulesInput,
  PURCHASE_ORDER_STATES,
  PurchaseOrderDto,
  PurchaseOrderPageDto,
  PurchaseOrderWithRatesDto,
  ReceiveGoodsDto,
  ReorderRuleRowDto,
  type Principal,
  type PurchaseOrderRowDto,
  type PurchaseOrderPdfVersion,
  type PurchaseOrderState,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { istCalendarDate } from '../../numbering/financial-year';
import { purchaseOrderPdfFileId } from '../../procurement/po-pdf';
import { purchaseOrderTotals } from '../../procurement/po-totals';
import { getStoredFile, type StoredFile } from '../files/file-queries';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { readsRates } from './vendor-read';

/**
 * Purchase orders, goods receipts and reorder rules (docs/03-roadmap-appendix/phase3.md §7.2). Every
 * read here but `getPurchaseOrder`'s rate branch reads no rate at all; that branch reads
 * `po_line_rates` only after the caller's `procurement.rate.read` is checked, and row security
 * narrows the rows again. Orders and receipts are read by a company's stock readers and order
 * writers, as their policies say.
 */

type QueryContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** Whether the caller reads a company's orders: its stock readers and order writers. */
export function readsOrders(principal: Principal): boolean {
  return (
    hasGrant(principal.permissions, 'inventory.stock.read', 'entity') ||
    hasGrant(principal.permissions, 'procurement.po.write', 'entity')
  );
}

function assertOrderReader(principal: Principal): void {
  if (
    !readsOrders(principal) &&
    !hasGrant(principal.permissions, 'procurement.grn.write', 'entity')
  ) {
    throw new DomainError('forbidden', `${principal.roleKey} reads no purchase order`, {
      permission: 'inventory.stock.read',
      scope: 'entity',
    });
  }
}

function assertCompany(ctx: QueryContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/** The states an order is overdue in, past its expected date by the workshop's days. */
const OPEN_STATES = ['approved', 'sent', 'partially_received'] as const;

/** Whether an order is overdue on `now` (India's calendar). */
export function purchaseOrderOverdue(
  state: string,
  expectedAt: string | null,
  now: Date,
  days: number = WORKSHOP_DEFAULTS.procurement.overdueAfterDays,
): boolean {
  if (expectedAt === null || !(OPEN_STATES as readonly string[]).includes(state)) return false;
  const [y = 0, m = 1, d = 1] = expectedAt.split('-').map(Number);
  const due = new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
  return istCalendarDate(now) > due;
}

interface OrderRow extends Record<string, unknown> {
  id: string;
  entityId: number;
  poNo: string;
  vendorName: string;
  hubName: string;
  state: string;
  source: string;
  expectedAt: string | null;
  lineCount: number;
  createdAt: Date | string;
}

const ORDER_ROW = sql`
  select p.id, p.entity_id as "entityId", p.po_no as "poNo", v.name as "vendorName",
         w.name as "hubName", p.state, p.source, p.expected_at::text as "expectedAt",
         (select count(*)::int from po_lines l where l.po_id = p.id) as "lineCount",
         p.created_at as "createdAt"
    from purchase_orders p
    join vendors v on v.id = p.vendor_id
    join warehouses w on w.id = p.deliver_to_warehouse_id`;

function rowOf(row: OrderRow, now: Date): PurchaseOrderRowDto {
  return {
    id: row.id,
    entityId: row.entityId,
    poNo: row.poNo,
    vendorName: row.vendorName,
    hubName: row.hubName,
    state: row.state as PurchaseOrderRowDto['state'],
    source: row.source as PurchaseOrderRowDto['source'],
    expectedAt: row.expectedAt,
    overdue: purchaseOrderOverdue(row.state, row.expectedAt, now),
    lineCount: row.lineCount,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

const OrderCursor = z.object({ at: z.string(), id: z.string() }).strict();

/**
 * Procurement › Orders: a company's orders in one state, newest first, a page at a time by
 * `(entity_id, state, created_at, id)` (`purchase_orders_entity_state_idx`); with the company's
 * reorder drafts on top and its count per state.
 */
export async function listPurchaseOrders(
  ctx: QueryContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PurchaseOrderPageDto> {
  assertOrderReader(ctx.principal);
  const input = parseQueryInput(ListPurchaseOrdersInput, rawInput, 'procurement.orders.list');
  assertCompany(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(OrderCursor, input.cursor);
  const rows = (await ctx.tx.execute(sql`${ORDER_ROW}
     where p.entity_id = ${input.entityId} and p.state = ${input.state}
       ${after === undefined ? sql`` : sql`and (p.created_at, p.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
     order by p.created_at desc, p.id desc
     limit ${input.limit + 1}`)) as unknown as OrderRow[];
  const alerts = (await ctx.tx.execute(sql`${ORDER_ROW}
     where p.entity_id = ${input.entityId} and p.state = 'draft' and p.source = 'reorder'
       and p.drafted_by = p.created_by
     order by p.created_at desc, p.id desc
     limit 20`)) as unknown as OrderRow[];
  const counts = (await ctx.tx.execute(sql`
    select state, count(*)::int as n from purchase_orders
     where entity_id = ${input.entityId} group by state`)) as unknown as {
    state: string;
    n: number;
  }[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return PurchaseOrderPageDto.parse({
    items: page.map((r) => rowOf(r, now)),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ at: new Date(last.createdAt).toISOString(), id: last.id })
        : null,
    reorderAlerts: alerts.map((r) => rowOf(r, now)),
    counts: Object.fromEntries(
      PURCHASE_ORDER_STATES.map((s) => [s, counts.find((c) => c.state === s)?.n ?? 0]),
    ),
  });
}

interface SheetRow extends Record<string, unknown> {
  id: string;
  entityId: number;
  poNo: string;
  vendorId: string;
  vendorName: string;
  deliverToWarehouseId: string;
  hubName: string;
  state: string;
  source: string;
  expectedAt: string | null;
  draftedBy: string;
  draftedByName: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  sentVia: string | null;
  cancelReason: string | null;
  closeReason: string | null;
  vendorStateCode: string | null;
  placeOfSupplyStateCode: string;
  notes: string | null;
  createdAt: Date;
}

interface LineRow extends Record<string, unknown> {
  id: string;
  lineNo: number;
  itemId: string;
  sku: string;
  itemName: string;
  isSerialTracked: boolean;
  serialPattern: string | null;
  qty: string;
  purchaseUnit: string;
  stockUnit: string;
  unitFactor: string;
  qtyReceived: string;
  hsn: string;
  taxRateId: string | null;
  taxRatePct: string | null;
}

/** A line as every reader's DTO carries it: the tax rate's id stays on the server. */
function withoutTaxRate(line: LineRow): Omit<LineRow, 'taxRateId'> {
  const copy: Partial<LineRow> = { ...line };
  delete copy.taxRateId;
  return copy;
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/** The order and its lines as every reader sees them: no rate, no amount. */
async function readOrder(
  ctx: QueryContext,
  purchaseOrderId: string,
  now: Date,
): Promise<{ order: PurchaseOrderDto; lines: LineRow[] }> {
  const [row] = (await ctx.tx.execute(sql`
    select p.id, p.entity_id as "entityId", p.po_no as "poNo", p.vendor_id as "vendorId",
           v.name as "vendorName", p.deliver_to_warehouse_id as "deliverToWarehouseId",
           w.name as "hubName", p.state, p.source, p.expected_at::text as "expectedAt",
           p.drafted_by as "draftedBy", d.display_name as "draftedByName",
           p.approved_by as "approvedBy", a.display_name as "approvedByName",
           p.approved_at as "approvedAt", p.sent_at as "sentAt", p.sent_via as "sentVia",
           p.cancel_reason as "cancelReason", p.close_reason as "closeReason",
           p.vendor_state_code as "vendorStateCode",
           p.place_of_supply_state_code as "placeOfSupplyStateCode", p.notes,
           p.created_at as "createdAt"
      from purchase_orders p
      join vendors v on v.id = p.vendor_id
      join warehouses w on w.id = p.deliver_to_warehouse_id
      left join principals d on d.id = p.drafted_by
      left join principals a on a.id = p.approved_by
     where p.id = ${purchaseOrderId}`)) as unknown as SheetRow[];
  if (row === undefined || !ctx.entityIds.includes(row.entityId)) {
    throw new DomainError('not_found', `purchase order ${purchaseOrderId} is not readable`, {
      reason: 'purchase_order_missing',
    });
  }
  const lines = (await ctx.tx.execute(sql`
    select l.id, l.line_no as "lineNo", l.item_id as "itemId", i.sku, i.name as "itemName",
           i.is_serial_tracked as "isSerialTracked", i.serial_pattern as "serialPattern",
           l.qty::text as qty, l.purchase_unit as "purchaseUnit", i.unit as "stockUnit",
           l.unit_factor::text as "unitFactor", l.qty_received::text as "qtyReceived", l.hsn,
           l.tax_rate_id as "taxRateId", l.tax_rate_pct::text as "taxRatePct"
      from po_lines l join items i on i.id = l.item_id
     where l.po_id = ${purchaseOrderId}
     order by l.line_no`)) as unknown as LineRow[];
  return { order: orderDtoOf(row, lines, now), lines };
}

/** The order as every reader sees it, from its row and lines as `readOrder` reads them. */
function orderDtoOf(row: SheetRow, lines: LineRow[], now: Date): PurchaseOrderDto {
  return PurchaseOrderDto.parse({
    ...row,
    approvedAt: iso(row.approvedAt),
    sentAt: iso(row.sentAt),
    createdAt: iso(row.createdAt),
    overdue: purchaseOrderOverdue(row.state, row.expectedAt, now),
    lines: lines.map(withoutTaxRate),
  });
}

interface RateRow {
  poLineId: string;
  unitRate: string;
  amount: string;
  quoteId: string | null;
}

/** The order with each line's rate and amount and the tax engine's split and totals. */
function withRates(
  order: PurchaseOrderDto,
  lines: LineRow[],
  rates: RateRow[],
): PurchaseOrderWithRatesDto {
  const byLine = new Map(rates.map((r) => [r.poLineId, r]));
  const totals = purchaseOrderTotals(
    lines.map((l) => ({
      amount: byLine.get(l.id)?.amount ?? null,
      taxRatePct: l.taxRatePct,
      taxRateId: l.taxRateId,
    })),
    {
      vendorStateCode: order.vendorStateCode,
      placeOfSupplyStateCode: order.placeOfSupplyStateCode,
    },
  );
  return PurchaseOrderWithRatesDto.parse({
    ...order,
    lines: order.lines.map((line) => {
      const rate = byLine.get(line.id);
      return {
        ...line,
        unitRate: rate?.unitRate ?? null,
        amount: rate?.amount ?? null,
        quoteId: rate?.quoteId ?? null,
      };
    }),
    totals,
  });
}

/**
 * The order sheet: the order and its lines for every reader; for a holder of
 * `procurement.rate.read`, each line's rate and amount and the order's tax split and totals by the
 * tax engine. A reader without the grant gets the shape without values, built without reading them.
 */
export async function getPurchaseOrder(
  ctx: QueryContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<PurchaseOrderDto | PurchaseOrderWithRatesDto> {
  assertOrderReader(ctx.principal);
  const input = parseQueryInput(GetPurchaseOrderInput, rawInput, 'procurement.orders.get');
  const { order, lines } = await readOrder(ctx, input.purchaseOrderId, now);
  if (!readsRates(ctx.principal)) return order;
  const rates = (await ctx.tx.execute(sql`
    select r.po_line_id as "poLineId", r.unit_rate::text as "unitRate", r.amount::text as amount,
           r.quote_id as "quoteId"
      from po_line_rates r join po_lines l on l.id = r.po_line_id
     where l.po_id = ${order.id}`)) as unknown as RateRow[];
  return withRates(order, lines, rates);
}

/** Receive goods: the order without values and the bins of its hub goods may come into. */
export async function getReceiveGoods(
  ctx: QueryContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<ReceiveGoodsDto> {
  assertOrderReader(ctx.principal);
  const input = parseQueryInput(GetPurchaseOrderInput, rawInput, 'procurement.orders.receive');
  const { order } = await readOrder(ctx, input.purchaseOrderId, now);
  const bins = (await ctx.tx.execute(sql`
    select b.id, b.code, b.kind from bins b
     where b.warehouse_id = ${order.deliverToWarehouseId} and b.archived_at is null
       and b.kind in ('receiving', 'storage', 'quarantine')
     order by case b.kind when 'receiving' then 0 when 'storage' then 1 else 2 end, b.code`)) as unknown as {
    id: string;
    code: string;
    kind: string;
  }[];
  return ReceiveGoodsDto.parse({ order, bins });
}

const ReceiptCursor = z.object({ at: z.string(), id: z.string() }).strict();

/**
 * Procurement › Receipts: a company's goods receipts, newest first, a page at a time by
 * `(entity_id, received_at, id)` (`goods_receipts_entity_received_idx`); or one order's.
 */
export async function listGoodsReceipts(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<GoodsReceiptPageDto> {
  assertOrderReader(ctx.principal);
  const input = parseQueryInput(ListGoodsReceiptsInput, rawInput, 'procurement.receipts.list');
  assertCompany(ctx, input.entityId);
  const after = input.cursor === undefined ? undefined : decodeCursor(ReceiptCursor, input.cursor);
  const rows = (await ctx.tx.execute(sql`
    select r.id, r.entity_id as "entityId", r.grn_no as "grnNo", r.po_id as "purchaseOrderId",
           p.po_no as "poNo", v.name as "vendorName", w.name as "hubName", r.state,
           r.received_at as "receivedAt", rb.display_name as "receivedByName",
           r.vendor_invoice_no as "vendorInvoiceNo",
           (select count(*)::int from goods_receipt_lines l where l.receipt_id = r.id) as "lineCount",
           (select count(*)::int from serials s
              join goods_receipt_lines l on l.id = s.receipt_line_id
             where l.receipt_id = r.id) as "serialCount"
      from goods_receipts r
      join purchase_orders p on p.id = r.po_id
      join vendors v on v.id = p.vendor_id
      join warehouses w on w.id = r.warehouse_id
      left join principals rb on rb.id = r.received_by
     where r.entity_id = ${input.entityId}
       ${input.purchaseOrderId === undefined ? sql`` : sql`and r.po_id = ${input.purchaseOrderId}`}
       ${after === undefined ? sql`` : sql`and (r.received_at, r.id) < (${after.at}::timestamptz, ${after.id}::uuid)`}
     order by r.received_at desc, r.id desc
     limit ${input.limit + 1}`)) as unknown as (Record<string, unknown> & {
    id: string;
    receivedAt: Date;
  })[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return GoodsReceiptPageDto.parse({
    items: page.map((r) => ({ ...r, receivedAt: new Date(r.receivedAt).toISOString() })),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ at: new Date(last.receivedAt).toISOString(), id: last.id })
        : null,
  });
}

/** An item's reorder rules in a company, for its stock card. */
export async function listReorderRules(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<ReorderRuleRowDto[]> {
  assertOrderReader(ctx.principal);
  const input = parseQueryInput(ListReorderRulesInput, rawInput, 'procurement.reorder_rules.list');
  assertCompany(ctx, input.entityId);
  const rows = (await ctx.tx.execute(sql`
    select r.id, r.entity_id as "entityId", r.item_id as "itemId", r.warehouse_id as "warehouseId",
           r.reorder_level::text as "reorderLevel", r.reorder_qty::text as "reorderQty",
           w.name as "hubName"
      from reorder_rules r join warehouses w on w.id = r.warehouse_id
     where r.entity_id = ${input.entityId} and r.item_id = ${input.itemId}
     order by w.name`)) as unknown as Record<string, unknown>[];
  return rows.map((r) => ReorderRuleRowDto.parse(r));
}

/** What the purchase order PDF prints: the order as the viewer reads it, its company and vendor. */
export interface PurchaseOrderPrintData {
  order: PurchaseOrderDto | PurchaseOrderWithRatesDto;
  company: {
    legalName: string;
    brandName: string;
    addressLines: string[];
    gstin: string | null;
  };
  vendor: { name: string; gstin: string | null; addressLines: string[] };
}

interface CompanyRow {
  legalName: string;
  brandName: string;
  gstin: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  pin: string | null;
}
interface VendorRow {
  name: string;
  gstin: string | null;
  address: { line1?: string; line2?: string; city?: string; pin?: string };
}

/** The print data from the order and its company's and vendor's rows, addresses line by line. */
function printDataOf(
  order: PurchaseOrderDto | PurchaseOrderWithRatesDto,
  company: CompanyRow,
  vendor: VendorRow,
): PurchaseOrderPrintData {
  const lines = (...parts: (string | null | undefined)[]) =>
    parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '');
  return {
    order,
    company: {
      legalName: company.legalName,
      brandName: company.brandName,
      addressLines: lines(
        company.line1,
        company.line2,
        lines(company.city, company.pin).join(' ') || null,
      ),
      gstin: company.gstin,
    },
    vendor: {
      name: vendor.name,
      gstin: vendor.gstin,
      addressLines: lines(
        vendor.address.line1,
        vendor.address.line2,
        lines(vendor.address.city, vendor.address.pin).join(' ') || null,
      ),
    },
  };
}

/**
 * What a person who reads supplier rates finds of an order's PDF (U2, review R2): the version the
 * order prints now (`purchaseOrderPdfVersion`) and that version's file, once the render worker has
 * stored it. Read as the person: the order under its own policies, the file under `files_read`,
 * which shows a `purchase_order_pdf` file only with `procurement.rate.read` in its company. A
 * person without that grant, an order they may not read, a draft or an order never approved
 * answers `not_found`, so nobody else learns whether it exists.
 */
export async function getPurchaseOrderPdf(
  ctx: QueryContext,
  rawInput: unknown,
): Promise<PurchaseOrderPdfState> {
  const input = parseQueryInput(RequestPurchaseOrderPdfInput, rawInput, 'procurement.orders.pdf');
  const missing = () =>
    new DomainError('not_found', `purchase order ${input.purchaseOrderId} has no PDF to read`, {
      reason: 'purchase_order_missing',
    });
  if (!readsRates(ctx.principal)) throw missing();
  const [order] = (await ctx.tx.execute(sql`
    select id, entity_id as "entityId", po_no as "poNo", state, approved_at as "approvedAt"
      from purchase_orders where id = ${input.purchaseOrderId}`)) as unknown as {
    id: string;
    entityId: number;
    poNo: string;
    state: PurchaseOrderState;
    approvedAt: Date | string | null;
  }[];
  if (order === undefined || !ctx.entityIds.includes(order.entityId)) throw missing();
  const version = purchaseOrderPdfVersion(order.state, order.approvedAt);
  if (version === undefined) throw missing();
  const fileId = purchaseOrderPdfFileId(order.id, version);
  const file = await getStoredFile(ctx, fileId);
  return {
    purchaseOrderId: order.id,
    entityId: order.entityId,
    poNo: order.poNo,
    version,
    fileId,
    file:
      file?.purpose === 'purchase_order_pdf' && file.entityId === order.entityId ? file : undefined,
  };
}

/** An order's PDF as a person finds it: the current version's file id, and the file once stored. */
export interface PurchaseOrderPdfState {
  purchaseOrderId: string;
  entityId: number;
  poNo: string;
  version: PurchaseOrderPdfVersion;
  fileId: string;
  /** The stored file, when the worker has recorded it (`ready`), else undefined. */
  file: StoredFile | undefined;
}

function assertPrinter(ctx: QueryContext): void {
  if (!hasGrant(ctx.principal.permissions, 'procurement.po.print', 'all')) {
    throw new DomainError('forbidden', `${ctx.principal.roleKey} prints no purchase order`, {
      permission: 'procurement.po.print',
      scope: 'all',
    });
  }
}

/**
 * What the purchase order PDF prints (U2, review R2), read by the render worker as
 * `system:workers` holding the platform-only `procurement.po.print` and no person's grant: through
 * `app.purchase_order_for_print()` only, one approved order of the worker's company with its rates
 * and amounts (the vendor's copy), the buying company and the vendor. Version 1 prints for every
 * approved order, version 2 only for one cancelled since. Undefined for a draft, an order never
 * approved or a version it does not print. Read on `app_user` (`pool: 'app_user'`): `app_reader`
 * may not run the definer.
 */
export async function purchaseOrderForPrint(
  ctx: QueryContext,
  input: { purchaseOrderId: string; version: PurchaseOrderPdfVersion },
  now: Date = new Date(),
): Promise<(PurchaseOrderPrintData & { order: PurchaseOrderWithRatesDto }) | undefined> {
  assertPrinter(ctx);
  const [row] = (await ctx.tx.execute(sql`
    select app.purchase_order_for_print(${input.purchaseOrderId}::uuid,
                                        ${input.version}::int) as print`)) as unknown as {
    print: {
      order: SheetRow;
      lines: LineRow[];
      rates: RateRow[];
      company: CompanyRow | null;
      vendor: VendorRow | null;
    } | null;
  }[];
  const print = row?.print;
  const company = print?.company;
  const vendor = print?.vendor;
  if (!print || !company || !vendor || !ctx.entityIds.includes(print.order.entityId)) {
    return undefined;
  }
  const order = withRates(orderDtoOf(print.order, print.lines, now), print.lines, print.rates);
  return { ...printDataOf(order, company, vendor), order };
}

/** Whom the mailer sends an order to, and the address replies go to; no rate. */
export interface PurchaseOrderMailTo {
  poNo: string;
  /** The buying company's legal name, for the subject and the body. */
  companyName: string;
  /** The vendor's person named on sending, while they still have an email address. */
  to: { name: string; email: string } | null;
  /** The sender's own address. */
  replyTo: string | null;
}

/**
 * The purchase order mailer's read (U2, review finding 4), as the render worker after it stored
 * the PDF: through `app.purchase_order_mail_to()` only, for one order of the worker's company that
 * a person sent by email and that is still sent, received or closed, its number, the company's
 * name, the vendor's person and the sender's address. Undefined for an order that is not that (sent
 * by hand, cancelled since), so nothing is mailed. On `app_user`, as `purchaseOrderForPrint`.
 */
export async function purchaseOrderMailTo(
  ctx: QueryContext,
  input: { purchaseOrderId: string; vendorContactId: string; sentBy: string },
): Promise<PurchaseOrderMailTo | undefined> {
  assertPrinter(ctx);
  const [row] = (await ctx.tx.execute(sql`
    select app.purchase_order_mail_to(${input.purchaseOrderId}::uuid,
                                      ${input.vendorContactId}::uuid,
                                      ${input.sentBy}::uuid) as mail`)) as unknown as {
    mail: {
      poNo: string;
      companyName: string | null;
      contact: { name: string; email: string } | null;
      replyTo: string | null;
    } | null;
  }[];
  const mail = row?.mail;
  if (typeof mail?.companyName !== 'string') return undefined;
  return {
    poNo: mail.poNo,
    companyName: mail.companyName,
    to: mail.contact,
    replyTo: mail.replyTo,
  };
}
