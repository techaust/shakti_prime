import { DomainError, type Money, type SignedMoney } from '@shakti/contracts';
import { divideHalfUp, fromPaise, toPaise, toScaled } from '../money/paise';

/**
 * A project cost line's amount (docs/03-roadmap-appendix/phase4.md §7.3): the quantity (three
 * decimals) times the rate (rupees and paise), rounded half-up to the paisa, as the database's
 * `project_cost_lines_amount_check` computes it. Integer arithmetic only.
 */

/** The largest amount `numeric(14,2)` holds, in paise. */
const AMOUNT_LIMIT = 10n ** 14n;

/** A quantity in thousandths as the database writes it: `2500n` → `"2.500"`. */
export function quantityText(thousandths: bigint): string {
  const negative = thousandths < 0n;
  const abs = negative ? -thousandths : thousandths;
  const text = `${(abs / 1000n).toString()}.${(abs % 1000n).toString().padStart(3, '0')}`;
  return negative ? `-${text}` : text;
}

/**
 * The quantity as stored and the amount of a charge; `cost_amount_too_large` when the amount does
 * not fit.
 */
export function costLineAmount(
  quantity: string,
  rate: Money,
): { quantity: string; amount: SignedMoney } {
  const thousandths = toScaled(quantity, 3);
  const paise = divideHalfUp(thousandths * toPaise(rate), 1000n);
  if (paise >= AMOUNT_LIMIT) {
    throw new DomainError('validation_failed', 'the amount is too large', {
      reason: 'cost_amount_too_large',
    });
  }
  return { quantity: quantityText(thousandths), amount: fromPaise(paise) };
}

/** The total of the lines' amounts, reversals included. */
export function costTotal(amounts: readonly string[]): SignedMoney {
  return fromPaise(amounts.reduce((sum, a) => sum + toPaise(a), 0n));
}
