// Actors for the state-machine unit tests.
import { newId, PERMISSION_KEYS, type Principal, type RoleKey } from '@shakti/contracts';
import type { Actor } from './define-machine';

/** A principal holding every permission at `all` scope: only guards can refuse it. */
export function everything(roleKey: RoleKey = 'executive'): Actor {
  const principal: Principal = {
    id: newId(),
    kind: 'user',
    roleKey,
    entityIds: [1],
    permissions: PERMISSION_KEYS.map((key) => ({ key, scope: 'all' as const })),
  };
  return { kind: 'principal', principal };
}

/** A principal with the given grants and nothing else. */
export function holding(
  permissions: Principal['permissions'],
  roleKey: RoleKey = 'general_manager',
): Actor {
  return {
    kind: 'principal',
    principal: { id: newId(), kind: 'user', roleKey, entityIds: [1], permissions },
  };
}

export const platform: Actor = { kind: 'system', job: 'unit-test' };
