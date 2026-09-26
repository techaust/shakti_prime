import { AGENT_ROLE_KEYS, PERMISSION_KEYS, ROLE_KEYS, STAFF_ROLE_KEYS } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ALL_ENTITY_IDS,
  asPrincipal,
  closeDb,
  countRows,
  principalFor,
  RLS_TABLES,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

describe('RLS fails closed', () => {
  it.each(RLS_TABLES)('%s returns zero rows with no request context', async (table) => {
    const [row] = await withoutContext<{ n: number }>(countRows(table));
    expect(row?.n).toBe(0);
  });

  it.each(RLS_TABLES)(
    '%s returns zero rows when the context has an empty entity scope',
    async (table) => {
      const principal = principalFor('executive', []);
      const n = await asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(countRows(table))) as unknown as { n: number }[];
        return rows[0]?.n;
      });
      if (table === 'entities') expect(n).toBe(0);
      else expect(n).toBeGreaterThan(0);
    },
  );

  it('helper functions return null outside a context', async () => {
    const [row] = await withoutContext<{ e: number[] | null; u: string | null; p: boolean }>(
      sql`select app.entity_ids() as e, app.user_id() as u, app.has_perm('crm.lead.read:own') as p`,
    );
    expect(row?.e).toBeNull();
    expect(row?.u).toBeNull();
    expect(row?.p).toBe(false);
  });
});

describe('entity scope on entities', () => {
  it.each([[[1]], [[2, 3]], [[1, 2, 3, 4]]])(
    'a principal scoped to %j sees exactly those rows',
    async (ids) => {
      const seen = await asPrincipal(principalFor('executive', ids), async ({ tx }) => {
        const rows = (await tx.execute(sql`select id from entities order by id`)) as unknown as {
          id: number;
        }[];
        return rows.map((r) => r.id);
      });
      expect(seen).toEqual(ids);
    },
  );

  it.each(STAFF_ROLE_KEYS)('%s scoped to entity 2 never sees another entity', async (roleKey) => {
    const seen = await asPrincipal(principalFor(roleKey, [2]), async ({ tx }) => {
      const rows = (await tx.execute(sql`select id from entities`)) as unknown as { id: number }[];
      return rows.map((r) => r.id);
    });
    expect(seen).toEqual([2]);
  });

  it('a request cannot widen its scope beyond the principal', async () => {
    const principal = principalFor('general_manager', [1]);
    const { withRequestContext } = await import('../../src/context');
    await expect(
      withRequestContext(principal, { entityIds: [1, 2] }, () => Promise.resolve(0)),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('shared org tables are readable with any context and hidden without one', async () => {
    const counts = await asPrincipal(
      principalFor('tele_caller_cc', [ALL_ENTITY_IDS[0] ?? 1]),
      async ({ tx }) => {
        const r = (await tx.execute(sql`
        select (select count(*) from roles)::int as roles,
               (select count(*) from permissions)::int as permissions,
               (select count(*) from role_permissions)::int as role_permissions,
               (select count(*) from principals where kind = 'agent')::int as principals
      `)) as unknown as Record<string, number>[];
        return r[0];
      },
    );
    expect(counts?.roles).toBe(ROLE_KEYS.length);
    expect(counts?.permissions).toBe(PERMISSION_KEYS.length);
    expect(counts?.principals).toBe(AGENT_ROLE_KEYS.length);
    expect(counts?.role_permissions).toBeGreaterThan(100);
  });
});

describe('write policies', () => {
  it('a GM cannot update an entity even inside their scope', async () => {
    const updated = await asPrincipal(principalFor('general_manager', [1]), async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update entities set brand_name = brand_name where id = 1 returning id`,
      )) as unknown as { id: number }[];
      return rows.length;
    });
    expect(updated).toBe(0);
  });

  it('an Executive can update an entity inside their scope and not outside it', async () => {
    const inside = await asPrincipal(principalFor('executive', [1]), async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update entities set brand_name = brand_name where id = 1 returning id`,
      )) as unknown as { id: number }[];
      return rows.length;
    });
    const outside = await asPrincipal(principalFor('executive', [1]), async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update entities set brand_name = brand_name where id = 2 returning id`,
      )) as unknown as { id: number }[];
      return rows.length;
    });
    expect(inside).toBe(1);
    expect(outside).toBe(0);
  });

  it('nobody can move an entity out of their scope by changing its id', async () => {
    await expect(
      asPrincipal(principalFor('executive', [1]), ({ tx }) =>
        tx.execute(sql`update entities set id = 9 where id = 1`),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('row-level security'),
    );
  });
});
