import {
  DomainError,
  MilestoneStepsSchema,
  PaymentMilestoneDto,
  ProformaDto,
  type MilestoneTemplateDto,
  type QuoteLineDto,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { and, asc, desc, eq, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { toLineDto } from '../sales/line-dto';

/** What the finance reads run with: a transaction under the caller's request. */
export interface FinanceReadContext {
  tx: RequestTx;
  entityIds: readonly number[];
}

type ProformaLineRow = typeof schema.proformaLines.$inferSelect;
type MilestoneRow = typeof schema.paymentMilestones.$inferSelect;

function requireEntity(ctx: FinanceReadContext, entityId: number): void {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/** A proforma line as the reads carry it: the order line it copied, value for value. */
function proformaLineDto(line: ProformaLineRow): QuoteLineDto {
  return toLineDto({ ...line, salesOrderId: line.proformaId });
}

const iso = (at: Date | null): string | null => (at === null ? null : at.toISOString());

/**
 * The PDF a proforma's reader may open: the live one, or, once cancelled, only one printed at or
 * after the cancel, which says "Cancelled" across it (review finding 5); null while it is printed.
 */
function currentPdf(row: {
  state: string;
  pdfFileId: string | null;
  pdfAt: Date | null;
  cancelledAt: Date | null;
}): string | null {
  if (row.pdfFileId === null || row.pdfAt === null) return null;
  if (row.state !== 'cancelled') return row.pdfFileId;
  return row.cancelledAt !== null && row.pdfAt >= row.cancelledAt ? row.pdfFileId : null;
}

/** An order's proformas, newest first, as the caller reads them (finance.read over the order). */
export async function readOrderProformas(
  ctx: FinanceReadContext,
  entityId: number,
  orderId: string,
  proformaId?: string,
): Promise<ProformaDto[]> {
  requireEntity(ctx, entityId);
  const p = schema.proformas;
  const so = schema.salesOrders;
  const issuer = alias(schema.principals, 'issuer');
  const f = schema.files;
  const canceller = alias(schema.principals, 'canceller');
  const rows = await ctx.tx
    .select({
      ...getTableColumns(p),
      soNo: so.soNo,
      issuedByName: issuer.displayName,
      cancelledByName: canceller.displayName,
      pdfAt: f.createdAt,
    })
    .from(p)
    .innerJoin(so, eq(so.id, p.salesOrderId))
    .leftJoin(issuer, eq(issuer.id, p.createdBy))
    .leftJoin(canceller, eq(canceller.id, p.cancelledBy))
    .leftJoin(f, eq(f.id, p.pdfFileId))
    .where(
      and(
        eq(p.salesOrderId, orderId),
        eq(p.entityId, entityId),
        proformaId === undefined ? undefined : eq(p.id, proformaId),
      ),
    )
    .orderBy(desc(p.createdAt), desc(p.id));
  const out: ProformaDto[] = [];
  for (const row of rows) {
    const l = schema.proformaLines;
    const lines = await ctx.tx
      .select()
      .from(l)
      .where(eq(l.proformaId, row.id))
      .orderBy(asc(l.position));
    out.push(
      ProformaDto.parse({
        id: row.id,
        entityId: row.entityId,
        proformaNo: row.proformaNo,
        orderId: row.salesOrderId,
        soNo: row.soNo,
        state: row.state,
        placeOfSupplyState: row.placeOfSupplyState,
        supplyKind: row.supplyKind,
        lines: lines.map(proformaLineDto),
        totals: {
          subtotal: row.subtotal,
          cgst: row.cgst,
          sgst: row.sgst,
          igst: row.igst,
          taxTotal: row.taxTotal,
          roundOff: row.roundOff,
          grandTotal: row.grandTotal,
        },
        issuedAt: row.createdAt.toISOString(),
        issuedByName: row.issuedByName,
        pdfFileId: currentPdf(row),
        cancelledAt: iso(row.cancelledAt),
        cancelledByName: row.cancelledByName,
        cancelReason: row.cancelReason,
      }),
    );
  }
  return out;
}

/** One proforma, as the caller reads it: `not_found` with `proforma_missing` otherwise. */
export async function readProforma(
  ctx: FinanceReadContext,
  entityId: number,
  orderId: string,
  proformaId: string,
): Promise<ProformaDto> {
  const [proforma] = await readOrderProformas(ctx, entityId, orderId, proformaId);
  if (!proforma) {
    throw new DomainError('not_found', `proforma ${proformaId} is not visible`, {
      reason: 'proforma_missing',
    });
  }
  return proforma;
}

/** A stored milestone as the reads carry it. */
export function milestoneDto(row: MilestoneRow, waivedByName: string | null): PaymentMilestoneDto {
  return PaymentMilestoneDto.parse({
    id: row.id,
    entityId: row.entityId,
    orderId: row.salesOrderId,
    seq: row.seq,
    key: row.key,
    label: row.label,
    percent: row.percent,
    amount: row.amount,
    paidAmount: row.paidAmount,
    dueRule: row.dueRule,
    dueDays: row.dueDays,
    loanGate: row.loanGate,
    state: row.state,
    dueOn: row.dueOn,
    waivedAt: iso(row.waivedAt),
    waivedByName,
    waiveReason: row.waiveReason,
  });
}

/** An order's milestones in order, as the caller reads them (finance.read over the order). */
export async function readOrderMilestones(
  ctx: FinanceReadContext,
  entityId: number,
  orderId: string,
): Promise<PaymentMilestoneDto[]> {
  requireEntity(ctx, entityId);
  const m = schema.paymentMilestones;
  const waiver = alias(schema.principals, 'waiver');
  const rows = await ctx.tx
    .select({ ...getTableColumns(m), waivedByName: waiver.displayName })
    .from(m)
    .leftJoin(waiver, eq(waiver.id, m.waivedBy))
    .where(and(eq(m.salesOrderId, orderId), eq(m.entityId, entityId)))
    .orderBy(asc(m.seq));
  return rows.map((row) => milestoneDto(row, row.waivedByName));
}

/** A company's published payment terms, newest version first per segment. */
export async function readMilestoneTemplates(
  ctx: FinanceReadContext,
  entityId: number,
): Promise<MilestoneTemplateDto[]> {
  requireEntity(ctx, entityId);
  const t = schema.paymentMilestoneTemplates;
  const publisher = alias(schema.principals, 'publisher');
  const rows = await ctx.tx
    .select({ ...getTableColumns(t), publishedByName: publisher.displayName })
    .from(t)
    .leftJoin(publisher, eq(publisher.id, t.createdBy))
    .where(eq(t.entityId, entityId))
    .orderBy(asc(t.segment), desc(t.version));
  return rows.map((row) => ({
    id: row.id,
    entityId: row.entityId,
    segment: row.segment as MilestoneTemplateDto['segment'],
    version: row.version,
    steps: MilestoneStepsSchema.parse(row.stepsJson),
    publishedAt: row.createdAt.toISOString(),
    publishedByName: row.publishedByName,
  }));
}
