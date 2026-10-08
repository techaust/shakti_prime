import {
  DomainError,
  type CompositeRuleRow,
  type ItemUnit,
  type Money,
  type PlaceOfSupply,
  type Quantity,
  type QuoteLineDto,
  type QuoteTotalsDto,
  type Segment,
  type TaxRateRow,
} from '@shakti/contracts';
import { toScaled } from '../money/paise';
import { computeDocument, computeLine, resolveCompositeRule, resolveRate } from '../tax';

/** A quantity with exactly three decimals: `5` → `5.000`. */
function threeDecimals(qty: string): string {
  const milli = toScaled(qty, 3);
  return `${(milli / 1000n).toString()}.${(milli % 1000n).toString().padStart(3, '0')}`;
}

/** An item or kit as the quote prices it: its catalogue facts and its price on the quote's list. */
export interface PricedSource {
  kind: 'item' | 'kit';
  id: string;
  sku: string;
  name: string;
  unit: ItemUnit;
  /** The item's HSN code; a kit has none of its own. */
  hsn: string | null;
  /** The Price Master price on the quote's list: never a person's input (SAL-03). */
  price: Money;
}

export interface QuotePricingLine {
  source: PricedSource;
  qty: Quantity;
  worksContract: boolean;
}

export interface QuotePricingInput {
  segment: Segment;
  /** The quote's date: rates and rules resolve on its calendar day in IST. */
  on: Date;
  supply: PlaceOfSupply;
  lines: readonly QuotePricingLine[];
  /** Every rate row the lines may resolve to (by item or by HSN), as the command loads them. */
  rates: readonly TaxRateRow[];
  /** The segment's composite-supply rules. */
  compositeRules: readonly CompositeRuleRow[];
}

export interface PricedQuote {
  lines: QuoteLineDto[];
  totals: QuoteTotalsDto;
}

/**
 * Prices and taxes a quote's lines (BLUEPRINT §8.3, ADR 0007, docs/03-roadmap-appendix/phase1.md §7.3): each
 * line's price is the Price Master price it carries, its tax comes from the tax engine with the
 * rate row it resolved to on the quote's date (an item's own rate before its HSN rate) or, for a
 * works contract in a composite segment, the segment's goods and services split; the totals are
 * the sum of the lines with the document rounded to the rupee. A kit has no HSN code of its own,
 * so a kit line is taxed only as a works contract by the composite rule; any other kit line is
 * refused (`quote_kit_tax_missing`) rather than taxed at a guessed rate. Pure: the command loads
 * every row and passes it in.
 */
export function priceQuote(input: QuotePricingInput): PricedQuote {
  const lines = input.lines.map((line, index): QuoteLineDto => {
    const { source } = line;
    const composite = resolveCompositeRule(input.compositeRules, {
      segment: input.segment,
      worksContract: line.worksContract,
      on: input.on,
    });
    let rate: TaxRateRow | null = null;
    if (composite === null) {
      if (source.kind === 'kit') {
        throw new DomainError('validation_failed', `kit ${source.id} has no tax rate of its own`, {
          reason: 'quote_kit_tax_missing',
          sku: source.sku,
        });
      }
      rate = resolveRate(input.rates, { hsn: source.hsn, itemId: source.id, on: input.on });
    }
    const taxed = computeLine({
      qty: line.qty,
      unitPrice: source.price,
      rate,
      composite,
      supply: input.supply,
    });
    return {
      position: index + 1,
      itemId: source.kind === 'item' ? source.id : null,
      kitId: source.kind === 'kit' ? source.id : null,
      description: source.name,
      sku: source.sku,
      unit: source.unit,
      // As `numeric(12,3)` keeps it, so a preview and the saved quote read the same.
      qty: threeDecimals(line.qty),
      unitPrice: source.price,
      hsn: source.hsn,
      worksContract: line.worksContract,
      taxRateId: taxed.taxRateId,
      taxRatePct: rate?.ratePct ?? null,
      compositeRuleId: taxed.compositeRuleId,
      goodsRatePct: composite?.goodsRatePct ?? null,
      servicesRatePct: composite?.servicesRatePct ?? null,
      taxableValue: taxed.taxableValue,
      goodsTaxable: taxed.goodsTaxable,
      servicesTaxable: taxed.servicesTaxable,
      cgst: taxed.cgst,
      sgst: taxed.sgst,
      igst: taxed.igst,
      lineTotal: taxed.lineTotal,
    };
  });
  for (const line of lines) assertFits(line.lineTotal, line.sku);
  const totals = computeDocument(
    lines.map((l) => ({
      taxRateId: l.taxRateId,
      compositeRuleId: l.compositeRuleId,
      supplyKind: input.supply.kind,
      taxableValue: l.taxableValue,
      goodsTaxable: l.goodsTaxable,
      servicesTaxable: l.servicesTaxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      lineTotal: l.lineTotal,
    })),
  );
  assertFits(totals.grandTotal, null);
  return { lines, totals };
}

/** The most digits of rupees a quote keeps: `numeric(14,2)`. */
const MAX_RUPEE_DIGITS = 12;

/** An amount past what the quote can keep is refused in plain words, not stored as a fault. */
function assertFits(amount: string, sku: string | null): void {
  const rupees = amount.replace('-', '').split('.')[0] ?? '';
  if (rupees.length > MAX_RUPEE_DIGITS) {
    throw new DomainError('validation_failed', `amount ${amount} is past numeric(14,2)`, {
      reason: 'quote_amount_too_large',
      ...(sku === null ? {} : { sku }),
    });
  }
}
