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

/** A step of a claim's sheet: one of the five, or the rejection that ends a claim early. */
export type ClaimStepKey = (typeof CLAIM_STEPS)[number] | 'rejected';

/**
 * A claim's steps as its sheet lists them: each step up to the claim's state done, the one after
 * it next, the rest still to come. A rejected claim lists its raising and its rejection, both done,
 * since the later steps never come (and its state does not say whether it was identified first).
 */
export function claimSteps(
  state: WarrantyClaimState,
): { step: ClaimStepKey; status: 'done' | 'current' | 'next' }[] {
  if (state === 'rejected') {
    return [
      { step: 'raised', status: 'done' },
      { step: 'rejected', status: 'done' },
    ];
  }
  const at = CLAIM_STEPS.indexOf(state);
  return CLAIM_STEPS.map((step, index) => ({
    step,
    status: index <= at ? 'done' : index === at + 1 ? 'current' : 'next',
  }));
}
