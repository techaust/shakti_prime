import type { AccountType, Money } from '@shakti/contracts';
import { istCalendarDate } from '../numbering/financial-year';
import { fromPaise, toPaise } from '../money/paise';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import type { GuardFailure } from '../state-machines/define-machine';

/**
 * Dealer credit check on order confirmation (design §7.4, BLUEPRINT §8.3, PRD SAL-07). Pure: the
 * command loads `dealer_outstanding` for the account and entity (entered by hand until the Tally
 * sync lands) and the confirmed-unpaid orders, and passes them in.
 */
export interface CreditFacts {
  accountType: AccountType;
  /** `dealer_terms.credit_limit`; null for a dealer with no limit set, which blocks (fails closed). */
  creditLimit: Money | null;
  creditDays: number | null;
  /** `dealer_outstanding.outstanding` for the account in this entity. */
  outstanding: Money;
  /** Confirmed orders of the account in this entity not yet paid. */
  confirmedUnpaid: Money;
  /** This order's total. */
  orderValue: Money;
  /**
   * `dealer_outstanding.oldest_unpaid_invoice_date` (YYYY-MM-DD), and the invoice it belongs to:
   * the oldest invoice of the dealer that is still unpaid, as Accounts last entered it. Its age
   * is worked out on the day of the check, so the figure ages after its as-of date.
   */
  oldestUnpaidInvoiceDate: string | null;
  oldestUnpaidInvoiceNo: string | null;
}

/** An Executive's release of a block: `credit_release_by` with the reason (audited). */
export interface CreditRelease {
  by: string;
  reason: string;
}

export type CreditOutcome =
  { blocked: false; released: boolean } | { blocked: true; failure: GuardFailure };

/** Whole days from an invoice's date to a day, both YYYY-MM-DD. */
export function invoiceAgeDays(invoiceDate: string, today: string): number {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((day(today) - day(invoiceDate)) / 86_400_000);
}

/** A dealer's credit position in one company, as `app.dealer_credit_position()` answers it. */
export type CreditPosition = Pick<
  CreditFacts,
  'creditLimit' | 'creditDays' | 'outstanding' | 'confirmedUnpaid' | 'oldestUnpaidInvoiceDate'
>;

/** Where a dealer stands against their terms on a day, with or without an order on top. */
export interface CreditStanding {
  /** Outstanding, the confirmed unpaid orders when SALE-5 counts them, and the order on top. */
  exposure: Money;
  /** A limit is set and the exposure is over it. */
  overLimit: boolean;
  /** Whole days, on the day of `now` in IST, since the oldest unpaid invoice; null when none. */
  oldestUnpaidAgeDays: number | null;
  /** Credit days are set and the oldest unpaid invoice is older than them. */
  overdue: boolean;
}

/**
 * The one place a dealer's exposure and its overdue test are worked out (ARCH-5): the credit check
 * at confirmation, Accounts' home and `/dealer-credit` all call it, so they follow the SALE-5
 * setting alike (`WORKSHOP_DEFAULTS.credit.exposureCountsConfirmedOrders`, which a test may pass).
 * `orderValue` is the order being confirmed, `0.00` for a reading of where the dealer stands.
 */
export function creditStanding(
  position: CreditPosition,
  orderValue: Money,
  now: Date,
  countsConfirmedOrders: boolean = WORKSHOP_DEFAULTS.credit.exposureCountsConfirmedOrders,
): CreditStanding {
  const exposure =
    toPaise(position.outstanding) +
    (countsConfirmedOrders ? toPaise(position.confirmedUnpaid) : 0n) +
    toPaise(orderValue);
  const age =
    position.oldestUnpaidInvoiceDate === null
      ? null
      : invoiceAgeDays(position.oldestUnpaidInvoiceDate, istCalendarDate(now));
  return {
    exposure: fromPaise(exposure),
    overLimit: position.creditLimit !== null && exposure > toPaise(position.creditLimit),
    oldestUnpaidAgeDays: age,
    overdue: position.creditDays !== null && age !== null && age > position.creditDays,
  };
}

function block(facts: CreditFacts, now: Date): GuardFailure | undefined {
  if (facts.accountType !== 'dealer') return undefined;
  if (facts.creditLimit === null) {
    return { code: 'conflict', reason: 'credit_limit_missing' };
  }
  const standing = creditStanding(facts, facts.orderValue, now);
  if (standing.overLimit) {
    return {
      code: 'conflict',
      reason: 'credit_limit_exceeded',
      details: { limit: facts.creditLimit, exposure: standing.exposure },
    };
  }
  if (standing.overdue) {
    return {
      code: 'conflict',
      reason: 'credit_overdue',
      details: {
        invoiceNo: facts.oldestUnpaidInvoiceNo,
        invoiceAgeDays: standing.oldestUnpaidAgeDays,
        creditDays: facts.creditDays,
      },
    };
  }
  return undefined;
}

/**
 * Blocks a dealer order when outstanding + confirmed-unpaid orders + this order exceed the limit,
 * or when the oldest unpaid invoice is older than the credit days on the day of the check (`now`,
 * in IST: an invoice unpaid beyond the credit days is overdue); the block names the limit or the
 * invoice and its age. A release with a reason lets the order through and is reported as
 * `released`.
 */
export function creditCheck(
  facts: CreditFacts,
  release: CreditRelease | null,
  now: Date,
): CreditOutcome {
  const failure = block(facts, now);
  if (!failure) return { blocked: false, released: false };
  if (release?.by.trim() && release.reason.trim()) {
    return { blocked: false, released: true };
  }
  return { blocked: true, failure };
}
