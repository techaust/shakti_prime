import { QuoteExpireWorkerResponse, type QuoteExpiryBatchDto } from '@shakti/contracts';
import { companyStanding, executeCommand, executeQuery, expireQuotes } from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';

/**
 * How long one expiry run keeps starting batches. A batch is at most 500 quotes read and marked
 * in two statements, well inside the twenty seconds left to the route's `maxDuration` of 60
 * seconds. A run that runs out of time leaves the rest to the next day's run; a read already
 * shows a lapsed quote as expired.
 */
export const QUOTE_EXPIRE_RUN_BUDGET_MS = 40_000;

export interface QuoteExpiryOptions {
  /** Stop taking new batches after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
  /** The request id of the call that started the run, carried by its audit rows and log lines. */
  requestId?: string | undefined;
}

/**
 * The daily quote expiry (docs/design/phase1.md §7.3): every company in turn, each batch one
 * `sales.quote.expire` in its own transaction as `system:workers` scoped to that company, which
 * holds the platform-only `sales.quote.expire` and nothing a person's role holds.
 */
export async function runQuoteExpiry(
  options: QuoteExpiryOptions = {},
): Promise<QuoteExpireWorkerResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  let batches = 0;
  let expired = 0;
  for (let entityId = 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'quoteExpiryCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') continue;
    let afterId: string | null = null;
    for (;;) {
      if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
        logger.log('info', 'sales.quote_expiry_stopped', { requestId, entityId, batches, expired });
        return QuoteExpireWorkerResponse.parse({ batches, expired, done: false });
      }
      const batch: QuoteExpiryBatchDto = await executeCommand(principal, scope(entityId), expireQuotes, {
        entityId,
        afterId,
      });
      batches += 1;
      expired += batch.expired;
      afterId = batch.nextAfterId;
      if (afterId === null) break;
    }
  }
  logger.log('info', 'sales.quote_expiry_run', { requestId, batches, expired });
  return QuoteExpireWorkerResponse.parse({ batches, expired, done: true });
}
