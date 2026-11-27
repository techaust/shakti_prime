// Display rules of the order's Payments tab and Settings › Payment terms (FN1,
// docs/03-roadmap-appendix/phase5.md §6.1). Browser code: types only from the contracts.
import type { PaymentMilestoneState, ProformaState } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';
import { OPEN_MILESTONE_STATES } from './contract-values';

/** How each state of a payment reads as a badge. */
export const MILESTONE_STATE_TONE: Record<PaymentMilestoneState, StatusTone> = {
  pending: 'neutral',
  due: 'warning',
  part_paid: 'info',
  paid: 'success',
  waived: 'neutral',
};

/** How each state of a proforma reads as a badge. */
export const PROFORMA_STATE_TONE: Record<ProformaState, StatusTone> = {
  issued: 'accent',
  cancelled: 'neutral',
};

/** Whether a payment still waits for money, so the Executive may waive it. */
export function milestoneOpen(state: PaymentMilestoneState): boolean {
  return (OPEN_MILESTONE_STATES as readonly string[]).includes(state);
}

/**
 * A payment's name turned into the key the terms keep it by: lower-case words joined by
 * underscores, starting with a letter, unique within the version (a second "Balance" becomes
 * `balance_2`). The person never sees it.
 */
export function stepKeys(labels: readonly string[]): string[] {
  const used = new Set<string>();
  return labels.map((label, index) => {
    const base =
      label
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^[^a-z]+/, '')
        .replace(/_+$/, '')
        .slice(0, 30) || `payment_${String(index + 1)}`;
    let key = base;
    for (let n = 2; used.has(key); n += 1) key = `${base}_${String(n)}`;
    used.add(key);
    return key;
  });
}

/**
 * The sum of the typed percentages in hundredths, so the form can say whether they reach 100
 * before it is sent (the server checks again); a value that is not a number counts as nothing.
 */
export function percentTotal(values: readonly string[]): number {
  return values.reduce((sum, value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? sum + Math.round(n * 100) : sum;
  }, 0);
}

/** A typed percentage or amount with two decimals, as the contracts take it: `50` → `50.00`. */
export function twoDecimals(value: string): string | null {
  const trimmed = value.trim().replaceAll(',', '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole = '0', fraction = ''] = trimmed.split('.');
  return `${String(Number(whole))}.${fraction.padEnd(2, '0')}`;
}
