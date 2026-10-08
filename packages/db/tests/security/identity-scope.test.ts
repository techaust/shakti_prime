import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../../src/env';
import {
  asMigrator,
  asPrincipal,
  AUTH_TABLES,
  closeDb,
  createTestUser,
  ENTITY_TABLES,
  principalFor,
  withoutContext,
  type TestUser,
} from '../../src/testing/index';

afterAll(closeDb);

let user: TestUser;
let sessionId: string;

beforeAll(async () => {
  user = await createTestUser([
    { entityId: 1, roleKey: 'accounts' },
    { entityId: 2, roleKey: 'tele_caller_cc' },
  ]);
  sessionId = newId();
  await asMigrator(
    (m) => m`insert into sessions (id, user_id, token, expires_at)
      values (${sessionId}, ${user.id}, ${`tok-${sessionId}`}, now() + interval '1 hour')`,
  );
});

const deniedError = (e: unknown) =>
  e instanceof Error && e.cause instanceof Error && e.cause.message.includes('permission denied');

async function asAuthService<T>(fn: (s: postgres.Sql) => Promise<T>): Promise<T> {
  const auth = postgres(requireEnv('DATABASE_URL_AUTH'), { max: 1, prepare: false });
  try {
    return await fn(auth);
  } finally {
    await auth.end();
  }
}

