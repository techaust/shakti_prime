import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, asPrincipal, closeDb, principalFor, withoutContext } from '../../src/testing/index';

// F1 (docs/03-roadmap-appendix/phase4.md §6.4): feature flags are read by every request with a
// principal, the group's rows and those of the request's companies, and written only with
// admin.flags.write (scope all), for the group or a company of the request. CONFIG_TABLES covers
// the fail-closed read and the missing delete grant (crm-config.test.ts).

afterAll(closeDb);

const key = `test.flag_${newId().slice(-8).replaceAll('-', '')}`;
const ids = { group: newId(), one: newId(), two: newId() };

beforeAll(async () => {
  await asMigrator(
    (m) => m`insert into feature_flags (id, key, entity_id, enabled) values
      (${ids.group}, ${key}, null, false),
      (${ids.one}, ${key}, 1, true),
      (${ids.two}, ${key}, 2, false)`,
  );
});

const rollback = new Error('rollback');

async function rowsAs(principal: Principal, statement: SQL): Promise<string[] | Error> {
  let rows: string[] | undefined;
  try {
    await asPrincipal(principal, async ({ tx }) => {
      rows = ((await tx.execute(statement)) as unknown as { id: string }[]).map((r) => r.id);
      throw rollback;
    });
  } catch (e) {
    if (e === rollback && rows !== undefined) return rows.sort();
    return e instanceof Error ? e : new Error(String(e));
  }
  return new Error('no rows');
}

const read = sql`select id from feature_flags where key = ${key}`;

describe('feature flags', () => {
  it('fail closed with no request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from feature_flags where key = ${key}`,
    );
    expect(row?.n).toBe(0);
  });

  it("are read by any caller: the group's row and their own companies' rows", async () => {
    expect(await rowsAs(principalFor('field_engineer', [1]), read)).toEqual(
      [ids.group, ids.one].sort(),
    );
    expect(await rowsAs(principalFor('tele_caller_cc', [3]), read)).toEqual([ids.group]);
    expect(await rowsAs(principalFor('agent:concierge', [2]), read)).toEqual(
      [ids.group, ids.two].sort(),
    );
  });

  it('are written only with admin.flags.write, for the group or a company of the request', async () => {
    const insert = (entityId: number | null) => sql`
      insert into feature_flags (id, key, entity_id, enabled)
      values (${newId()}, ${`${key}.other`}, ${entityId}, true) returning id`;
    const update = (id: string) =>
      sql`update feature_flags set enabled = true where id = ${id} returning id`;
    expect(await rowsAs(principalFor('general_manager', [1]), insert(1))).toBeInstanceOf(Error);
    expect(await rowsAs(principalFor('general_manager', [1]), update(ids.one))).toEqual([]);
    expect(await rowsAs(principalFor('executive', [1]), insert(2))).toBeInstanceOf(Error);
    expect(await rowsAs(principalFor('executive', [1]), update(ids.two))).toEqual([]);
    expect(await rowsAs(principalFor('executive', [1]), insert(1))).toHaveLength(1);
    expect(await rowsAs(principalFor('executive', [1]), insert(null))).toHaveLength(1);
    expect(await rowsAs(principalFor('executive', [1]), update(ids.group))).toEqual([ids.group]);
  });

  it('keep one row per key and company, the group counting as one', async () => {
    await expect(
      asMigrator(
        (m) => m`insert into feature_flags (id, key, entity_id, enabled)
                 values (${newId()}, ${key}, null, true)`,
      ),
    ).rejects.toThrow(/feature_flags_key_entity_unique/);
  });
});
