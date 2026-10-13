import {
  LeadAnonymiseWorkerResponse,
  type AnonymiseStaleLeadsInput,
  type LeadAnonymiseBatchDto,
  type LeadAnonymiseWorkerBody,
  type LeadRetentionCursor,
  type StaleLeadCountDto,
} from '@shakti/contracts';
import {
  anonymiseStaleLeads,
  companyStanding,
  countStaleLeads,
  executeCommand,
  executeQuery,
} from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';

/**
 * How long one run keeps starting batches. A batch looks at 500 leads and checks each in about a
 * quarter of a millisecond (docs/runs/phase1/m1-migration-uat.md), well inside the twenty seconds
 * left to the route's `maxDuration` of 60 seconds. What a run leaves for want of time is done the
 * next night: nothing waits on it.
 */
export const LEAD_ANONYMISE_RUN_BUDGET_MS = 40_000;

export interface LeadAnonymiseOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
  /** The request id of the call that started the run, carried by its audit rows and log lines. */
  requestId?: string | undefined;
}

/**
 * The nightly anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
 * docs/03-roadmap-appendix/phase1.md §10): every company in turn, each batch one
 * `crm.lead.anonymise` in its own transaction as `system:workers`, which holds the platform-only
 * `crm.retention.run` and nothing a person's role holds. A batch that fails is recorded in
 * `retention_runs` by the definer, changes nothing, and ends that company's run for the night; the
 * other companies go on. A dry run (`dryRun`) counts the leads with `countStaleLeads` on a
 * read-only request and changes nothing at all.
 */
export async function runLeadAnonymise(
  body: LeadAnonymiseWorkerBody,
  options: LeadAnonymiseOptions = {},
): Promise<LeadAnonymiseWorkerResponse> {
  const dryRun = body.dryRun === true;
  const now = options.now ?? Date.now;
  const started = now();
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  const result = { dryRun, batches: 0, examined: 0, anonymised: 0, failedBatches: 0 };
  for (let entityId = 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'leadAnonymiseCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') continue;
    let after: LeadRetentionCursor | null = null;
    for (;;) {
      if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
        logger.log('info', 'crm.anonymise_stopped', { requestId, entityId, ...result });
        return LeadAnonymiseWorkerResponse.parse({ ...result, done: false });
      }
      const input: AnonymiseStaleLeadsInput = { entityId, after };
      if (dryRun) {
        const batch: StaleLeadCountDto = await executeQuery(
          principal,
          scope(entityId),
          (context) => countStaleLeads(context, input),
          { name: 'countStaleLeads' },
        );
        result.anonymised += batch.stale;
        result.examined += batch.examined;
        after = batch.next;
      } else {
        const batch: LeadAnonymiseBatchDto = await executeCommand(
          principal,
          scope(entityId),
          anonymiseStaleLeads,
          input,
        );
        result.anonymised += batch.anonymised;
        result.examined += batch.examined;
        if (batch.failed) {
          // The definer recorded the failure on its run; the company waits for the next night.
          result.failedBatches += 1;
          logger.log('error', 'crm.anonymise_batch_failed', { requestId, entityId });
          after = null;
        } else {
          after = batch.next;
        }
      }
      result.batches += 1;
      if (after === null) break;
    }
  }
  logger.log('info', 'crm.anonymise_run', { requestId, ...result });
  return LeadAnonymiseWorkerResponse.parse({ ...result, done: true });
}
