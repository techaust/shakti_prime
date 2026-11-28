// Display rules of the customer loan screens (docs/03-roadmap-appendix/phase4.md §6.2): the order's
// Loan tab, Account 360's loans and Settings › Lenders. Browser code: types only from the contracts.
import type { CustomerLoanState, LoanGateAnswer } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';

/** How each state of a loan reads as a badge. */
export const LOAN_STATE_TONE: Record<CustomerLoanState, StatusTone> = {
  applied: 'info',
  sanctioned: 'accent',
  disbursed: 'success',
  rejected: 'neutral',
};

/** How the dispatch gate's answer reads as a badge: waiting, released, or nothing held. */
export const LOAN_GATE_TONE: Record<LoanGateAnswer, StatusTone> = {
  pending: 'warning',
  met: 'success',
  none: 'neutral',
};

/** A lender's reference as the contract takes it: a code with no spaces (`LoanReferenceSchema`). */
export const LOAN_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,59}$/;

/** A lender's name as the contract takes it, 2 to 120 characters once trimmed. */
export function lenderNameOk(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 2 && trimmed.length <= 120;
}
