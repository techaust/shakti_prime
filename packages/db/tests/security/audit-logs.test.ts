import { newId, type Principal } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireEnv } from '../../src/env';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '../../src/testing/index';

afterAll(closeDb);

/** Every row this file writes carries its own command name, so other suites' rows never count. */
const TAG = `test.audit.${newId().slice(-8)}`;

async function asAuthService<T>(fn: (s: postgres.Sql) => Promise<T>): Promise<T> {
  const auth = postgres(requireEnv('DATABASE_URL_AUTH'), { max: 1, prepare: false });
  try {
    return await fn(auth);
  } finally {
    await auth.end();
  }
}

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

let actor: Principal;

beforeAll(async () => {
  actor = await createTestPrincipal('executive');
  await asMigrator(
    (m) => m`
      insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, outcome)
      values
        (${newId()}, 1, ${actor.id}, 'user', ${TAG}, 'ok'),
        (${newId()}, 2, ${actor.id}, 'user', ${TAG}, 'denied'),
        (${newId()}, null, ${actor.id}, 'user', ${TAG}, 'failed')
    `,
  );
});

async function visibleAs(principal: Principal): Promise<(number | null)[]> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(
      sql`select entity_id from audit_logs where command = ${TAG} order by entity_id nulls last`,
    )) as unknown as { entity_id: number | null }[];
    return rows.map((r) => r.entity_id);
  });
}

function insertAs(
  principal: Principal,
  row: { actor?: string; entityId: number | null; command?: string },
) {
  return asPrincipal(principal, ({ tx }) =>
    tx.execute(sql`
      insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command, outcome)
      values (${newId()}, ${row.entityId}, ${row.actor ?? principal.id}, 'user', ${row.command ?? TAG}, 'ok')
    `),
  );
}

describe('reading the audit trail (docs/07-security.md §3.2 audit.read)', () => {
  it('an Executive over every company reads every row, including rows of no company', async () => {
    expect(await visibleAs(principalFor('executive'))).toEqual([1, 2, null]);
  });

  it('an Executive narrowed to one company reads that company and the rows of none', async () => {
    expect(await visibleAs(principalFor('executive', [1]))).toEqual([1, null]);
  });

  it('entity scope reads only its companies and never a row of no company', async () => {
    expect(await visibleAs(principalFor('general_manager', [1]))).toEqual([1]);
    expect(await visibleAs(principalFor('accounts', [2, 3]))).toEqual([2]);
  });

  it('a role without audit.read reads nothing', async () => {
    expect(await visibleAs(principalFor('tele_caller_cc'))).toEqual([]);
    expect(await visibleAs(principalFor('agent:sizing'))).toEqual([]);
  });

  it('an empty company scope reads nothing, even for an Executive', async () => {
    expect(await visibleAs(principalFor('executive', []))).toEqual([]);
  });
});

describe('writing the audit trail as the application', () => {
  it('takes a row for the caller in its own scope or for no company', async () => {
    const p = await createTestPrincipal('tele_caller_cc', [1]);
    await insertAs(p, { entityId: 1 });
    await insertAs(p, { entityId: null });
  });

  it('refuses a row for another actor, another company or a sign-in event', async () => {
    const p = await createTestPrincipal('tele_caller_cc', [1]);
    const rls = /row-level security/;
    expect(await failure(insertAs(p, { actor: actor.id, entityId: 1 }))).toMatch(rls);
    expect(await failure(insertAs(p, { entityId: 2 }))).toMatch(rls);
    expect(await failure(insertAs(p, { entityId: null, command: 'auth.sign_in' }))).toMatch(rls);
  });

  it('never updates or deletes a row', async () => {
    const exec = principalFor('executive');
    const denied = /permission denied/;
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`update audit_logs set outcome = 'ok' where command = ${TAG}`),
        ),
      ),
    ).toMatch(denied);
    expect(
      await failure(
        asPrincipal(exec, ({ tx }) =>
          tx.execute(sql`delete from audit_logs where command = ${TAG}`),
        ),
      ),
    ).toMatch(denied);
  });

  it('is append-only for the table owner too', async () => {
    expect(
      await failure(
        asMigrator((m) => m`update audit_logs set outcome = 'ok' where command = ${TAG}`),
      ),
    ).toMatch(/append-only/);
    expect(
      await failure(asMigrator((m) => m`delete from audit_logs where command = ${TAG}`)),
    ).toMatch(/append-only/);
  });

  it('requires an actor on every row except a sign-in event', async () => {
    expect(
      await failure(
        asMigrator(
          (m) => m`insert into audit_logs (id, command, outcome) values (${newId()}, ${TAG}, 'ok')`,
        ),
      ),
    ).toMatch(/audit_logs_actor_check/);
  });
});

