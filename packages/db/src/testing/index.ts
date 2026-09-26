// Test helpers shared by the security suite and the domain command tests. Assertions run as
// `app_user` (the application role) so every check is under real RLS; only fixture setup uses
// the migrator connection.
import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { ALL_ENTITY_IDS } from '../../seeds/entities';
import { runSeeds } from '../../seeds/index';
import { grantsForRole } from '../../seeds/role-permissions';
import { rawDb } from '../client';
import { withRequestContext, type RequestContext } from '../context';
import { requireEnv } from '../env';
import { runMigrations } from '../migrate';

export { closeDb } from '../client';
export { ALL_ENTITY_IDS } from '../../seeds/entities';
export { AGENT_PRINCIPAL_SEED } from '../../seeds/principals';
export { ROLE_SEED, roleId } from '../../seeds/roles';
export { AGENT_MATRIX, STAFF_MATRIX, grantsForRole } from '../../seeds/role-permissions';

/** Migrate and seed. Idempotent, so every suite's globalSetup can call it. */
export async function prepareDatabase(): Promise<void> {
  await runMigrations();
  await runSeeds();
}

/** A principal of the given role with the seeded grants, scoped to the given entities. */
export function principalFor(
  roleKey: RoleKey,
  entityIds: readonly number[] = ALL_ENTITY_IDS,
  overrides: Partial<Principal> = {},
): Principal {
  return {
    id: newId(),
    kind: roleKey.startsWith('agent:') ? 'agent' : 'user',
    roleKey,
    entityIds: [...entityIds],
    permissions: grantsForRole(roleKey),
    locale: 'en',
    ...overrides,
  };
}

/**
 * A principal that also exists as a `principals` row, for commands that stamp `updated_by`.
 * The row is written with the migrator connection because users are created by the auth layer,
 * which does not exist yet.
 */
export async function createTestPrincipal(
  roleKey: RoleKey,
  entityIds: readonly number[] = ALL_ENTITY_IDS,
): Promise<Principal> {
  const principal = principalFor(roleKey, entityIds);
  const migrator = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  try {
    await migrator`
      insert into principals (id, kind, display_name)
      values (${principal.id}, ${principal.kind}, ${`test ${roleKey}`})
    `;
  } finally {
    await migrator.end();
  }
  return principal;
}

/** Run inside a request context. */
export function asPrincipal<T>(
  principal: Principal,
  fn: (ctx: RequestContext) => Promise<T>,
): Promise<T> {
  return withRequestContext(principal, {}, fn);
}

/** Run a statement with no context at all: the path every policy must fail closed on. */
export async function withoutContext<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const result = await rawDb().execute(query);
  return result as unknown as T[];
}

/** Tables covered by the fail-closed test. Every new business table is added here. */
export const RLS_TABLES = [
  'entities',
  'principals',
  'roles',
  'permissions',
  'role_permissions',
] as const;

export function countRows(table: (typeof RLS_TABLES)[number]): SQL {
  return sql`select count(*)::int as n from ${sql.identifier(table)}`;
}
