// Idempotent seed of org and reference data as the table owner (docs/DATABASE.md §9). Safe to re-run.
import { ROLE_KEYS } from '@shakti/contracts';
import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { requireEnv } from '../src/env';
import {
  entities,
  leadSources,
  permissions,
  pipelines,
  pipelineStages,
  priceTiers,
  principals,
  rolePermissions,
  roles,
} from '../src/schema/index';
import { ENTITY_SEED } from './entities';
import { LEAD_SOURCE_SEED } from './lead-sources';
import { PERMISSION_SEED } from './permissions';
import { PIPELINE_SEED, STAGE_SEED } from './pipelines';
import { PRICE_TIER_SEED } from './price-tiers';
import { AGENT_PRINCIPAL_SEED } from './principals';
import { grantsForRole } from './role-permissions';
import { ROLE_SEED, roleId } from './roles';

export async function runSeeds(): Promise<void> {
  const client = postgres(requireEnv('DATABASE_URL_MIGRATOR'), { max: 1, prepare: false });
  const db = drizzle(client);
  try {
    await db.transaction(async (tx) => {
      // Entity master data is edited in Admin (org.entity.update) after the first seed; a re-run
      // adds a missing entity and never overwrites one.
      await tx
        .insert(entities)
        .values(ENTITY_SEED.map((e) => ({ ...e })))
        .onConflictDoNothing({ target: entities.id });

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

      // The matrix is authoritative for the system roles: their rows are replaced as a set.
      // Roles created in Admin (admin.roles.write) keep their grants.
      const systemRoleIds = ROLE_KEYS.map((key) => roleId(key));
      const grants = ROLE_KEYS.flatMap((key) =>
        grantsForRole(key).map((g) => ({
          roleId: roleId(key),
          permissionKey: g.key,
          scope: g.scope,
        })),
      );
      await tx.delete(rolePermissions).where(inArray(rolePermissions.roleId, systemRoleIds));
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

      await tx
        .insert(pipelines)
        .values(PIPELINE_SEED.map((p) => ({ ...p })))
        .onConflictDoUpdate({
          target: pipelines.id,
          set: {
            key: sql`excluded.key`,
            name: sql`excluded.name`,
            nameHi: sql`excluded.name_hi`,
            segment: sql`excluded.segment`,
          },
        });

      await tx
        .insert(pipelineStages)
        .values(STAGE_SEED.map((s) => ({ ...s })))
        .onConflictDoUpdate({
          target: pipelineStages.id,
          set: {
            key: sql`excluded.key`,
            name: sql`excluded.name`,
            nameHi: sql`excluded.name_hi`,
            position: sql`excluded.position`,
            kind: sql`excluded.kind`,
          },
        });

      await tx
        .insert(leadSources)
        .values(LEAD_SOURCE_SEED.map((s) => ({ ...s })))
        .onConflictDoUpdate({
          target: leadSources.id,
          set: {
            code: sql`excluded.code`,
            channel: sql`excluded.channel`,
            name: sql`excluded.name`,
            nameHi: sql`excluded.name_hi`,
          },
        });

      await tx
        .insert(priceTiers)
        .values(PRICE_TIER_SEED.map((t) => ({ ...t })))
        .onConflictDoUpdate({
          target: priceTiers.id,
          set: {
            code: sql`excluded.code`,
            name: sql`excluded.name`,
            nameHi: sql`excluded.name_hi`,
          },
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
