import { LeadRescoreWorkerResponse, type LeadRescoreWorkerBody } from '@shakti/contracts';
import { executeCommand, refreshLeadScores } from '@shakti/domain';
import {
  companyBatchRunId,
  runCompanyBatches,
  type CompanyBatchOptions,
  type CompanyBatchSpec,
} from './company-batches';
import { LEAD_RESCORE_PATH } from './qstash';

/**
 * How long one rescoring run keeps starting batches before it hands the rest to a fresh call. A
 * batch is at most a thousand leads read and written in two statements, well inside the twenty
 * seconds left to the route's `maxDuration` of 60 seconds.
 */
export const LEAD_RESCORE_RUN_BUDGET_MS = 40_000;

export type LeadRescoreOptions = CompanyBatchOptions;

const RESCORE: CompanyBatchSpec = {
  runName: 'lead-rescore',
  logPrefix: 'crm.rescore',
  path: LEAD_RESCORE_PATH,
  async batch(principal, scope, entityId, afterId) {
    const batch = await executeCommand(principal, scope, refreshLeadScores, { entityId, afterId });
    return { count: batch.rescored, nextAfterId: batch.nextAfterId };
  },
};

/**
 * The nightly rescoring of open and nurture leads (CRM-06, docs/03-roadmap-appendix/phase1.md §6.6): every
 * company in turn, each batch one `crm.lead.score_refresh` as `system:workers` scoped to that
 * company (`runCompanyBatches`).
 */
export async function runLeadRescore(
  body: LeadRescoreWorkerBody,
  options: LeadRescoreOptions = {},
): Promise<LeadRescoreWorkerResponse> {
  const result = await runCompanyBatches(RESCORE, body, options);
  return LeadRescoreWorkerResponse.parse({
    batches: result.batches,
    rescored: result.count,
    done: result.done,
  });
}

/** The queue's deduplication id for a hand-over of the rescoring (`companyBatchRunId`). */
export function leadRescoreRunId(body: LeadRescoreWorkerBody & { runDate: string }): string {
  return companyBatchRunId(RESCORE.runName, body);
}
