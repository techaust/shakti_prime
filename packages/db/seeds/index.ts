// Seed of org and reference data as the table owner (docs/DATABASE.md §9). Safe to re-run after
// any Admin edit (AUDIT M21): it writes only code-owned columns (keys, codes, kinds, segments,
// channels, permission descriptions), adds missing rows, restores the grants of system roles no
// Executive has customised, and gives a customised role only the permissions created since.
import { ROLE_KEYS, type RoleKey } from '@shakti/contracts';
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { connectionOptions } from '../src/connection';
import { requireEnv } from '../src/env';
import {
  callDispositions,
  entities,
  leadSources,
  permissions,
  pipelines,
  priceTiers,
  principals,
  rolePermissions,
  roles,
} from '../src/schema/index';
import { DISPOSITION_SEED } from './dispositions';
import { ENTITY_SEED } from './entities';
import { LEAD_SOURCE_SEED } from './lead-sources';
import { PERMISSION_SEED } from './permissions';
import { PIPELINE_SEED, STAGE_SEED } from './pipelines';
import { PRICE_TIER_SEED } from './price-tiers';
import { AGENT_PRINCIPAL_SEED, SYSTEM_PRINCIPAL_SEED } from './principals';
import { grantsForRole } from './role-permissions';
import { ROLE_SEED, roleId } from './roles';

export async function runSeeds(): Promise<void> {
  const url = requireEnv('DATABASE_URL_MIGRATOR');
  const client = postgres(url, {
    ...connectionOptions(url, 'shakti-seed'),
    max: 1,
    prepare: false,
  });
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
          set: { key: sql`excluded.key`, isSystem: true },
        });

      // A system role nobody has customised gets the matrix as a set. A customised role keeps
      // what the Executive chose and gains only permissions that did not exist at the time.
      const customised = await tx
        .select({ id: roles.id, at: roles.customisedAt })
        .from(roles)
        .where(and(inArray(roles.id, ROLE_KEYS.map(roleId)), isNotNull(roles.customisedAt)));
      const customisedAt = new Map(customised.map((r) => [r.id, r.at]));
      const created = new Map(
        (
          await tx.select({ key: permissions.key, at: permissions.createdAt }).from(permissions)
        ).map((p) => [p.key, p.at]),
      );
      const pristine = ROLE_KEYS.filter((key) => !customisedAt.has(roleId(key)));
      const grantRows = (keys: readonly RoleKey[]) =>
        keys.flatMap((key) =>
          grantsForRole(key)
            .filter((g) => {
              const since = customisedAt.get(roleId(key));
              const at = created.get(g.key);
              return since === undefined || since === null || (at !== undefined && at > since);
            })
            .map((g) => ({ roleId: roleId(key), permissionKey: g.key, scope: g.scope })),
        );
      if (pristine.length > 0) {
        await tx
          .delete(rolePermissions)
          .where(inArray(rolePermissions.roleId, pristine.map(roleId)));
      }
      const grants = [
        ...grantRows(pristine),
        ...grantRows(ROLE_KEYS.filter((k) => !pristine.includes(k))),
      ];
      if (grants.length > 0) await tx.insert(rolePermissions).values(grants).onConflictDoNothing();

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
        .insert(principals)
        .values(
          SYSTEM_PRINCIPAL_SEED.map((p) => ({
            id: p.id,
            kind: 'system',
            displayName: p.displayName,
          })),
        )
        .onConflictDoUpdate({
          target: principals.id,
          set: { displayName: sql`excluded.display_name`, kind: 'system' },
        });

      // Names are edited in Admin; the seed owns keys, segments, kinds, codes and channels.
      await tx
        .insert(pipelines)
        .values(PIPELINE_SEED.map((p) => ({ ...p })))
        .onConflictDoUpdate({
          target: pipelines.id,
          set: { key: sql`excluded.key`, segment: sql`excluded.segment` },
        });

      // Stage order is edited in Admin too: an existing stage keeps its name and position, and a
      // stage new to a pipeline takes its seed position, or the end when that one is in use.
      for (const stage of STAGE_SEED) {
        await tx.execute(sql`
          insert into pipeline_stages (id, pipeline_id, key, name, position, kind)
          select ${stage.id}, ${stage.pipelineId}, ${stage.key}, ${stage.name},
                 case when exists (select 1 from pipeline_stages
                                    where pipeline_id = ${stage.pipelineId} and position = ${stage.position})
                      then (select coalesce(max(position), 0) + 1 from pipeline_stages
                             where pipeline_id = ${stage.pipelineId})
                      else ${stage.position} end,
                 ${stage.kind}
          on conflict (id) do update set key = excluded.key, kind = excluded.kind`);
      }

      // Call outcomes are the Executive's once set: the workshop default goes in only while the
      // group has none, live or archived.
      const [groupOutcome] = await tx
        .select({ id: callDispositions.id })
        .from(callDispositions)
        .where(and(isNull(callDispositions.entityId), isNull(callDispositions.segment)))
        .limit(1);
      if (!groupOutcome) await tx.insert(callDispositions).values(DISPOSITION_SEED);

      await tx
        .insert(leadSources)
        .values(LEAD_SOURCE_SEED.map((s) => ({ ...s })))
        .onConflictDoUpdate({
          target: leadSources.id,
          set: { code: sql`excluded.code`, channel: sql`excluded.channel` },
        });

      await tx
        .insert(priceTiers)
        .values(PRICE_TIER_SEED.map((t) => ({ ...t })))
        .onConflictDoUpdate({ target: priceTiers.id, set: { code: sql`excluded.code` } });
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
