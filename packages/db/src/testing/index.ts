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
export { PIPELINE_SEED, STAGE_SEED, stageId } from '../../seeds/pipelines';
export { LEAD_SOURCE_SEED } from '../../seeds/lead-sources';

/** Migrate and seed. Idempotent, so every suite's globalSetup can call it. */
export async function prepareDatabase(): Promise<void> {
  await runMigrations();
  await runSeeds();
}

/** Runs `fn` with a short-lived migrator connection (table owner, bypasses RLS) for fixtures. */
export async function asMigrator<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const migrator = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  try {
    return await fn(migrator);
  } finally {
    await migrator.end();
  }
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

/** A team row for team-scope tests, written with the migrator connection. */
export async function createTestTeam(entityId: number | null, name = 'team'): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`insert into teams (id, entity_id, name) values (${id}, ${entityId}, ${name})`,
  );
  return id;
}

/**
 * A principal that also exists as a `principals` row, for commands that stamp `created_by` and
 * `updated_by`. Users are created by the auth layer, which does not exist yet, so the row is
 * written with the migrator connection.
 */
export async function createTestPrincipal(
  roleKey: RoleKey,
  entityIds: readonly number[] = ALL_ENTITY_IDS,
  overrides: Partial<Principal> = {},
): Promise<Principal> {
  const principal = principalFor(roleKey, entityIds, overrides);
  await asMigrator(
    (m) => m`
      insert into principals (id, kind, display_name)
      values (${principal.id}, ${principal.kind}, ${`test ${roleKey}`})
      on conflict (id) do nothing
    `,
  );
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

/** Tables readable with any context (shared reference data). Hidden without a context. */
export const SHARED_TABLES = [
  'principals',
  'roles',
  'permissions',
  'role_permissions',
  'pipelines',
  'pipeline_stages',
  'lead_sources',
] as const;

/** Tables scoped by `app.entity_ids` (and, for CRM roots and children, by ownership). */
export const ENTITY_TABLES = [
  'entities',
  'teams',
  'contacts',
  'contact_phones',
  'accounts',
  'account_contacts',
  'customer_sites',
  'opportunities',
  'consents',
] as const;

/** Every table under RLS. A new business table is added here and to one of the lists above. */
export const RLS_TABLES = [...SHARED_TABLES, ...ENTITY_TABLES] as const;

export type RlsTable = (typeof RLS_TABLES)[number];

export function countRows(table: RlsTable): SQL {
  return sql`select count(*)::int as n from ${sql.identifier(table)}`;
}

/** Row count of `table` as seen by `principal`. */
export async function countAs(principal: Principal, table: RlsTable): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(countRows(table))) as unknown as { n: number }[];
    return rows[0]?.n ?? 0;
  });
}
