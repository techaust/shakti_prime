import {
  DomainError,
  LeadRescoreWorkerResponse,
  type LeadRescoreWorkerBody,
} from '@shakti/contracts';
import { companyStanding, executeCommand, executeQuery, refreshLeadScores } from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';
import { publishLeadRescore, qstashConfig } from './qstash';

/**
 * How long one rescoring run keeps starting batches before it hands the rest to a fresh call. A
 * batch is at most a thousand leads read and written in two statements, well inside the twenty
 * seconds left to the route's `maxDuration` of 60 seconds.
 */
export const LEAD_RESCORE_RUN_BUDGET_MS = 40_000;

export interface LeadRescoreOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
  /** The request id of the call that started the run, carried by its audit rows and log lines. */
  requestId?: string | undefined;
}

/**
 * The nightly rescoring of open and nurture leads (CRM-06, docs/design/phase1.md §6.6): every
 * company in turn, from the one the body names (the first when none), each batch one
 * `crm.lead.score_refresh` in its own transaction as `system:workers` scoped to that company. When
 * the time runs out, the company and the last lead reached go to the next run through QStash.
 */
export async function runLeadRescore(
  body: LeadRescoreWorkerBody,
  options: LeadRescoreOptions = {},
): Promise<LeadRescoreWorkerResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  let batches = 0;
  let rescored = 0;
  let afterId: string | null = body.afterId ?? null;
  for (let entityId = body.entityId ?? 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'leadRescoreCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') {
      afterId = null;
      continue;
    }
    for (;;) {
      if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
        await continueLeadRescore({ entityId, ...(afterId === null ? {} : { afterId }) });
        logger.log('info', 'crm.rescore_continued', { requestId, entityId, batches, rescored });
        return LeadRescoreWorkerResponse.parse({ batches, rescored, done: false });
      }
      const batch = await executeCommand(principal, scope(entityId), refreshLeadScores, {
        entityId,
        afterId,
      });
      batches += 1;
      rescored += batch.rescored;
      afterId = batch.nextAfterId;
      if (afterId === null) break;
    }
  }
  logger.log('info', 'crm.rescore_run', { requestId, batches, rescored });
  return LeadRescoreWorkerResponse.parse({ batches, rescored, done: true });
}

/**
 * The queue's deduplication id for a run: where it starts. A retried hand-over names the same run
 * and QStash sends it once.
 */
export function leadRescoreRunId(body: LeadRescoreWorkerBody): string {
  return `lead-rescore-${String(body.entityId ?? 1)}-${body.afterId ?? 'start'}`;
}

/** Hands the rest of a run to a fresh call of the worker through QStash. */
async function continueLeadRescore(body: LeadRescoreWorkerBody): Promise<void> {
  const config = qstashConfig();
  if (config === undefined) {
    throw new DomainError('integration_unavailable', 'no queue for the rescoring worker');
  }
  await publishLeadRescore(config, body, leadRescoreRunId(body));
}
