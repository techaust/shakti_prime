import {
  idTime,
  parseEventPayload,
  ReorderWorkerResponse,
  type DeliveredEvent,
} from '@shakti/contracts';
import {
  companyStanding,
  draftReorders,
  executeCommand,
  executeQuery,
  type KeyValue,
} from '@shakti/domain';
import { logger } from '../log';
import { systemWorkersPrincipal } from './events/system-principal';

/** How long one reorder run keeps starting companies, inside the route's 60 seconds. */
export const REORDER_RUN_BUDGET_MS = 40_000;

export interface ReorderRunOptions {
  /** Stop taking new companies after this long; unlimited when undefined. */
  budgetMs?: number | undefined;
  now?: () => number;
  requestId?: string | undefined;
  /** Only this company (the run after a stock issue); every company when undefined. */
  entityId?: number | undefined;
}

/**
 * The reorder check (docs/03-roadmap-appendix/phase3.md §7.2): each company in turn, one
 * `procurement.reorder.draft` in its own transaction as `system:workers` scoped to that company,
 * which holds the platform-only `procurement.reorder.draft` and no person's grant. Each draft is
 * announced by `procurement.po.drafted` (source `reorder`), which tells the Inventory Manager.
 */
export async function runReorder(options: ReorderRunOptions = {}): Promise<ReorderWorkerResponse> {
  const now = options.now ?? Date.now;
  const started = now();
  const { requestId } = options;
  const scope = (entityId: number) =>
    requestId === undefined ? { entityIds: [entityId] } : { entityIds: [entityId], requestId };
  let companies = 0;
  let drafted = 0;
  let itemsWithoutVendor = 0;
  const first = options.entityId ?? 1;
  for (let entityId = first; ; entityId += 1) {
    if (options.entityId !== undefined && entityId !== options.entityId) break;
    if (options.budgetMs !== undefined && now() - started >= options.budgetMs) {
      logger.log('info', 'procurement.reorder_stopped', { requestId, entityId, drafted });
      return ReorderWorkerResponse.parse({ companies, drafted, itemsWithoutVendor, done: false });
    }
    const principal = systemWorkersPrincipal(entityId);
    const standing = await executeQuery(
      principal,
      scope(entityId),
      (context) => companyStanding(context, entityId),
      { name: 'reorderCompany' },
    );
    if (standing === 'missing') break;
    if (standing === 'archived') continue;
    const out = await executeCommand(principal, scope(entityId), draftReorders, { entityId });
    companies += 1;
    drafted += out.purchaseOrderIds.length;
    itemsWithoutVendor += out.itemsWithoutVendor;
  }
  logger.log('info', 'procurement.reorder_run', {
    requestId,
    companies,
    drafted,
    itemsWithoutVendor,
  });
  return ReorderWorkerResponse.parse({ companies, drafted, itemsWithoutVendor, done: true });
}

/** How long a company's check is remembered for an item: a day, the daily run's own cycle. */
export const REORDER_MARK_SECONDS = 24 * 60 * 60;
/**
 * How long before a check began a movement's event may have been written and still not committed
 * when the check read the stock: an event this close to a check is checked again.
 */
export const REORDER_COMMIT_LAG_MS = 5_000;

const markKey = (entityId: number, itemId: string) =>
  `procurement:reorder:${String(entityId)}:${itemId}`;

/**
 * The reorder check after a stock issue or loss (review finding 5): on `inventory.stock.moved`,
 * when a movement took an item out of a bin and out of the company's stock (no target bin: an
 * issue, a loss, damage, a count short, a receipt reversed), the company's check runs at once
 * (`runReorder` for that company), so a store that issues its last coil gets its draft now, not
 * the next morning. Debounced per company and item: each check marks, for each item that
 * started it, when it began; an event whose every item a check began after (by more than
 * `REORDER_COMMIT_LAG_MS` past the event's own time, its id's) is skipped, since that check read
 * the stock after the movement. A redelivery, a backlog of events, or a batch of issues of items
 * already checked since runs nothing; an issue after the last check always runs it, so no fall
 * below a level waits for the daily run. Two checks of one company never draft twice: the job
 * holds the company's reorder lock and counts what open orders bring.
 */
export async function handleStockMovedReorder(
  event: DeliveredEvent,
  ctx: { keyValue: KeyValue; requestId: string },
  run: (options: ReorderRunOptions) => Promise<ReorderWorkerResponse> = runReorder,
  now: () => number = Date.now,
): Promise<'ran' | 'seen' | 'no_issue'> {
  // The payload as the catalogue has it, without the envelope's version.
  const parsed = parseEventPayload(
    'inventory.stock.moved',
    Object.fromEntries(Object.entries(event.payload).filter(([key]) => key !== 'v')),
  );
  if (!parsed.ok) return 'no_issue';
  const movements = parsed.payload.movements as {
    itemId: string;
    fromBinId: string | null;
    toBinId: string | null;
  }[];
  const items = [
    ...new Set(
      movements.filter((m) => m.fromBinId !== null && m.toBinId === null).map((m) => m.itemId),
    ),
  ];
  if (items.length === 0) return 'no_issue';
  const written = idTime(event.id).getTime();
  const marks = await Promise.all(
    items.map((itemId) => ctx.keyValue.get(markKey(event.entityId, itemId))),
  );
  if (marks.every((mark) => mark !== null && Number(mark) >= written + REORDER_COMMIT_LAG_MS)) {
    return 'seen';
  }
  const began = now();
  await run({ entityId: event.entityId, requestId: ctx.requestId });
  await Promise.all(
    items.map((itemId) =>
      ctx.keyValue.set(markKey(event.entityId, itemId), String(began), REORDER_MARK_SECONDS),
    ),
  );
  return 'ran';
}
