import { DomainError, type Principal } from '@shakti/contracts';
import { companyStanding, executeQuery } from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';
import { publishWorkerRun, qstashConfig } from './qstash';

/**
 * The nightly runs that walk every company a batch at a time as `system:workers` (the lead
 * rescoring of CRM-06, the duplicate search of CRM-03): every company in turn, from the one the
 * body names (the first when none), each batch one command in its own transaction scoped to that
 * company. When the run's time is spent, the company and the place it reached go to the next run
 * through QStash, with the night's date in the hand-over's deduplication id.
 */

/** Where a run starts, as the schedule (`{}`) or a hand-over sends it. */
export interface CompanyBatchBody {
  entityId?: number | undefined;
  afterId?: string | undefined;
  runDate?: string | undefined;
}

export interface CompanyBatchOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
  /** The request id of the call that started the run, carried by its audit rows and log lines. */
  requestId?: string | undefined;
}

export interface CompanyBatchSpec {
  /** The run's name in its hand-overs' deduplication ids (`lead-rescore`). */
  runName: string;
  /** The prefix of its log lines (`crm.rescore`). */
  logPrefix: string;
  /** The worker route a hand-over calls. */
  path: string;
  /** One batch of one company: how many rows it changed and where the next one starts. */
  batch: (
    principal: Principal,
    scope: { entityIds: number[]; requestId?: string },
    entityId: number,
    afterId: string | null,
  ) => Promise<{ count: number; nextAfterId: string | null }>;
}

export interface CompanyBatchResult {
  batches: number;
  count: number;
  done: boolean;
}

/**
 * The queue's deduplication id for a hand-over: the run, the night it belongs to and where it
 * starts. A retried hand-over names the same place and QStash sends it once; another night's
 * hand-over from the same place has another id.
 */
export function companyBatchRunId(
  runName: string,
  body: CompanyBatchBody & { runDate: string },
): string {
  return `${runName}-${body.runDate}-${String(body.entityId ?? 1)}-${body.afterId ?? 'start'}`;
}

export async function runCompanyBatches(
  spec: CompanyBatchSpec,
  body: CompanyBatchBody,
  options: CompanyBatchOptions = {},
): Promise<CompanyBatchResult> {
  const now = options.now ?? Date.now;
  const started = now();
  // The night this run belongs to, carried by every hand-over so their ids never repeat a night's.
  const runDate = body.runDate ?? new Date(started).toISOString().slice(0, 10);
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  let batches = 0;
  let count = 0;
  let afterId: string | null = body.afterId ?? null;
  for (let entityId = body.entityId ?? 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'companyBatchStanding' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') {
      afterId = null;
      continue;
    }
    for (;;) {
      if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
        const next = { runDate, entityId, ...(afterId === null ? {} : { afterId }) };
        const config = qstashConfig();
        if (config === undefined) {
          throw new DomainError('integration_unavailable', `no queue for ${spec.runName}`);
        }
        await publishWorkerRun(config, spec.path, next, companyBatchRunId(spec.runName, next));
        logger.log('info', `${spec.logPrefix}_continued`, { requestId, entityId, batches, count });
        return { batches, count, done: false };
      }
      const batch = await spec.batch(principal, scope(entityId), entityId, afterId);
      batches += 1;
      count += batch.count;
      afterId = batch.nextAfterId;
      if (afterId === null) break;
    }
  }
  logger.log('info', `${spec.logPrefix}_run`, { requestId, batches, count });
  return { batches, count, done: true };
}
