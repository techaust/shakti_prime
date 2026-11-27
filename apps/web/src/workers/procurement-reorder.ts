import { ReorderWorkerResponse } from '@shakti/contracts';
import { companyStanding, draftReorders, executeCommand, executeQuery } from '@shakti/domain';
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
  logger.log('info', 'procurement.reorder_run', { requestId, companies, drafted, itemsWithoutVendor });
  return ReorderWorkerResponse.parse({ companies, drafted, itemsWithoutVendor, done: true });
}
