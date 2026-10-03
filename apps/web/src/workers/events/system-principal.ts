import { SYSTEM_MATRIX, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';

/**
 * The principal an event worker acts as (docs/SECURITY.md §3.3): the seeded `system:workers`
 * row, holding only the grants `SYSTEM_MATRIX` lists (the seed writes the same list), and scoped
 * to the one company the event belongs to, so a worker never acts across companies.
 */
export function systemWorkersPrincipal(entityId: number): Principal {
  return {
    id: SYSTEM_WORKERS_PRINCIPAL_ID,
    kind: 'system',
    roleKey: 'system:workers',
    entityIds: [entityId],
    permissions: [...SYSTEM_MATRIX['system:workers']],
  };
}
