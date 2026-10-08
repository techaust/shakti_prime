import { DuplicateScanWorkerBody } from '@shakti/contracts';
import {
  DUPLICATE_SCAN_RUN_BUDGET_MS,
  runDuplicateScan,
} from '../../../../../../workers/duplicate-scan';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { DUPLICATE_SCAN_PATH } from '../../../../../../workers/qstash';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`DUPLICATE_SCAN_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The nightly duplicate search (CRM-03, docs/06-api.md §3.6). Only QStash calls it: the schedule
 * `duplicate-scan-<environment>` each night, and a run handing on the rest (`nightlyWorkerRoute`).
 */
export const POST = nightlyWorkerRoute({
  path: DUPLICATE_SCAN_PATH,
  logPrefix: 'crm.duplicate_scan',
  body: DuplicateScanWorkerBody,
  budgetMs: DUPLICATE_SCAN_RUN_BUDGET_MS,
  run: runDuplicateScan,
});
