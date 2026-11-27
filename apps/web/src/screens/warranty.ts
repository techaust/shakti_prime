// Addresses and display rules of the warranty screens (R3, docs/03-roadmap-appendix/phase3.md
// §7.5). Browser code: types only from the contracts.
import type { WarrantyClaimState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import type { Route } from 'next';

/** The claims of a company, in one state or all. */
export function warrantyListHref(entityId: number, state?: WarrantyClaimState): Route {
  const query = new URLSearchParams({ company: String(entityId) });
  if (state !== undefined) query.set('state', state);
  return `/inventory/warranty?${query.toString()}` as Route;
}

/** One claim's sheet. */
export function warrantyClaimHref(entityId: number, claimId: string): Route {
  return `/inventory/warranty/${claimId}?company=${String(entityId)}` as Route;
}

/** How each state of a claim reads as a badge. */
export const CLAIM_STATE_TONE: Record<WarrantyClaimState, StatusTone> = {
  raised: 'accent',
  serial_identified: 'info',
  replacement_issued: 'info',
  rma_raised: 'warning',
  closed: 'success',
  rejected: 'neutral',
};

/** The five steps of a claim (BLUEPRINT §8.4), each the state it reaches. */
export const CLAIM_STEPS = [
  'raised',
  'serial_identified',
  'replacement_issued',
  'rma_raised',
  'closed',
] as const satisfies readonly WarrantyClaimState[];

/** Whether a step is behind the claim, where it stands, or still to come; none once rejected. */
export function claimStepStatus(
  step: (typeof CLAIM_STEPS)[number],
  state: WarrantyClaimState,
): 'done' | 'current' | 'next' {
  if (state === 'rejected') return step === 'raised' ? 'done' : 'next';
  const at = CLAIM_STEPS.indexOf(state);
  const index = CLAIM_STEPS.indexOf(step);
  if (index < at || (state === 'closed' && index === at)) return 'done';
  return index === at ? 'current' : 'next';
}
