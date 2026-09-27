import { DomainError, type Money, type SignedMoney } from '@shakti/contracts';

/**
 * Integer money for the deterministic core (ADR 0007). Amounts are `bigint` paise, so a
 * twelve-digit rupee amount times a rate never loses precision; strings with two decimals are the
 * only form that enters or leaves.
 */

const MONEY = /^(-?)(\d{1,12})\.(\d{2})$/;

/** `"1234.50"` → `123450n`. Accepts the signed form so a round-off can be read back. */
export function toPaise(value: string): bigint {
  const match = MONEY.exec(value);
  if (!match) throw new DomainError('internal', `not a money string: ${value}`);
  const [, sign, rupees = '0', paise = '00'] = match;
  const amount = BigInt(rupees) * 100n + BigInt(paise);
  return sign === '-' ? -amount : amount;
}

/** `123450n` → `"1234.50"`; negative amounts keep their sign (only a round-off is negative). */
export function fromPaise(paise: bigint): SignedMoney {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const text = `${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

/** A non-negative amount as `Money`; a negative one is a bug in the caller. */
export function moneyFromPaise(paise: bigint): Money {
  if (paise < 0n) throw new DomainError('internal', `negative amount: ${paise.toString()}`);
  return fromPaise(paise);
}

/** A decimal string with at most `scale` decimals as an integer of that scale: `"2.5"`, 3 → `2500n`. */
export function toScaled(value: string, scale: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  const whole = match?.[1];
  const fraction = match?.[2] ?? '';
  if (whole === undefined || fraction.length > scale) {
    throw new DomainError('internal', `not a decimal with ${String(scale)} places: ${value}`);
  }
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
}

/**
 * `numerator / denominator` rounded half-up (half away from zero for the non-negative amounts the
 * engine divides). Both operands must be non-negative and the denominator above zero.
 */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) {
    throw new DomainError('internal', 'half-up division takes non-negative operands');
  }
  return (numerator * 2n + denominator) / (denominator * 2n);
}
