import {
  DomainError,
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
import { LEAD_ANONYMISE_PATH, publishWorkerRun, qstashConfig } from './qstash';

/**
 * How long one run keeps starting batches. A batch looks at 500 leads and checks each in about a
 * quarter of a millisecond (docs/runs/phase1/m1-migration-uat.md), well inside the twenty seconds
 * left to the route's `maxDuration` of 60 seconds for the batch started last and the hand-over.
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
 * The queue's deduplication id for a hand-over: the run (a dry run is a run of its own), the
 * night it belongs to and where it starts, so a retried hand-over is sent once and another
 * night's hand-over from the same place is not taken for a repeat.
 */
export function leadAnonymiseRunId(
  body: LeadAnonymiseWorkerBody & { runDate: string; entityId: number },
): string {
  const run = body.dryRun === true ? 'lead-anonymise-dry' : 'lead-anonymise';
  const place = body.after === undefined ? 'start' : `${body.after.at}-${body.after.id}`;
  return `${run}-${body.runDate}-${String(body.entityId)}-${place}`.replaceAll(':', '');
}

/**
 * The nightly anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
 * docs/03-roadmap-appendix/phase1.md §10): every company in turn from the one the body names (the
 * first when none), each batch one `crm.lead.anonymise` in its own transaction as
 * `system:workers`, which holds the platform-only `crm.retention.run` and nothing a person's role
 * holds. A customer that fails is recorded in `retention_runs` by the definer and changes nothing;
 * the batch and the company go on. When the run's time is spent, the company and the place it
 * reached go to the next call through QStash, so every company is reached every night; leads kept
 * for good are marked and left out of the window from then on. A dry run (`dryRun`) counts the
 * leads with `countStaleLeads` on a read-only request and changes nothing at all.
 */
export async function runLeadAnonymise(
  body: LeadAnonymiseWorkerBody,
  options: LeadAnonymiseOptions = {},
): Promise<LeadAnonymiseWorkerResponse> {
  const dryRun = body.dryRun === true;
  const now = options.now ?? Date.now;
  const started = now();
  const runDate = body.runDate ?? new Date(started).toISOString().slice(0, 10);
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  const result = { dryRun, batches: 0, examined: 0, anonymised: 0, kept: 0, failedCustomers: 0 };
  let after: LeadRetentionCursor | null = body.after ?? null;
  for (let entityId = body.entityId ?? 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'leadAnonymiseCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') {
      after = null;
      continue;
    }
    for (;;) {
      if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
        const next = {
          ...(dryRun ? { dryRun } : {}),
          runDate,
          entityId,
          ...(after === null ? {} : { after }),
        };
        const config = qstashConfig();
        if (config === undefined) {
          throw new DomainError('integration_unavailable', 'no queue for lead-anonymise');
        }
        await publishWorkerRun(config, LEAD_ANONYMISE_PATH, next, leadAnonymiseRunId(next));
        logger.log('info', 'crm.anonymise_continued', { requestId, entityId, ...result });
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
        result.kept += batch.kept;
        if (batch.failedCustomers > 0) {
          // The definer recorded the failure on its run; those customers wait for the next night.
          result.failedCustomers += batch.failedCustomers;
          logger.log('error', 'crm.anonymise_customers_failed', {
            requestId,
            entityId,
            failedCustomers: batch.failedCustomers,
          });
        }
        after = batch.next;
      }
      result.batches += 1;
      if (after === null) break;
    }
  }
  logger.log('info', 'crm.anonymise_run', { requestId, ...result });
  return LeadAnonymiseWorkerResponse.parse({ ...result, done: true });
}
