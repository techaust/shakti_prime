import type { CommissionBasis, Money } from '@shakti/contracts';
import { divideHalfUp, moneyFromPaise, toPaise, toScaled } from '../money/paise';

export interface CommissionFacts {
  basis: CommissionBasis;
  /** The rule's amount: rupees for `fixed`, `per_kw` and `per_hp`; a percentage for `percent`. */
  rate: Money;
  /** The order's taxable value (`sales_orders.subtotal`), which a percentage applies to. */
  taxableValue: Money;
  /** The lead's system size in kW from its newest sizing, when it has one. */
  kw: number | null;
  /** The lead's pump rating in HP from its newest sizing, when it has one. */
  hp: number | null;
}

/** What the rate was applied to, with three decimals, and the commission. */
export interface Commission {
  measure: string;
  amount: Money;
}

/** A size as a three-decimal string, or null when it is not a finite number above zero. */
function size(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value.toFixed(3);
}

/**
 * A commission on a confirmed order by its rule (CRM-09, docs/03-roadmap-appendix/phase1.md §8.3): the rate
 * itself for a fixed commission, the percentage of the order's taxable value, or the rate per kW
 * or per HP of the lead's sizing; rounded half-up to the paisa (as `round(…, 2)` in the database's
 * check, `app.record_commission_accrual()`). Null when the basis needs a size the lead's sizing
 * does not give: nothing is guessed. Pure.
 */
export function commissionAmount(facts: CommissionFacts): Commission | null {
  const rate = toPaise(facts.rate);
  switch (facts.basis) {
    case 'fixed':
      return { measure: '1.000', amount: moneyFromPaise(rate) };
    case 'percent': {
      // paise × hundredths of a percent / 10,000 = paise.
      const taxable = toPaise(facts.taxableValue);
      return {
        measure: `${facts.taxableValue}0`,
        amount: moneyFromPaise(divideHalfUp(taxable * rate, 10_000n)),
      };
    }
    case 'per_kw':
    case 'per_hp': {
      const measure = size(facts.basis === 'per_kw' ? facts.kw : facts.hp);
      if (measure === null) return null;
      // thousandths × paise / 1,000 = paise.
      return {
        measure,
        amount: moneyFromPaise(divideHalfUp(toScaled(measure, 3) * rate, 1_000n)),
      };
    }
  }
}
