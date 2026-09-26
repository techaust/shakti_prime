// Test helpers shared by the security suite and the domain command tests. Assertions run as
// `app_user` (the application role) so every check is under real RLS; only fixture setup uses
// the migrator connection.
import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { ALL_ENTITY_IDS } from '../../seeds/entities';
import { runSeeds } from '../../seeds/index';
import { grantsForRole } from '../../seeds/role-permissions';
import { roleId } from '../../seeds/roles';
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
export { PRICE_TIER_SEED, tierId } from '../../seeds/price-tiers';
export {
  catalogueFixture,
  CATALOGUE_FIXTURE_PREFIX,
  identityFixture,
  IDENTITY_FIXTURE_USER_ID,
} from './catalogue-fixture';
export type { CatalogueFixture } from './catalogue-fixture';

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

/** A staff user for identity tests: principal, `users` row and one role per entity. */
export interface TestUser {
  id: string;
  email: string;
  entityRoles: { entityId: number; roleKey: RoleKey; teamId?: string }[];
}

export async function createTestUser(
  entityRoles: TestUser['entityRoles'],
  options: { status?: string; twoFactorEnabled?: boolean; name?: string } = {},
): Promise<TestUser> {
  const id = newId();
  const email = `user-${id.slice(-12)}@shakti.test`;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into principals (id, kind, display_name) values (${id}, 'user', ${options.name ?? 'test user'})`;
      await tx`insert into users (id, name, email, status, two_factor_enabled)
        values (${id}, ${options.name ?? 'test user'}, ${email}, ${options.status ?? 'active'}, ${options.twoFactorEnabled ?? false})`;
      for (const r of entityRoles) {
        await tx`insert into user_entity_roles (id, user_id, entity_id, role_id, team_id)
          values (${newId()}, ${id}, ${r.entityId}, ${roleId(r.roleKey)}, ${r.teamId ?? null})`;
      }
    }),
  );
  return { id, email, entityRoles };
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

/**
 * Tables readable with a context (shared reference data), hidden without one. Price tables need
 * `pricing.read`, which every seller role and the sizing agent hold.
 */
export const SHARED_TABLES = [
  'principals',
  'roles',
  'permissions',
  'role_permissions',
  'pipelines',
  'pipeline_stages',
  'lead_sources',
  'items',
  'pump_curves',
  'kits',
  'kit_components',
  'price_tiers',
  'price_lists',
  'price_list_items',
  'price_change_log',
  'tax_rates',
  'composite_supply_rules',
  'users',
  'user_entity_roles',
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
  'item_costs',
  'document_sequences',
] as const;

/**
 * Tables owned by the auth module (docs/DATABASE.md §3): `auth_service` has full access, `app_user`
 * has column-level access to `sessions` and none to the rest. They sit outside the generic loops
 * and are asserted in identity-scope.test.ts.
 */
export const AUTH_TABLES = [
  'sessions',
  'auth_accounts',
  'auth_verifications',
  'user_two_factor',
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
