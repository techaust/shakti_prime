import { DomainError, type ImportJobState } from '@shakti/contracts';

/**
 * The import job's states (docs/03-roadmap-appendix/backend-weeks-3-5.md §8). A job may be mapped again and
 * previewed again until it commits; committing continues batch by batch until every valid row is
 * in (`committed`) or a batch fails (`failed`); either end may be rolled back, once.
 */
export const IMPORT_JOB_TRANSITIONS: Readonly<Record<ImportJobState, readonly ImportJobState[]>> = {
  uploaded: ['mapped'],
  mapped: ['mapped', 'previewed'],
  previewed: ['mapped', 'previewed', 'committing'],
  committing: ['committing', 'committed', 'failed'],
  committed: ['rolled_back'],
  failed: ['rolled_back'],
  rolled_back: [],
};

export function canMoveImportJob(from: ImportJobState, to: ImportJobState): boolean {
  return IMPORT_JOB_TRANSITIONS[from].includes(to);
}

/** Refuses a step the job's state does not allow, with a reason the screen can explain. */
export function assertImportJobMove(from: ImportJobState, to: ImportJobState): void {
  if (!canMoveImportJob(from, to)) {
    throw new DomainError('conflict', `an import job cannot move from ${from} to ${to}`, {
      reason: 'import_job_state',
      from,
      to,
    });
  }
}
