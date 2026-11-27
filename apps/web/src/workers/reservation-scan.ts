import {
  ReservationScanWorkerResponse,
  type FillBackordersDto,
  type ReservationScanDto,
} from '@shakti/contracts';
import {
  companyStanding,
  executeCommand,
  executeQuery,
  fillBackorders,
  scanReservations,
} from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';

/**
 * How long one scan run keeps starting batches: a batch lapses or reminds at most 500 holds in a
 * few statements, well inside the twenty seconds left to the route's `maxDuration` of 60 seconds.
 * A run out of time leaves the rest to the next day's call; QStash retries a failed one.
 */
export const RESERVATION_SCAN_RUN_BUDGET_MS = 40_000;

/** Items one catch-up fill takes, as `FillBackordersInput` allows. */
const FILL_ITEMS = 200;

export interface ReservationScanOptions {
  budgetMs?: number | undefined;
  now?: () => number;
  requestId?: string | undefined;
}

/**
 * The daily reservation scan (docs/03-roadmap-appendix/phase3.md §7.1): every company in turn, as
 * `system:workers` scoped to it, which holds the platform-only `inventory.reservations.process`
 * and nothing a person's role holds. Each batch of `inventory.reservation.scan` lapses the holds
 * past their date and reminds those ending within the reminder days, in its own transaction; then
 * `inventory.reservation.fill` runs over the items the company's open orders wait for, so a
 * backorder an event missed is filled the same day.
 */
export async function runReservationScan(
  options: ReservationScanOptions = {},
): Promise<ReservationScanWorkerResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  const outOfTime = () => options.budgetMs !== undefined && now() - started >= options.budgetMs;
  let lapsed = 0;
  let reminded = 0;
  let filled = 0;
  const answer = (done: boolean) =>
    ReservationScanWorkerResponse.parse({ lapsed, reminded, filled, done });
  for (let entityId = 1; ; entityId += 1) {
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'reservationScanCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') continue;
    let items: string[] = [];
    for (;;) {
      if (outOfTime()) return stopped();
      const batch: ReservationScanDto = await executeCommand(
        principal,
        scope(entityId),
        scanReservations,
        { entityId },
      );
      lapsed += batch.lapsed;
      reminded += batch.reminded;
      items = batch.backorderedItemIds;
      if (!batch.more) break;
    }
    for (let i = 0; i < items.length; i += FILL_ITEMS) {
      if (outOfTime()) return stopped();
      const out: FillBackordersDto = await executeCommand(
        principal,
        scope(entityId),
        fillBackorders,
        { entityId, itemIds: items.slice(i, i + FILL_ITEMS) },
      );
      filled += out.filled;
    }
  }
  logger.log('info', 'inventory.reservation_scan_run', { requestId, lapsed, reminded, filled });
  return answer(true);

  function stopped(): ReservationScanWorkerResponse {
    logger.log('info', 'inventory.reservation_scan_stopped', {
      requestId,
      lapsed,
      reminded,
      filled,
    });
    return answer(false);
  }
}
