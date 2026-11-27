import { DomainError, type Money, type PurchaseOrderTotalsDto } from '@shakti/contracts';
import { divideHalfUp, moneyFromPaise, toScaled } from '../money/paise';
import { computeDocument, computeLine, placeOfSupply } from '../tax';

/**
 * A purchase order line's amount (docs/03-roadmap-appendix/phase3.md §7.2): its quantity in the
 * purchase unit (three decimals) times its rate per purchase unit (four decimals), rounded half-up
 * to the paisa. Pure; the amount is stored beside the rate in `po_line_rates`.
 */
export function poLineAmount(qty: string, rate: string): Money {
  const qtyMilli = toScaled(qty, 3);
  const rateTenThousandths = toScaled(rate, 4);
  // qty × rate in rupees is qtyMilli × rate4 / 10^7; in paise, / 10^5.
  return moneyFromPaise(divideHalfUp(qtyMilli * rateTenThousandths, 100_000n));
}

/** The cost of one stock unit at a purchase rate, as the receipt definer posts it (four decimals). */
export function stockUnitCost(rate: string, unitFactor: string): string {
  const rate4 = toScaled(rate, 4);
  const factorMilli = toScaled(unitFactor, 3);
  if (factorMilli <= 0n) throw new DomainError('internal', 'a unit factor is above zero');
  // rate4 / factor, kept at four decimals: rate4 × 1000 / factorMilli.
  const scaled = divideHalfUp(rate4 * 1000n, factorMilli);
  const text = scaled.toString().padStart(5, '0');
  return `${text.slice(0, -4)}.${text.slice(-4)}`;
}

export interface TotalsLine {
  /** The line's amount (`poLineAmount`), or null while it has no rate. */
  amount: Money | null;
  /** The GST rate the tax engine resolved for the line, or null while none is in force. */
  taxRatePct: string | null;
  taxRateId: string | null;
}

export interface TotalsParties {
  /** The vendor's GST state, or null for an unregistered vendor (taken as the place of supply). */
  vendorStateCode: string | null;
  /** Where the goods are delivered: the hub's state. */
  placeOfSupplyStateCode: string;
}

/**
 * The tax split and totals of a purchase order by the tax engine (ADR 0007): the vendor supplies,
 * so the supply is intra-state when the vendor's state is the place of supply (CGST and SGST),
 * else inter-state (IGST); each line is taxed on its amount, and the grand total rounds to the
 * rupee. Null while any line lacks its amount or its GST rate.
 */
export function purchaseOrderTotals(
  lines: readonly TotalsLine[],
  parties: TotalsParties,
): PurchaseOrderTotalsDto | null {
  if (lines.length === 0) return null;
  const supply = placeOfSupply({
    siteStateCode: parties.placeOfSupplyStateCode,
    entityStateCode: parties.vendorStateCode ?? parties.placeOfSupplyStateCode,
  });
  const taxed = [];
  for (const line of lines) {
    if (line.amount === null || line.taxRatePct === null || line.taxRateId === null) return null;
    taxed.push(
      computeLine({
        qty: '1',
        unitPrice: line.amount,
        rate: {
          id: line.taxRateId,
          hsn: null,
          itemId: null,
          ratePct: line.taxRatePct,
          effectiveFrom: '2000-01-01',
          effectiveTo: null,
        },
        composite: null,
        supply,
      }),
    );
  }
  const totals = computeDocument(taxed);
  return {
    subtotal: totals.subtotal,
    cgst: totals.cgst,
    sgst: totals.sgst,
    igst: totals.igst,
    taxTotal: totals.taxTotal,
    roundOff: totals.roundOff,
    grandTotal: totals.grandTotal,
  };
}
