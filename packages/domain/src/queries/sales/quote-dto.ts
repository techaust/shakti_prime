import {
  DomainError,
  hasGrant,
  QuoteDto,
  QuoteRowDto,
  QuoteStateSchema,
  SegmentSchema,
  SubsidySchemeSchema,
  SupplyKindSchema,
  type Principal,
  type QuoteLineDto,
  type QuoteState,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, asc, eq, getTableColumns } from 'drizzle-orm';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine, type QuoteEvent } from '../../state-machines/machines/quote';
import type { QuoteReadContext } from './quote-facts';

/**
 * The state a person sees (docs/design/phase1.md §7.3): a draft or sent quote whose validity has
 * passed reads as expired before the daily job marks it so.
 */
export function shownQuoteState(stored: string, validUntil: Date, now: Date): QuoteState {
  const state = QuoteStateSchema.parse(stored);
  if ((state === 'draft' || state === 'sent') && now.getTime() > validUntil.getTime()) {
    return 'expired';
  }
  return state;
}

/** One quote's row as the reads select it. */
export const QUOTE_ROW_COLUMNS = {
  id: schema.quotes.id,
  entityId: schema.quotes.entityId,
  quoteNo: schema.quotes.quoteNo,
  opportunityId: schema.quotes.opportunityId,
  accountId: schema.quotes.accountId,
  customerName: schema.accounts.name,
  state: schema.quotes.state,
  grandTotal: schema.quotes.grandTotal,
  validUntil: schema.quotes.validUntil,
  createdAt: schema.quotes.createdAt,
};

export function toQuoteRow(
  row: {
    id: string;
    entityId: number;
    quoteNo: string;
    opportunityId: string;
    accountId: string;
    customerName: string;
    state: string;
    grandTotal: string;
    validUntil: Date;
    createdAt: Date;
  },
  now: Date,
): QuoteRowDto {
  return QuoteRowDto.parse({
    id: row.id,
    entityId: row.entityId,
    quoteNo: row.quoteNo,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    customerName: row.customerName,
    grandTotal: row.grandTotal,
    state: shownQuoteState(row.state, row.validUntil, now),
    validUntil: row.validUntil.toISOString(),
    createdAt: row.createdAt.toISOString(),
  });
}

/** Whether the machine lets this principal fire `event` on the quote now (no guard checked twice). */
function allows(
  principal: Principal,
  record: { state: QuoteState; pdfFileId: string | null; validUntil: Date },
  event: QuoteEvent,
  now: Date,
): boolean {
  try {
    transition(
      quoteMachine,
      {
        state: record.state,
        segment: 'farmer_pumps',
        tierId: null,
        priceListId: null,
        sizingComplete: true,
        pumpCurveInBounds: true,
        dcrRuleMet: true,
        pdfFileId: record.pdfFileId,
        validUntil: record.validUntil,
      },
      event,
      { actor: { kind: 'principal', principal }, now, params: { reason: 'shown' } },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * One quote with its lines (the quote page), as the caller reads it under RLS: `not_found` with
 * `quote_missing` when the caller cannot read it or it is of another company. What the caller may
 * do with it is worked out by the quote machine on the stored state; the commands check again.
 */
export async function readQuote(
  ctx: Pick<QuoteReadContext, 'tx' | 'principal' | 'entityIds' | 'now'>,
  entityId: number,
  quoteId: string,
): Promise<QuoteDto> {
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  const q = schema.quotes;
  const a = schema.accounts;
  const t = schema.priceTiers;
  const p = schema.principals;
  const o = schema.opportunities;
  const pl = schema.pipelines;
  const [row] = await ctx.tx
    .select({
      ...getTableColumns(q),
      customerName: a.name,
      tierName: t.name,
      createdByName: p.displayName,
      segment: pl.segment,
    })
    .from(q)
    .innerJoin(a, eq(a.id, q.accountId))
    .innerJoin(o, eq(o.id, q.opportunityId))
    .innerJoin(pl, eq(pl.id, o.pipelineId))
    .leftJoin(t, eq(t.id, q.tierId))
    .leftJoin(p, eq(p.id, q.createdBy))
    .where(and(eq(q.id, quoteId), eq(q.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', `quote ${quoteId} is not visible`, {
      reason: 'quote_missing',
    });
  }
  // The quote this one replaced and the one that replaced it, each by its unique key.
  const [before] =
    row.supersedesId === null
      ? []
      : await ctx.tx
          .select({ quoteNo: q.quoteNo })
          .from(q)
          .where(eq(q.id, row.supersedesId))
          .limit(1);
  const [after] = await ctx.tx
    .select({ id: q.id, quoteNo: q.quoteNo })
    .from(q)
    .where(eq(q.supersedesId, row.id))
    .limit(1);
  const l = schema.quoteLines;
  const lines = await ctx.tx
    .select()
    .from(l)
    .where(eq(l.quoteId, quoteId))
    .orderBy(asc(l.position));
  const quote = row;
  const stored = QuoteStateSchema.parse(quote.state);
  const facts = { state: stored, pdfFileId: quote.pdfFileId, validUntil: quote.validUntil };
  const may = (event: QuoteEvent, key: 'sales.quote.send' | 'sales.quote.create') =>
    hasGrant(ctx.principal.permissions, key, 'own') && allows(ctx.principal, facts, event, ctx.now);
  return QuoteDto.parse({
    id: quote.id,
    entityId: quote.entityId,
    quoteNo: quote.quoteNo,
    opportunityId: quote.opportunityId,
    accountId: quote.accountId,
    customerName: row.customerName,
    segment: SegmentSchema.parse(row.segment),
    siteId: quote.siteId,
    sizingId: quote.sizingId,
    tierId: quote.tierId,
    tierName: row.tierName ?? '',
    priceListId: quote.priceListId,
    scheme: SubsidySchemeSchema.parse(quote.scheme),
    placeOfSupplyState: quote.placeOfSupplyState,
    supplyKind: SupplyKindSchema.parse(quote.supplyKind),
    validUntil: quote.validUntil.toISOString(),
    state: shownQuoteState(quote.state, quote.validUntil, ctx.now),
    lines: lines.map((line): QuoteLineDto => ({
      position: line.position,
      itemId: line.itemId,
      kitId: line.kitId,
      description: line.description,
      sku: line.sku,
      unit: line.unit as QuoteLineDto['unit'],
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
    totals: {
      subtotal: quote.subtotal,
      cgst: quote.cgst,
      sgst: quote.sgst,
      igst: quote.igst,
      taxTotal: quote.taxTotal,
      roundOff: quote.roundOff,
      grandTotal: quote.grandTotal,
    },
    pdfFileId: quote.pdfFileId,
    supersedesId: quote.supersedesId,
    supersedesNo: before?.quoteNo ?? null,
    supersededById: after?.id ?? null,
    supersededByNo: after?.quoteNo ?? null,
    withdrawnReason: quote.withdrawnReason,
    createdAt: quote.createdAt.toISOString(),
    createdByName: row.createdByName,
    stateChangedAt: quote.stateChangedAt.toISOString(),
    canSend: may('send', 'sales.quote.send'),
    canRequote: may('requote', 'sales.quote.create'),
    canWithdraw: may('withdraw', 'sales.quote.send'),
  });
}