describe('the auth module role (docs/05-database.md §3)', () => {
  it('cannot bypass RLS and every identity table forces it', async () => {
    const [role] = await withoutContext<{ rolsuper: boolean; rolbypassrls: boolean }>(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = 'auth_service'`,
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    for (const table of [...AUTH_TABLES, 'users', 'user_entity_roles']) {
      const [row] = await withoutContext<{ forced: boolean }>(sql`
        select c.relforcerowsecurity as forced from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = ${table}
      `);
      expect(row?.forced, table).toBe(true);
    }
  });

  it('reads and writes the identity tables and nothing else', async () => {
    await asAuthService(async (s) => {
      expect((await s`select count(*)::int as n from sessions where id = ${sessionId}`)[0]?.n).toBe(
        1,
      );
      expect((await s`select count(*)::int as n from users where id = ${user.id}`)[0]?.n).toBe(1);
      for (const table of ENTITY_TABLES) {
        await expect(s`select count(*) from ${s(table)}`).rejects.toThrow(/permission denied/);
      }
      await expect(s`select count(*) from roles`).rejects.toThrow(/permission denied/);
      await expect(s`delete from users where id = ${user.id}`).rejects.toThrow(/permission denied/);
    });
  });

  it('has request timeouts', async () => {
    await asAuthService(async (s) => {
      const [row] =
        await s`select current_setting('statement_timeout') as st, current_setting('lock_timeout') as lt`;
      expect(row).toEqual({ st: '30s', lt: '10s' });
    });
  });
});

describe('the application role and the identity tables', () => {
  it('never reads a session token, hash, secret or verification value', async () => {
    const exec = principalFor('executive');
    await expect(
      asPrincipal(exec, ({ tx }) => tx.execute(sql`select token from sessions limit 1`)),
    ).rejects.toSatisfy(deniedError);
    for (const table of ['auth_accounts', 'auth_verifications', 'user_two_factor']) {
      await expect(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`select count(*) from ${sql.identifier(table)}`),
        ),
      ).rejects.toSatisfy(deniedError);
      await expect(
        asPrincipal(exec, ({ tx }) => tx.execute(sql`delete from ${sql.identifier(table)}`)),
      ).rejects.toSatisfy(deniedError);
    }
    await expect(
      asPrincipal(exec, ({ tx }) => tx.execute(sql`delete from sessions where id = ${sessionId}`)),
    ).rejects.toSatisfy(deniedError);
    await expect(
      asPrincipal(exec, ({ tx }) => tx.execute(sql`delete from users where id = ${user.id}`)),
    ).rejects.toSatisfy(deniedError);
  });

  it('sessions: the user sees their own, an admin sees all, others see none; only admins revoke', async () => {
    const count = (principal: Parameters<typeof asPrincipal>[0]) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select count(*)::int as n from sessions where id = ${sessionId}`,
        )) as unknown as { n: number }[];
        return rows[0]?.n;
      });
    expect(await count(principalFor('tele_caller_cc', [1], { id: user.id }))).toBe(1);
    expect(await count(principalFor('executive'))).toBe(1);
    expect(await count(principalFor('general_manager', [1, 2]))).toBe(0);
    expect(await count(principalFor('tele_caller_cc', [1]))).toBe(0);

    const revoke = (principal: Parameters<typeof asPrincipal>[0]) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`update sessions set revoked_at = now(), revoked_reason = 'admin' where id = ${sessionId} and revoked_at is null returning id`,
        )) as unknown as { id: string }[];
        return rows.length;
      });
    expect(await revoke(principalFor('tele_caller_cc', [1], { id: user.id }))).toBe(0);
    expect(await revoke(principalFor('general_manager', [1, 2]))).toBe(0);
    expect(await revoke(principalFor('executive'))).toBe(1);
  });

  it('user roles: read in the companies of the request or as your own, written only with admin.users.write:all', async () => {
    const gm = principalFor('general_manager', [1]);
    const seen = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select entity_id from user_entity_roles where user_id = ${user.id} order by entity_id`,
        )) as unknown as { entity_id: number }[];
        return rows.map((r) => r.entity_id);
      });
    expect(await seen(gm)).toEqual([1]);
    expect(await seen(principalFor('general_manager', [1, 2]))).toEqual([1, 2]);
    expect(await seen(principalFor('executive', [3]))).toEqual([]);
    for (const agent of ['agent:concierge', 'agent:triage', 'agent:chief'] as const) {
      expect(await seen(principalFor(agent, [3, 4]))).toEqual([]);
    }
    // a person always reads their own roles, whichever company they act for
    expect(await seen(principalFor('accounts', [1], { id: user.id }))).toEqual([1, 2]);
    const [hidden] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from user_entity_roles`,
    );
    expect(hidden?.n).toBe(0);
    await expect(
      asPrincipal(gm, ({ tx }) =>
        tx.execute(sql`update users set name = 'renamed' where id = ${user.id}`),
      ),
    ).resolves.toEqual(expect.anything());
    const [after] = await asMigrator(
      (m) => m<{ name: string }[]>`select name from users where id = ${user.id}`,
    );
    expect(after?.name).toBe('test user');
    await expect(
      asPrincipal(gm, ({ tx }) =>
        tx.execute(
          sql`insert into user_entity_roles (id, user_id, entity_id, role_id)
              values (${newId()}, ${user.id}, 3, (select id from roles where key = 'accounts'))`,
        ),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        e.cause.message.includes('row-level security'),
    );
    const [noContext] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from users`,
    );
    expect(noContext?.n).toBe(0);
  });

  it('user roles: an administrator acting for some companies writes roles in those companies only (0049)', async () => {
    const rollback = new Error('rollback');
    /** Rows the statement touched as `principal`, always rolled back; -1 when RLS refused it. */
    const touched = async (principal: Principal, statement: ReturnType<typeof sql>) => {
      let n: number | undefined;
      try {
        await asPrincipal(principal, async ({ tx }) => {
          n = ((await tx.execute(statement)) as unknown as unknown[]).length;
          throw rollback;
        });
      } catch (e) {
        if (e === rollback && n !== undefined) return n;
        if (
          e instanceof Error &&
          e.cause instanceof Error &&
          e.cause.message.includes('row-level security')
        ) {
          return -1;
        }
        throw e;
      }
      throw new Error('the statement neither ran nor failed');
    };
    const give = (entityId: number) =>
      sql`insert into user_entity_roles (id, user_id, entity_id, role_id)
          values (${newId()}, ${user.id}, ${entityId}, (select id from roles where key = 'accounts'))
          returning id`;
    const change = sql`update user_entity_roles set role_id = (select id from roles where key = 'executive')
      where user_id = ${user.id} returning entity_id`;
    const remove = sql`delete from user_entity_roles where user_id = ${user.id} returning entity_id`;

    const exec1 = principalFor('executive', [1]);
    expect(await touched(exec1, give(3))).toBe(-1);
    expect(await touched(exec1, change)).toBe(1);
    expect(await touched(exec1, remove)).toBe(1);
    const exec2 = principalFor('executive', [2]);
    expect(await touched(exec2, remove)).toBe(1);
    // moving a company-1 row into company 3 leaves the request's companies: refused
    expect(
      await touched(
        exec1,
        sql`update user_entity_roles set entity_id = 3 where user_id = ${user.id} returning id`,
      ),
    ).toBe(-1);

    const execAll = principalFor('executive');
    expect(await touched(execAll, give(3))).toBe(1);
    expect(await touched(execAll, remove)).toBe(2);

    const [still] = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from user_entity_roles where user_id = ${user.id}`,
    );
    expect(still?.n).toBe(2);
  });

  it('the admin helpers answer only a user administrator (0049)', async () => {
    const notAdmin = (e: unknown) => {
      const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
      return cause instanceof Error && cause.message.includes('admin.users.write:all is required');
    };
    const outside = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select app.user_roles_outside_request(${user.id}::uuid) as ids`,
        )) as unknown as { ids: number[] }[];
        return rows[0]?.ids;
      });
    const executives = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select app.active_executive_count() as n`,
        )) as unknown as { n: number }[];
        return rows[0]?.n;
      });
    expect(await outside(principalFor('executive', [1]))).toEqual([2]);
    expect(await outside(principalFor('executive', [3]))).toEqual([1, 2]);
    expect(await outside(principalFor('executive'))).toEqual([]);
    // An active Executive of company 1 only; one acting for company 3 still counts them, and the
    // expected total is read past the policies, since the suites add Executives as they run.
    await createTestUser([{ entityId: 1, roleKey: 'executive' }]);
    const [truth] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(distinct u.id)::int as n
         from users u
         join user_entity_roles uer on uer.user_id = u.id
         join roles r on r.id = uer.role_id
        where u.status = 'active' and r.key = 'executive'`,
    );
    expect(truth?.n).toBeGreaterThan(0);
    expect(await executives(principalFor('executive', [3]))).toBe(truth?.n);
    for (const role of ['general_manager', 'accounts', 'agent:chief'] as const) {
      await expect(outside(principalFor(role, [1]))).rejects.toSatisfy(notAdmin);
      await expect(executives(principalFor(role, [1]))).rejects.toSatisfy(notAdmin);
    }
    await expect(withoutContext(sql`select app.active_executive_count()`)).rejects.toSatisfy(
      notAdmin,
    );
    const [priv] = await withoutContext<{ reporter: boolean; pub: boolean }>(sql`
      select has_function_privilege('readonly_reporter', 'app.user_roles_outside_request(uuid)', 'execute')
          or has_function_privilege('readonly_reporter', 'app.active_executive_count()', 'execute') as reporter,
             has_function_privilege('public', 'app.user_roles_outside_request(uuid)', 'execute')
          or has_function_privilege('public', 'app.active_executive_count()', 'execute') as pub
    `);
    expect(priv).toEqual({ reporter: false, pub: false });
  });

  it('staff email, phone and sign-in state: own row, or user administrators only (AUDIT M3)', async () => {
    const emails = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select id, email from users order by id`,
        )) as unknown as { id: string; email: string }[];
        return rows;
      });
    for (const agent of ['agent:concierge', 'agent:triage', 'agent:chief'] as const) {
      expect(await emails(principalFor(agent, [1, 2, 3, 4]))).toEqual([]);
    }
    expect(await emails(principalFor('general_manager', [1]))).toEqual([]);
    expect(await emails(principalFor('accounts', [1], { id: user.id }))).toEqual([
      { id: user.id, email: user.email },
    ]);
    expect((await emails(principalFor('executive', [1]))).map((r) => r.id)).toContain(user.id);
  });

  it('holds at most one authenticator per user (AUDIT L6)', async () => {
    const other = await createTestUser([{ entityId: 1, roleKey: 'accounts' }]);
    const insert = () =>
      asMigrator(
        (m) => m`insert into user_two_factor (id, user_id, secret, backup_codes)
          values (${newId()}, ${other.id}, 'enc', 'enc')`,
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({
      constraint_name: 'user_two_factor_user_unique',
    });
  });

  it('app.user_grants() is callable by the application role only and returns no secret', async () => {
    const [priv] = await withoutContext<{
      app: boolean;
      reporter: boolean;
      pub: boolean;
      auth: boolean;
    }>(sql`
      select has_function_privilege('app_user', 'app.user_grants(uuid)', 'execute') as app,
             has_function_privilege('readonly_reporter', 'app.user_grants(uuid)', 'execute') as reporter,
             has_function_privilege('public', 'app.user_grants(uuid)', 'execute') as pub,
             has_function_privilege('auth_service', 'app.user_grants(uuid)', 'execute') as auth
    `);
    expect(priv).toEqual({ app: true, reporter: false, pub: false, auth: false });
    const rows = await withoutContext(sql`select * from app.user_grants(${user.id}::uuid)`);
    expect(rows.length).toBeGreaterThan(2);
    expect(new Set(rows.map((r) => r.entity_id))).toEqual(new Set([1, 2]));
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'contrast',
      'email',
      'entity_id',
      'entity_name',
      'name',
      'permission_key',
      'role_key',
      'scope',
      'status',
      'team_id',
      'theme',
      'two_factor_enabled',
    ]);
  });

  it('app.user_grants() drops a role held in an archived entity', async () => {
    const archived = 99;
    await asMigrator(
      (m) => m`insert into entities (id, code, legal_name, brand_name, state_code, archived_at)
        values (${archived}, 'ZZ', 'fixture archived entity', 'Archived', '27', now())
        on conflict (id) do update set archived_at = now()`,
    );
    const user = await createTestUser([
      { entityId: 1, roleKey: 'accounts' },
      { entityId: archived, roleKey: 'accounts' },
    ]);
    const rows = await withoutContext(sql`select * from app.user_grants(${user.id}::uuid)`);
    expect(new Set(rows.map((r) => r.entity_id))).toEqual(new Set([1]));
    await asMigrator(async (m) => {
      await m`delete from user_entity_roles where entity_id = ${archived}`;
      await m`delete from entities where id = ${archived}`;
    });
  });
});
