import { DuplicateScanWorkerResponse, type DuplicateScanWorkerBody } from '@shakti/contracts';
import { executeCommand, scanDuplicates } from '@shakti/domain';
import {
  companyBatchRunId,
  runCompanyBatches,
  type CompanyBatchOptions,
  type CompanyBatchSpec,
} from './company-batches';
import { DUPLICATE_SCAN_PATH } from './qstash';

/**
 * How long one duplicate search keeps starting batches before it hands the rest to a fresh call.
 * A batch looks around at most 500 customers in two statements, well inside the twenty seconds
 * left to the route's `maxDuration` of 60 seconds.
 */
export const DUPLICATE_SCAN_RUN_BUDGET_MS = 40_000;

const SCAN: CompanyBatchSpec = {
  runName: 'duplicate-scan',
  logPrefix: 'crm.duplicate_scan',
  path: DUPLICATE_SCAN_PATH,
  async batch(principal, scope, entityId, afterId) {
    const batch = await executeCommand(principal, scope, scanDuplicates, { entityId, afterId });
    return { count: batch.found, nextAfterId: batch.nextAfterId };
  },
};

/**
 * The nightly search for duplicate customers and leads (CRM-03, docs/03-roadmap-appendix/phase1.md §7.4):
 * every company in turn, each batch one `crm.duplicate.scan` as `system:workers` scoped to that
 * company, which catches what lead creation cannot: two customers an import and a form made at
 * the same moment, and the rows of an import (`runCompanyBatches`).
 */
export async function runDuplicateScan(
  body: DuplicateScanWorkerBody,
  options: CompanyBatchOptions = {},
): Promise<DuplicateScanWorkerResponse> {
  const result = await runCompanyBatches(SCAN, body, options);
  return DuplicateScanWorkerResponse.parse({
    batches: result.batches,
    found: result.count,
    done: result.done,
  });
}

/** The queue's deduplication id for a hand-over of the search (`companyBatchRunId`). */
export function duplicateScanRunId(body: DuplicateScanWorkerBody & { runDate: string }): string {
  return companyBatchRunId(SCAN.runName, body);
}