describe('writing the audit trail as the auth module', () => {
  it('records a sign-in event of no company, with or without an actor', async () => {
    await asAuthService(
      (s) => s`insert into audit_logs (id, command, outcome, input_json)
        values (${newId()}, 'auth.sign_in', 'failed', ${s.json({ email: '****' })})`,
    );
    await asAuthService(
      (s) => s`insert into audit_logs (id, actor_principal_id, actor_kind, command, outcome)
        values (${newId()}, ${actor.id}, 'user', 'auth.sign_out', 'ok')`,
    );
  });

  it('cannot record a command, a company or read anything back', async () => {
    const rls = /row-level security/;
    expect(
      await failure(
        asAuthService(
          (s) => s`insert into audit_logs (id, actor_principal_id, actor_kind, command, outcome)
            values (${newId()}, ${actor.id}, 'user', ${TAG}, 'ok')`,
        ),
      ),
    ).toMatch(rls);
    expect(
      await failure(
        asAuthService(
          (s) => s`insert into audit_logs (id, entity_id, command, outcome)
            values (${newId()}, 1, 'auth.sign_in', 'ok')`,
        ),
      ),
    ).toMatch(rls);
    expect(await failure(asAuthService((s) => s`select id from audit_logs limit 1`))).toMatch(
      /permission denied/,
    );
  });
});

describe('monthly partitions (docs/03-roadmap-appendix/backend-weeks-3-5.md §3.1)', () => {
  it('no request role can use the partitions schema', async () => {
    const rows = await asMigrator(
      (m) => m<{ role: string; usable: boolean }[]>`
        select r as role, has_schema_privilege(r, 'audit_partitions', 'usage') as usable
          from unnest(array['app_user', 'auth_service', 'readonly_reporter']) as r
      `,
    );
    expect(rows.every((r) => !r.usable)).toBe(true);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(sql`select count(*) from audit_partitions.audit_logs_default`),
        ),
      ),
    ).toMatch(/permission denied for schema audit_partitions/);
  });

  it('has this month and the next three, a default, and routes a new row to its month', async () => {
    const parts = await asMigrator(
      (m) => m<{ name: string }[]>`
        select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
         where i.inhparent = 'public.audit_logs'::regclass
      `,
    );
    const names = parts.map((p) => p.name);
    expect(names).toContain('audit_logs_default');
    const now = new Date();
    for (let i = 0; i <= 3; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const name = `audit_logs_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      expect(names).toContain(name);
    }
    const [row] = await asMigrator(
      (m) => m<{ part: string }[]>`
        select tableoid::regclass::text as part from audit_logs where command = ${TAG} limit 1
      `,
    );
    expect(row?.part).toMatch(/^audit_partitions\.audit_logs_\d{4}_\d{2}$/);
  });

  it('making partitions is idempotent and only the migrator may do it', async () => {
    const [again] = await asMigrator(
      (m) => m<{ n: number }[]>`select app.ensure_audit_partitions(3) as n`,
    );
    expect(again?.n).toBe(0);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(sql`select app.ensure_audit_partitions(3)`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('keeps the partitions coming every month', async () => {
    const jobs = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'audit-logs-partitions'
      `,
    );
    expect(jobs).toEqual([
      { schedule: '0 3 25 * *', command: 'select app.ensure_audit_partitions(3)' },
    ]);
  });
});
