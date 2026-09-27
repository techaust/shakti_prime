import { afterAll, describe, expect, it } from 'vitest';
import { LEAD_SOURCE_SEED } from '../../seeds/lead-sources';
import { PIPELINE_SEED, STAGE_SEED } from '../../seeds/pipelines';
import { PRICE_TIER_SEED } from '../../seeds/price-tiers';
import { runSeeds } from '../../seeds/index';
import { roleId } from '../../seeds/roles';
import { asMigrator, closeDb } from '../../src/testing/index';

afterAll(closeDb);

const pipeline = PIPELINE_SEED[0]?.id ?? '';
const [first, second] = STAGE_SEED.filter((s) => s.pipelineId === pipeline);
const retailName = PRICE_TIER_SEED.find((t) => t.code === 'retail')?.name ?? '';
const walkInName = LEAD_SOURCE_SEED.find((s) => s.code === 'walk_in')?.name ?? '';

async function grantsOf(role: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) => m<{ key: string }[]>`
      select permission_key || ':' || scope as key from role_permissions where role_id = ${role} order by 1`,
  );
  return rows.map((r) => r.key);
}

describe('re-running the seed keeps what Executives changed (AUDIT M21)', () => {
  it('keeps edited names and stage order, restores untouched roles, and respects a customised one', async () => {
    if (first === undefined || second === undefined) throw new Error('the seed has stages');
    const gm = roleId('general_manager');
    const accounts = roleId('accounts');
    const before = { gm: await grantsOf(gm), accounts: await grantsOf(accounts) };
    try {
      await asMigrator(async (m) => {
        await m.begin(async (tx) => {
          // An Executive renames a stage and swaps two stages.
          await tx`update pipeline_stages set name = 'Called back' where id = ${first.id}`;
          await tx`update pipeline_stages set position = 1000 where id = ${first.id}`;
          await tx`update pipeline_stages set position = ${first.position} where id = ${second.id}`;
          await tx`update pipeline_stages set position = ${second.position} where id = ${first.id}`;
          await tx`update price_tiers set name = 'Shop price' where code = 'retail'`;
          await tx`update lead_sources set name = 'Walk-in at the shop' where code = 'walk_in'`;
          // The GM role is customised: a grant removed now must stay removed.
          await tx`update roles set customised_at = now() where id = ${gm}`;
          await tx`delete from role_permissions where role_id = ${gm} and permission_key = 'reports.export'`;
          // A permission added to the catalogue after the customisation reaches the role.
          await tx`update permissions set created_at = now() + interval '1 minute' where key = 'profile.write'`;
          await tx`delete from role_permissions where role_id = ${gm} and permission_key = 'profile.write'`;
          // An untouched role that lost a grant gets it back.
          await tx`delete from role_permissions where role_id = ${accounts} and permission_key = 'pricing.read'`;
        });
      });

      await runSeeds();

      const [stages] = await asMigrator(
        (m) => m<{ first_name: string; first_pos: number; second_pos: number }[]>`
          select (select name from pipeline_stages where id = ${first.id}) as first_name,
                 (select position from pipeline_stages where id = ${first.id}) as first_pos,
                 (select position from pipeline_stages where id = ${second.id}) as second_pos`,
      );
      expect(stages).toEqual({
        first_name: 'Called back',
        first_pos: second.position,
        second_pos: first.position,
      });
      const [names] = await asMigrator(
        (m) => m<{ tier: string; source: string }[]>`
          select (select name from price_tiers where code = 'retail') as tier,
                 (select name from lead_sources where code = 'walk_in') as source`,
      );
      expect(names).toEqual({ tier: 'Shop price', source: 'Walk-in at the shop' });

      const gmAfter = await grantsOf(gm);
      expect(gmAfter.some((g) => g.startsWith('reports.export:'))).toBe(false);
      expect(gmAfter).toContain('profile.write:own');
      expect(await grantsOf(accounts)).toEqual(before.accounts);
    } finally {
      await asMigrator(async (m) => {
        await m.begin(async (tx) => {
          await tx`update pipeline_stages set position = 1000 where id = ${first.id}`;
          await tx`update pipeline_stages set position = ${second.position} where id = ${second.id}`;
          await tx`update pipeline_stages set position = ${first.position}, name = ${first.name} where id = ${first.id}`;
          await tx`update price_tiers set name = ${retailName} where code = 'retail'`;
          await tx`update lead_sources set name = ${walkInName} where code = 'walk_in'`;
          await tx`update roles set customised_at = null where id = ${gm}`;
          await tx`update permissions set created_at = now() - interval '1 day' where key = 'profile.write'`;
        });
      });
      await runSeeds();
      expect(await grantsOf(gm)).toEqual(before.gm);
    }
  });
});
