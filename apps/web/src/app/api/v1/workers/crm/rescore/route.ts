import { LeadRescoreWorkerBody } from '@shakti/contracts';
import { LEAD_RESCORE_RUN_BUDGET_MS, runLeadRescore } from '../../../../../../workers/lead-rescore';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { LEAD_RESCORE_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`LEAD_RESCORE_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The nightly lead rescoring worker (CRM-06, docs/06-api.md §3.6). Only QStash calls it: the
 * schedule `lead-rescore-<environment>` each night, and a run handing on the rest
 * (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: LEAD_RESCORE_PATH,
  logPrefix: 'crm.rescore',
  body: LeadRescoreWorkerBody,
  budgetMs: LEAD_RESCORE_RUN_BUDGET_MS,
  run: runLeadRescore,
});
