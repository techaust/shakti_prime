import { ReservationScanWorkerBody } from '@shakti/contracts';
import { nightlyWorkerRoute } from '../../../../../../workers/nightly-route';
import { RESERVATION_SCAN_PATH } from '../../../../../../workers/qstash';
import {
  RESERVATION_SCAN_RUN_BUDGET_MS,
  runReservationScan,
} from '../../../../../../workers/reservation-scan';

export const dynamic = 'force-dynamic';
/** Seconds; the worker stops taking new batches well before this (`RESERVATION_SCAN_RUN_BUDGET_MS`). */
export const maxDuration = 60;

/**
 * The daily reservation scan (docs/03-roadmap-appendix/phase3.md §7.1, docs/06-api.md §3.6). Only
 * QStash calls it, on the schedule `reservation-scan-<environment>` each night; the signature, the
 * body and the answers are `nightlyWorkerRoute`'s. The body carries nothing the run reads.
 */
export const POST = nightlyWorkerRoute({
  path: RESERVATION_SCAN_PATH,
  job: 'reservation-scan',
  logPrefix: 'inventory.reservation_scan',
  body: ReservationScanWorkerBody,
  budgetMs: RESERVATION_SCAN_RUN_BUDGET_MS,
  run: (_body, options) => runReservationScan(options),
});
