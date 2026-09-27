import {
  type CompositeRuleRow,
  DomainError,
  type Money,
  type PlaceOfSupply,
  type Quantity,
  type TaxedLine,
  type TaxRateRow,
} from '@shakti/contracts';
import { divideHalfUp, moneyFromPaise, toPaise, toScaled } from '../money/paise';
import { compositeSplit } from './composite';

export interface LineInput {
  qty: Quantity;
  /** The Price Master price, snapshotted on the line; never taken from a person's input. */
  unitPrice: Money;
  /** The resolved rate, or null for a composite line taxed by its rule. */
  rate: TaxRateRow | null;
  composite: CompositeRuleRow | null;
  supply: PlaceOfSupply;
}

/** Rate × value in hundredths of a percent: one percent of a paisa amount is `/ 100 / 100`. */
const WHOLE_RATE = 10_000n;

/**
 * Tax on one line (ADR 0007). The taxable value is quantity × price rounded half-up to the paisa.
 * Intra-state, CGST and SGST are each computed from half the rate and rounded to the paisa on
 * their own; inter-state, IGST from the full rate. A composite line taxes its goods and services
 * parts at their own rates and rounds each tax head once for the line.
 */
export function computeLine(input: LineInput): TaxedLine {
  const qtyMilli = toScaled(input.qty, 3);
  const taxable = divideHalfUp(toPaise(input.unitPrice) * qtyMilli, 1000n);

  let rateTimesValue: bigint;
  let goodsTaxable: bigint | null = null;
  let servicesTaxable: bigint | null = null;
  if (input.composite) {
    const parts = compositeSplit(input.composite, taxable);
    goodsTaxable = parts.goodsTaxable;
    servicesTaxable = parts.servicesTaxable;
    rateTimesValue =
      parts.goodsTaxable * parts.goodsRateBp + parts.servicesTaxable * parts.servicesRateBp;
  } else if (input.rate) {
    rateTimesValue = taxable * toScaled(input.rate.ratePct, 2);
  } else {
    throw new DomainError('validation_failed', 'line has neither a rate nor a composite rule', {
      reason: 'tax_rate_missing',
    });
  }

  const intra = input.supply.kind === 'intra';
  // Each half rounds on its own, so a half-paisa goes up on both heads (ADR 0007).
  const cgst = intra ? divideHalfUp(rateTimesValue, WHOLE_RATE * 2n) : 0n;
  const sgst = intra ? divideHalfUp(rateTimesValue, WHOLE_RATE * 2n) : 0n;
  const igst = intra ? 0n : divideHalfUp(rateTimesValue, WHOLE_RATE);

  return {
    taxRateId: input.composite ? null : (input.rate?.id ?? null),
    compositeRuleId: input.composite?.id ?? null,
    supplyKind: input.supply.kind,
    taxableValue: moneyFromPaise(taxable),
    goodsTaxable: goodsTaxable === null ? null : moneyFromPaise(goodsTaxable),
    servicesTaxable: servicesTaxable === null ? null : moneyFromPaise(servicesTaxable),
    cgst: moneyFromPaise(cgst),
    sgst: moneyFromPaise(sgst),
    igst: moneyFromPaise(igst),
    lineTotal: moneyFromPaise(taxable + cgst + sgst + igst),
  };
}
