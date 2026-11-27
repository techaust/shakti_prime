// Who may do what on Procurement's screens, worked out on the server from the person's grants
// per company (docs/03-roadmap-appendix/phase3.md §6.3). Hiding a button is a courtesy: every
// command and query checks again, and row security decides the rows.

import { hasGrant, type PermissionGrant, type Principal } from '@shakti/contracts';

interface CompanyAccess {
  entityId: number;
  entityName: string;
  grants: readonly PermissionGrant[];
}

const both = (grants: readonly PermissionGrant[]) =>
  hasGrant(grants, 'procurement.rate.read', 'entity') &&
  hasGrant(grants, 'procurement.po.write', 'entity');

/** The companies of the request where the person reads supplier rates, for the comparison. */
export function rateCompanies(
  principal: Pick<Principal, 'entityIds'>,
  entities: readonly CompanyAccess[],
): { id: number; name: string }[] {
  return entities
    .filter(
      (e) =>
        principal.entityIds.includes(e.entityId) &&
        hasGrant(e.grants, 'procurement.rate.read', 'entity'),
    )
    .map((e) => ({ id: e.entityId, name: e.entityName }));
}

/**
 * The companies a quote may be recorded for: the whole group first when the request covers every
 * company and the person holds both grants, then each company of the request where they do.
 */
export function quoteCompanies(
  principal: Pick<Principal, 'entityIds' | 'permissions'>,
  entities: readonly CompanyAccess[],
  coversGroup: boolean,
  groupName: string,
): { entityId: number | null; name: string }[] {
  const companies = entities
    .filter((e) => principal.entityIds.includes(e.entityId) && both(e.grants))
    .map((e) => ({ entityId: e.entityId, name: e.entityName }));
  const group = coversGroup && both(principal.permissions);
  return [...(group ? [{ entityId: null, name: groupName }] : []), ...companies];
}

/**
 * U2: the order and receipt tabs' words for whoever reads a company's purchase orders (its stock
 * readers and order writers), else none.
 */
export function orderTabs(
  can: (key: 'inventory.stock.read' | 'procurement.po.write', scope: 'entity') => boolean,
  t: (key: 'ordersTab' | 'receiptsTab') => string,
): { orders?: string; receipts?: string } {
  return can('inventory.stock.read', 'entity') || can('procurement.po.write', 'entity')
    ? { orders: t('ordersTab'), receipts: t('receiptsTab') }
    : {};
}

/** The companies whose purchase orders the person reads, by id, from what the shell knows. */
export function orderCompanies(
  principal: Pick<Principal, 'entityIds'>,
  entities: readonly CompanyAccess[],
): Record<number, string> {
  return Object.fromEntries(
    entities
      .filter(
        (e) =>
          principal.entityIds.includes(e.entityId) &&
          (hasGrant(e.grants, 'inventory.stock.read', 'entity') ||
            hasGrant(e.grants, 'procurement.po.write', 'entity')),
      )
      .map((e) => [e.entityId, e.entityName]),
  );
}
