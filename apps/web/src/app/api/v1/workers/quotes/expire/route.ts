import { QuoteExpireWorkerBody } from '@shakti/contracts';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { QUOTE_EXPIRE_PATH } from '../../../../../../workers/qstash';
import { QUOTE_EXPIRE_RUN_BUDGET_MS, runQuoteExpiry } from '../../../../../../workers/quote-expiry';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`QUOTE_EXPIRE_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The daily quote expiry worker (docs/03-roadmap-appendix/phase1.md §7.3, docs/06-api.md §3.6). Only
 * QStash calls it, on the schedule `quote-expire-<environment>` each night; the signature, the
 * body and the answers are `nightlyWorkerRoute`'s. The body carries nothing the run reads.
 */
export const POST = nightlyWorkerRoute({
  path: QUOTE_EXPIRE_PATH,
  job: 'quote-expire',
  logPrefix: 'sales.quote_expiry',
  body: QuoteExpireWorkerBody,
  budgetMs: QUOTE_EXPIRE_RUN_BUDGET_MS,
  run: (_body, options) => runQuoteExpiry(options),
});
