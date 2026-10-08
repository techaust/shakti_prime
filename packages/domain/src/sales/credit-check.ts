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

function block(facts: CreditFacts, now: Date): GuardFailure | undefined {
  if (facts.accountType !== 'dealer') return undefined;
  if (facts.creditLimit === null) {
    return { code: 'conflict', reason: 'credit_limit_missing' };
  }
  const exposure =
    toPaise(facts.outstanding) +
    (WORKSHOP_DEFAULTS.credit.exposureCountsConfirmedOrders ? toPaise(facts.confirmedUnpaid) : 0n) +
    toPaise(facts.orderValue);
  const limit = toPaise(facts.creditLimit);
  if (exposure > limit) {
    return {
      code: 'conflict',
      reason: 'credit_limit_exceeded',
      details: { limit: facts.creditLimit, exposure: fromPaise(exposure) },
    };
  }
  if (facts.creditDays !== null && facts.oldestUnpaidInvoiceDate !== null) {
    const ageDays = invoiceAgeDays(facts.oldestUnpaidInvoiceDate, istCalendarDate(now));
    if (ageDays > facts.creditDays) {
      return {
        code: 'conflict',
        reason: 'credit_overdue',
        details: {
          invoiceNo: facts.oldestUnpaidInvoiceNo,
          invoiceAgeDays: ageDays,
          creditDays: facts.creditDays,
        },
      };
    }
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
