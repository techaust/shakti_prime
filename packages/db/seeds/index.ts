// Idempotent seed of org data as the table owner (docs/DATABASE.md §9). Safe to re-run.
import { ROLE_KEYS } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from '../src/env';
import { entities, permissions, principals, rolePermissions, roles } from '../src/schema/index';
import { ENTITY_SEED } from './entities';
import { PERMISSION_SEED } from './permissions';
import { AGENT_PRINCIPAL_SEED } from './principals';
import { grantsForRole } from './role-permissions';
import { ROLE_SEED, roleId } from './roles';

export async function runSeeds(): Promise<void> {
  const client = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  const db = drizzle(client);
  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(entities)
        .values(ENTITY_SEED.map((e) => ({ ...e })))
        .onConflictDoUpdate({
          target: entities.id,
          set: {
            code: sql`excluded.code`,
            legalName: sql`excluded.legal_name`,
            brandName: sql`excluded.brand_name`,
            stateCode: sql`excluded.state_code`,
          },
        });

      await tx
        .insert(permissions)
        .values(PERMISSION_SEED)
        .onConflictDoUpdate({
          target: permissions.key,
          set: { module: sql`excluded.module`, description: sql`excluded.description` },
        });

      await tx
        .insert(roles)
        .values(ROLE_SEED.map((r) => ({ ...r, isSystem: true })))
        .onConflictDoUpdate({
          target: roles.id,
          set: {
            key: sql`excluded.key`,
            name: sql`excluded.name`,
            nameHi: sql`excluded.name_hi`,
            isSystem: true,
          },
        });

      // The matrix is authoritative: rows not in it are removed for system roles.
      const grants = ROLE_KEYS.flatMap((key) =>
        grantsForRole(key).map((g) => ({
          roleId: roleId(key),
          permissionKey: g.key,
          scope: g.scope,
        })),
      );
      await tx.delete(rolePermissions);
      await tx.insert(rolePermissions).values(grants);

      await tx
        .insert(principals)
        .values(
          AGENT_PRINCIPAL_SEED.map((p) => ({
            id: p.id,
            kind: 'agent',
            displayName: p.displayName,
          })),
        )
        .onConflictDoUpdate({
          target: principals.id,
          set: { displayName: sql`excluded.display_name`, kind: 'agent' },
        });
    });
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await runSeeds();
  console.log('db: seeds applied');
}
