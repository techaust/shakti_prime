import { LeadAnonymiseWorkerBody } from '@shakti/contracts';
import {
  LEAD_ANONYMISE_RUN_BUDGET_MS,
  runLeadAnonymise,
} from '../../../../../../workers/lead-anonymise';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { LEAD_ANONYMISE_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`LEAD_ANONYMISE_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The nightly anonymisation of unqualified leads idle for the retention period (BLUEPRINT §7.9,
 * docs/06-api.md §3.6). Only QStash calls it: the schedule `lead-anonymise-<environment>` each
 * night with an empty body, and, for the cutover rehearsal, a call with `{ "dryRun": true }`,
 * which counts and changes nothing (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: LEAD_ANONYMISE_PATH,
  logPrefix: 'crm.anonymise',
  body: LeadAnonymiseWorkerBody,
  budgetMs: LEAD_ANONYMISE_RUN_BUDGET_MS,
  run: runLeadAnonymise,
});
