import type { AccountType, Money } from '@shakti/contracts';
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
  /** `dealer_outstanding.oldest_overdue_days`, and the invoice it belongs to. */
  oldestOverdueDays: number | null;
  oldestOverdueInvoiceNo: string | null;
}

/** An Executive's release of a block: `credit_release_by` with the reason (audited). */
export interface CreditRelease {
  by: string;
  reason: string;
}

export type CreditOutcome =
  { blocked: false; released: boolean } | { blocked: true; failure: GuardFailure };

function block(facts: CreditFacts): GuardFailure | undefined {
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
  if (
    facts.creditDays !== null &&
    facts.oldestOverdueDays !== null &&
    facts.oldestOverdueDays > facts.creditDays
  ) {
    return {
      code: 'conflict',
      reason: 'credit_overdue',
      details: {
        invoiceNo: facts.oldestOverdueInvoiceNo,
        overdueDays: facts.oldestOverdueDays,
        creditDays: facts.creditDays,
      },
    };
  }
  return undefined;
}

/**
 * Blocks a dealer order when outstanding + confirmed-unpaid orders + this order exceed the limit,
 * or when the oldest overdue invoice is older than the credit days; the block names the limit or
 * the invoice. A release with a reason lets the order through and is reported as `released`.
 */
export function creditCheck(facts: CreditFacts, release: CreditRelease | null): CreditOutcome {
  const failure = block(facts);
  if (!failure) return { blocked: false, released: false };
  if (release?.by.trim() && release.reason.trim()) {
    return { blocked: false, released: true };
  }
  return { blocked: true, failure };
}
