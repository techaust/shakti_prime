import type { DocumentTotals, TaxedLine } from '@shakti/contracts';
import { divideHalfUp, fromPaise, moneyFromPaise, toPaise } from '../money/paise';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

/**
 * Totals of a quote, order or proforma from its computed lines (ADR 0007): each head is the sum
 * of the lines' rounded amounts, and the total rounds half-up to the whole rupee with the
 * difference kept in `round_off` (between −0.49 and +0.50).
 */
export function computeDocument(lines: readonly TaxedLine[]): DocumentTotals {
  let subtotal = 0n;
  let cgst = 0n;
  let sgst = 0n;
  let igst = 0n;
  for (const line of lines) {
    subtotal += toPaise(line.taxableValue);
    cgst += toPaise(line.cgst);
    sgst += toPaise(line.sgst);
    igst += toPaise(line.igst);
  }
  const taxTotal = cgst + sgst + igst;
  const exact = subtotal + taxTotal;
  const grandTotal = WORKSHOP_DEFAULTS.tax.roundDocumentToRupee
    ? divideHalfUp(exact, 100n) * 100n
    : exact;
  return {
    subtotal: moneyFromPaise(subtotal),
    cgst: moneyFromPaise(cgst),
    sgst: moneyFromPaise(sgst),
    igst: moneyFromPaise(igst),
    taxTotal: moneyFromPaise(taxTotal),
    roundOff: fromPaise(grandTotal - exact),
    grandTotal: moneyFromPaise(grandTotal),
  };
}
