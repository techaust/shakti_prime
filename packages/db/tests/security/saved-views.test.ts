import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPrincipal, closeDb, createTestPrincipal, withoutContext } from '../../src/testing/index';

afterAll(closeDb);

/** The database's own message, whether the driver error is thrown bare or wrapped by Drizzle. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

function insertView(id: string, principalId: string, name: string) {
  return sql`insert into saved_views (id, principal_id, screen, name, settings_json)
             values (${id}, ${principalId}, 'leads', ${name}, '{"density": "compact"}')`;
}

async function count(principal: Principal, id: string): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select count(*)::int as n from saved_views where id = ${id}`,
    )) as unknown as { n: number }[];
    return rows[0]?.n ?? -1;
  });
}

async function changed(principal: Principal, statement: ReturnType<typeof sql>): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(statement)) as unknown as unknown[];
    return rows.length;
  });
}

let owner: Principal;
let other: Principal;
let id: string;

beforeAll(async () => {
  owner = await createTestPrincipal('tele_caller_cc', [1]);
  other = await createTestPrincipal('executive');
  id = newId();
  await asPrincipal(owner, ({ tx }) => tx.execute(insertView(id, owner.id, `Hot leads ${id}`)));
});

describe('saved views belong to the person who saved them (docs/08-design-system.md §6)', () => {
  it('shows nothing and takes nothing without a request context', async () => {
    const [row] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from saved_views`,
    );
    expect(row?.n).toBe(0);
    expect(await failure(withoutContext(insertView(newId(), owner.id, 'Mine')))).toMatch(
      /row-level security/,
    );
  });

  it('shows a person their own views, whatever their company scope, and nobody else', async () => {
    expect(await count(owner, id)).toBe(1);
    expect(await count({ ...owner, entityIds: [] }, id)).toBe(1);
    expect(await count(other, id)).toBe(0);
  });

  it('refuses a view saved in another person’s name', async () => {
    expect(
      await failure(
        asPrincipal(other, ({ tx }) => tx.execute(insertView(newId(), owner.id, 'Not mine'))),
      ),
    ).toMatch(/row-level security/);
  });

  it('lets only the owner rename, change or remove a view, and never hand it to someone else', async () => {
    expect(
      await changed(
        other,
        sql`update saved_views set name = 'Taken' where id = ${id} returning id`,
      ),
    ).toBe(0);
    expect(await changed(other, sql`delete from saved_views where id = ${id} returning id`)).toBe(
      0,
    );
    expect(
      await changed(
        owner,
        sql`update saved_views set name = ${`Renamed ${id}`}, settings_json = '{}'
             where id = ${id} returning id`,
      ),
    ).toBe(1);
    expect(
      await failure(
        asPrincipal(owner, ({ tx }) =>
          tx.execute(sql`update saved_views set principal_id = ${other.id} where id = ${id}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(await changed(owner, sql`delete from saved_views where id = ${id} returning id`)).toBe(
      1,
    );
    expect(await count(owner, id)).toBe(0);
  });

  it('keeps one name per person and screen, a trimmed name of 1 to 60 characters, a known screen', async () => {
    const name = `Village ${newId()}`;
    await asPrincipal(owner, ({ tx }) => tx.execute(insertView(newId(), owner.id, name)));
    expect(
      await failure(
        asPrincipal(owner, ({ tx }) => tx.execute(insertView(newId(), owner.id, name))),
      ),
    ).toMatch(/saved_views_name_unique/);
    // Another person may use the same name.
    await asPrincipal(other, ({ tx }) => tx.execute(insertView(newId(), other.id, name)));
    for (const bad of ['', ' padded ', 'x'.repeat(61)]) {
      expect(
        await failure(
          asPrincipal(owner, ({ tx }) => tx.execute(insertView(newId(), owner.id, bad))),
        ),
      ).toMatch(/saved_views_name_check/);
    }
    expect(
      await failure(
        asPrincipal(owner, ({ tx }) =>
          tx.execute(sql`insert into saved_views (id, principal_id, screen, name, settings_json)
                         values (${newId()}, ${owner.id}, 'stock', 'Stock', '{}')`),
        ),
      ),
    ).toMatch(/saved_views_screen_check/);
  });

  it('grants the application its own rows, the name and settings to change, and the reporting role nothing', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'saved_views', 'SELECT') as s,
             has_table_privilege('app_user', 'saved_views', 'INSERT') as i,
             has_table_privilege('app_user', 'saved_views', 'DELETE') as d,
             has_column_privilege('app_user', 'saved_views', 'name', 'UPDATE') as name,
             has_column_privilege('app_user', 'saved_views', 'settings_json', 'UPDATE') as settings,
             has_column_privilege('app_user', 'saved_views', 'principal_id', 'UPDATE') as owner,
             has_column_privilege('app_user', 'saved_views', 'screen', 'UPDATE') as screen,
             has_any_column_privilege('readonly_reporter', 'saved_views', 'SELECT') as reporter,
             has_any_column_privilege('outbox_publisher', 'saved_views', 'SELECT') as publisher,
             has_any_column_privilege('auth_service', 'saved_views', 'SELECT') as auth
    `);
    expect(row).toEqual({
      s: true,
      i: true,
      d: true,
      name: true,
      settings: true,
      owner: false,
      screen: false,
      reporter: false,
      publisher: false,
      auth: false,
    });
  });
});
