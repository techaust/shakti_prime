import type { AuditOutcome } from '@shakti/contracts';
import type { StatusTone } from '@shakti/ui';

/** How each result of a recorded action is coloured (docs/08-design-system.md §2.3). */
export const OUTCOME_TONE: Record<AuditOutcome, StatusTone> = {
  ok: 'success',
  denied: 'warning',
  failed: 'danger',
};

export const OUTCOMES: readonly AuditOutcome[] = ['ok', 'denied', 'failed'];
