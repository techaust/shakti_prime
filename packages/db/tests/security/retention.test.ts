import { newId } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { closeOutboxDb } from '../../src/outbox-client';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  PLATFORM_TABLES,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await closeOutboxDb();
  await closeDb();
});

/** Every event this file writes carries its own aggregate type, so other suites' rows never count. */
const TAG = `test_retention_${newId().slice(-8)}`;

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

interface Ages {
  created?: string;
  published?: string | null;
  deadLettered?: string | null;
  nextAttempt?: string | null;
}

/** An event written as the table owner, its moments given as intervals before now. */
async function event(ages: Ages): Promise<string> {
  const id = newId();
  await asMigrator(
    (m) => m`
      insert into outbox_events (id, entity_id, type, aggregate_type, aggregate_id, payload_json,
                                 created_at, published_at, dead_lettered_at, attempts,
                                 next_attempt_at)
      values (${id}, 1, 'admin.user.reactivated', ${TAG}, ${newId()}, '{"v": 1}'::jsonb,
              now() - ${ages.created ?? '0 seconds'}::interval,
              now() - ${ages.published ?? null}::interval,
              now() - ${ages.deadLettered ?? null}::interval,
              ${ages.deadLettered == null ? 0 : 10},
              now() + ${ages.nextAttempt ?? null}::interval)`,
  );
  return id;
}

async function exists(id: string): Promise<boolean> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`select count(*)::int as n from outbox_events where id = ${id}`,
  );
  return row?.n === 1;
}

/** Delivers what this file left pending, so no later readiness check waits on it. */
async function deliverOurs(): Promise<void> {
  await asMigrator(
    (m) => m`update outbox_events set published_at = now()
              where aggregate_type = ${TAG} and published_at is null and dead_lettered_at is null`,
  );
}

describe('outbox retention (docs/DATABASE.md §7)', () => {
  it('removes events published more than 30 days ago and nothing else, and logs the run', async () => {
    const old = await event({ created: '40 days', published: '31 days' });
    const recent = await event({ created: '40 days', published: '29 days' });
    // Never delivered: waiting out a backoff, so it is not due and readiness stays ok.
    const pending = await event({ created: '40 days', nextAttempt: '1 day' });
    const dead = await event({ created: '40 days', deadLettered: '39 days' });

    await asMigrator((m) => m`call app.purge_outbox_events()`);
    expect(await exists(old)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(pending)).toBe(true);
    expect(await exists(dead)).toBe(true);

    const [run] = await asMigrator(
      (m) => m<
        {
          rows_affected: number | null;
          error: string | null;
          finished: boolean;
          ordered: boolean;
        }[]
      >`
        select rows_affected, error, finished_at is not null as finished,
               finished_at >= started_at as ordered
          from retention_runs where job = 'outbox-events-purge'
         order by started_at desc limit 1`,
    );
    expect(run).toMatchObject({ error: null, finished: true, ordered: true });
    expect(run?.rows_affected).toBeGreaterThanOrEqual(1);
    await deliverOurs();
  });

  it('a failed run stays recorded with its error and is reported as failed (0059)', async () => {
    const old = await event({ created: '40 days', published: '31 days' });
    const [{ since } = { since: '' }] = await asMigrator(
      (m) => m<{ since: string }[]>`select clock_timestamp()::text as since`,
    );
    // Another transaction holds the event, so the purge cannot remove it in time.
    let message = '';
    await asMigrator((holder) =>
      holder.begin(async (tx) => {
        await tx`select id from outbox_events where id = ${old} for update`;
        message = await failure(
          asMigrator(async (m) => {
            await m`set lock_timeout = '300ms'`;
            await m`call app.purge_outbox_events()`;
          }),
        );
      }),
    );
    // The caller, pg_cron included, sees the run fail.
    expect(message).toMatch(/outbox-events-purge failed: .*lock timeout/);
    // The run is recorded, finished, with the error and no count, and nothing was removed.
    const runs = await asMigrator(
      (m) => m<{ rows_affected: number | null; error: string | null; finished: boolean }[]>`
        select rows_affected, error, finished_at is not null as finished
          from retention_runs
         where job = 'outbox-events-purge' and started_at >= ${since}::timestamptz`,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ rows_affected: null, finished: true });
    expect(runs[0]?.error).toMatch(/lock timeout/);
    expect(await exists(old)).toBe(true);
  });

  it('runs every night from pg_cron', async () => {
    const [job] = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'outbox-events-purge'`,
    );
    expect(job).toEqual({ schedule: '45 2 * * *', command: 'call app.purge_outbox_events()' });
  });

  it('pg_cron runs that command, which commits its own run record, to the end (0059)', async () => {
    // The job's own command on a schedule of seconds, under a name of this run, so the nightly
    // job is left as it is. A procedure that commits works only as a statement of its own, which
    // is how pg_cron sends it.
    const name = `outbox-events-purge-check-${newId().slice(-8)}`;
    const [{ id } = { id: 0 }] = await asMigrator(
      (m) => m<{ id: number }[]>`
        select cron.schedule(${name}, '1 seconds', 'call app.purge_outbox_events()')::int as id`,
    );
    try {
      let status: string | undefined;
      for (let i = 0; i < 40 && status === undefined; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const [done] = await asMigrator(
          (m) => m<{ status: string }[]>`
            select status from cron.job_run_details
             where jobid = ${id} and status in ('succeeded', 'failed')
             order by start_time limit 1`,
        );
        status = done?.status;
      }
      expect(status).toBe('succeeded');
    } finally {
      await asMigrator((m) => m`select cron.unschedule(${name})`);
    }
  }, 30_000);

  it('refuses any other delete, the owner included: without the job, or a row it must keep', async () => {
    const old = await event({ created: '40 days', published: '31 days' });
    const recent = await event({ created: '40 days', published: '29 days' });
    const pending = await event({ created: '40 days', nextAttempt: '1 day' });
    const dead = await event({ created: '40 days', deadLettered: '39 days' });
    const purging = (id: string) =>
      asMigrator((m) =>
        m.begin(async (tx) => {
          await tx`select set_config('app.outbox_retention', 'purge', true)`;
          await tx`delete from outbox_events where id = ${id}`;
        }),
      );

    expect(
      await failure(asMigrator((m) => m`delete from outbox_events where id = ${old}`)),
    ).toMatch(/append-only/);
    for (const id of [recent, pending, dead]) {
      expect(await failure(purging(id))).toMatch(/append-only/);
      expect(await exists(id)).toBe(true);
    }
    await deliverOurs();
  });

  it('no request role may delete an event or run the job, even with its setting on', async () => {
    const old = await event({ created: '40 days', published: '31 days' });
    const withSetting = (s: postgres.Sql) =>
      s.begin(async (tx) => {
        await tx`select set_config('app.outbox_retention', 'purge', true)`;
        await tx`delete from outbox_events where id = ${old}`;
      });
    expect(await failure(asOutboxPublisher(withSetting))).toMatch(/permission denied/);
    expect(
      await failure(
        asPrincipal(principalFor('executive'), async ({ tx }) => {
          await tx.execute(sql`select set_config('app.outbox_retention', 'purge', true)`);
          await tx.execute(sql`delete from outbox_events where id = ${old}`);
        }),
      ),
    ).toMatch(/permission denied/);
    expect(await exists(old)).toBe(true);

    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.purge_outbox_events()', 'execute') as app,
             has_function_privilege('outbox_publisher', 'app.purge_outbox_events()', 'execute') as outbox,
             has_function_privilege('auth_service', 'app.purge_outbox_events()', 'execute') as auth,
             has_function_privilege('readonly_reporter', 'app.purge_outbox_events()', 'execute') as reporter,
             has_function_privilege('public', 'app.purge_outbox_events()', 'execute') as pub
    `);
    expect(grants).toEqual({ app: false, outbox: false, auth: false, reporter: false, pub: false });
    expect(
      await failure(
        asPrincipal(principalFor('executive'), ({ tx }) =>
          tx.execute(sql`call app.purge_outbox_events()`),
        ),
      ),
    ).toMatch(/permission denied/);
  });
});

describe('the purge procedure as written (0060)', () => {
  it('pins no search path, so it names every comparison and type with its schema', async () => {
    const [row] = await withoutContext<{ body: string; config: string[] | null }>(sql`
      select p.prosrc as body, p.proconfig as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app' and p.proname = 'purge_outbox_events'`);
    expect(row?.config).toBeNull();
    const body = row?.body ?? '';
    // Every comparison in a condition is written operator(pg_catalog.…); what is left of `=` is
    // an assignment (`:=`, `set … =`, `get diagnostics … =`), never a comparison.
    const conditions = [
      ...body.matchAll(/\b(?:where|and|or|if)\b([^;]*?)(?=\b(?:and|or|then)\b|;)/gi),
    ];
    expect(conditions.length).toBeGreaterThan(0);
    for (const [, condition] of conditions) {
      expect(condition?.replaceAll(/operator\(pg_catalog\.[^)]+\)/g, '')).not.toMatch(/[<>=]/);
    }
    expect(body.match(/operator\(pg_catalog\.=\)/g)).toHaveLength(2);
    // Its variables' types and the interval name their schema too.
    for (const declared of [
      'v_run pg_catalog.uuid',
      'v_removed pg_catalog.int4',
      'v_error pg_catalog.text',
    ]) {
      expect(body).toContain(declared);
    }
    expect(body).toContain("'30 days'::pg_catalog.interval");
    expect(body).not.toMatch(/\binterval '/);
  });
});

describe('retention_runs (docs/DATABASE.md §7)', () => {
  it('is a platform table, forced under RLS and not owned by the application', async () => {
    expect(PLATFORM_TABLES).toContain('retention_runs');
    const [row] = await withoutContext<{ owner: string; forced: boolean }>(sql`
      select pg_get_userbyid(c.relowner) as owner, c.relforcerowsecurity as forced
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'retention_runs'`);
    expect(row?.owner).not.toBe('app_user');
    expect(row?.forced).toBe(true);
  });

  it('the application may only read it; no other role holds anything', async () => {
    const [row] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'retention_runs', 'SELECT') as s,
             has_any_column_privilege('app_user', 'retention_runs', 'INSERT') as i,
             has_any_column_privilege('app_user', 'retention_runs', 'UPDATE') as u,
             has_table_privilege('app_user', 'retention_runs', 'DELETE') as d,
             has_any_column_privilege('readonly_reporter', 'retention_runs', 'SELECT') as reporter,
             has_any_column_privilege('auth_service', 'retention_runs', 'SELECT') as auth,
             has_any_column_privilege('outbox_publisher', 'retention_runs', 'SELECT') as outbox
    `);
    expect(row).toEqual({
      s: true,
      i: false,
      u: false,
      d: false,
      reporter: false,
      auth: false,
      outbox: false,
    });
    const insert = sql`insert into retention_runs (id, job) values (${newId()}, 'outbox-events-purge')`;
    expect(
      await failure(asPrincipal(principalFor('executive'), ({ tx }) => tx.execute(insert))),
    ).toMatch(/permission denied/);
  });

  it('is read with audit.read at scope all only, and never without a context or a company', async () => {
    await asMigrator((m) => m`call app.purge_outbox_events()`);
    const count = (
      roleKey: 'executive' | 'general_manager' | 'accounts' | 'tele_caller_cc',
      ids = [1],
    ) =>
      asPrincipal(principalFor(roleKey, ids), async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select count(*)::int as n from retention_runs`,
        )) as unknown as { n: number }[];
        return rows[0]?.n ?? 0;
      });
    expect(await count('executive')).toBeGreaterThan(0);
    // audit.read at company scope reads the company's audit rows, never the group's jobs.
    expect(await count('general_manager')).toBe(0);
    expect(await count('accounts')).toBe(0);
    expect(await count('tele_caller_cc')).toBe(0);
    expect(await count('executive', [])).toBe(0);
    const [none] = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from retention_runs`,
    );
    expect(none?.n).toBe(0);
  });
});

describe('audit partition detach (docs/DATABASE.md §7, BLUEPRINT §7.9)', () => {
  /** Two months of the past no other run uses: one far past eight years, one well inside them. */
  const seed = Number.parseInt(newId().replace(/-/g, '').slice(-6), 16);
  const oldYear = 1971 + (seed % 40);
  const oldMonth = 1 + ((seed >> 8) % 12);
  const pad = (n: number) => String(n).padStart(2, '0');
  const oldName = `audit_logs_${String(oldYear)}_${pad(oldMonth)}`;
  const oldFrom = `${String(oldYear)}-${pad(oldMonth)}-01T00:00:00Z`;
  const conflictName = `audit_logs_${String(oldYear)}_${pad(oldMonth === 12 ? 11 : oldMonth + 1)}`;
  const conflictFrom = `${String(oldYear)}-${pad(oldMonth === 12 ? 11 : oldMonth + 1)}-01T00:00:00Z`;
  const REQUEST = `test-detach-${newId().slice(-8)}`;

  afterAll(async () => {
    await asMigrator(async (m) => {
      for (const name of [oldName, conflictName]) {
        await m.unsafe(`drop table if exists audit_archive.${name}`);
        await m.unsafe(`drop table if exists audit_partitions.${name}`);
      }
    });
  });

  async function partition(name: string, from: string): Promise<void> {
    await asMigrator((m) =>
      m.unsafe(
        `create table if not exists audit_partitions.${name} partition of public.audit_logs
           for values from ('${from}') to ('${from}'::timestamptz + interval '1 month')`,
      ),
    );
  }

  async function schemaOf(name: string): Promise<string | null> {
    const [row] = await asMigrator(
      (m) => m<{ schema: string }[]>`
        select n.nspname as schema from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relname = ${name} and n.nspname in ('audit_partitions', 'audit_archive')`,
    );
    return row?.schema ?? null;
  }

  async function attached(name: string): Promise<boolean> {
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from pg_inherits i join pg_class c on c.oid = i.inhrelid
         where i.inhparent = 'public.audit_logs'::regclass and c.relname = ${name}`,
    );
    return row?.n === 1;
  }

  async function lastRun() {
    const [run] = await asMigrator(
      (m) => m<{ rows_affected: number | null; error: string | null; finished: boolean }[]>`
        select rows_affected, error, finished_at is not null as finished
          from retention_runs where job = 'audit-logs-detach'
         order by started_at desc limit 1`,
    );
    return run;
  }

  it('detaches a partition whose month ended more than eight years ago into audit_archive', async () => {
    await partition(oldName, oldFrom);
    await asMigrator(
      (m) => m`insert into audit_logs (id, command, outcome, request_id, created_at)
               values (${newId()}, 'auth.sign_in', 'ok', ${REQUEST},
                       ${oldFrom}::timestamptz + interval '3 days')`,
    );
    // The current month's partition, which app.ensure_audit_partitions() keeps, stays attached.
    const [{ current } = { current: '' }] = await asMigrator(
      (m) => m<{ current: string }[]>`
        select 'audit_logs_' || to_char(now() at time zone 'UTC', 'YYYY_MM') as current`,
    );
    await asMigrator((m) => m`call app.detach_audit_partitions()`);

    expect(await schemaOf(oldName)).toBe('audit_archive');
    expect(await attached(oldName)).toBe(false);
    expect(await attached(current)).toBe(true);
    const [kept] = await asMigrator(
      (m) => m<{ archived: number; live: number }[]>`
        select (select count(*)::int from audit_archive.${m(oldName)} where request_id = ${REQUEST})
                 as archived,
               (select count(*)::int from audit_logs where request_id = ${REQUEST}) as live`,
    );
    expect(kept).toEqual({ archived: 1, live: 0 });
    const run = await lastRun();
    expect(run).toMatchObject({ error: null, finished: true });
    expect(run?.rows_affected).toBeGreaterThanOrEqual(1);
  });

  it('keeps a partition whose month ended less than eight years ago', async () => {
    const [{ name, from } = { name: '', from: '' }] = await asMigrator(
      (m) => m<{ name: string; from: string }[]>`
        select 'audit_logs_' || to_char(d, 'YYYY_MM') as name, to_char(d, 'YYYY-MM-DD') as from
          from (select date_trunc('month', now() at time zone 'UTC' - interval '7 years 10 months') as d) s`,
    );
    const existed = (await schemaOf(name)) !== null;
    if (!existed) await partition(name, from);
    try {
      await asMigrator((m) => m`call app.detach_audit_partitions()`);
      expect(await attached(name)).toBe(true);
    } finally {
      if (!existed) await asMigrator((m) => m.unsafe(`drop table audit_partitions.${name}`));
    }
  });

  it('a failed run detaches nothing, stays recorded with its error and is reported as failed', async () => {
    await partition(conflictName, conflictFrom);
    // A table of the same name already in the archive makes the move fail.
    await asMigrator((m) => m.unsafe(`create table audit_archive.${conflictName} (id int)`));
    const message = await failure(asMigrator((m) => m`call app.detach_audit_partitions()`));
    expect(message).toMatch(/audit-logs-detach failed: .*already exists/);
    expect(await attached(conflictName)).toBe(true);
    const run = await lastRun();
    expect(run).toMatchObject({ rows_affected: null, finished: true });
    expect(run?.error).toMatch(/already exists/);

    await asMigrator((m) => m.unsafe(`drop table audit_archive.${conflictName}`));
    await asMigrator((m) => m`call app.detach_audit_partitions()`);
    expect(await schemaOf(conflictName)).toBe('audit_archive');
  });

  it('runs monthly from pg_cron, and no request role may run it or read the archive', async () => {
    const [job] = await asMigrator(
      (m) => m<{ schedule: string; command: string }[]>`
        select schedule, command from cron.job where jobname = 'audit-logs-detach'`,
    );
    expect(job).toEqual({ schedule: '30 3 1 * *', command: 'call app.detach_audit_partitions()' });
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.detach_audit_partitions()', 'execute') as app,
             has_function_privilege('app_reader', 'app.detach_audit_partitions()', 'execute') as reader,
             has_function_privilege('readonly_reporter', 'app.detach_audit_partitions()', 'execute') as reporter,
             has_function_privilege('public', 'app.detach_audit_partitions()', 'execute') as pub,
             has_schema_privilege('app_user', 'audit_archive', 'usage') as app_archive,
             has_schema_privilege('app_reader', 'audit_archive', 'usage') as reader_archive,
             has_schema_privilege('readonly_reporter', 'audit_archive', 'usage') as reporter_archive,
             has_schema_privilege('auth_service', 'audit_archive', 'usage') as auth_archive,
             has_schema_privilege('outbox_publisher', 'audit_archive', 'usage') as outbox_archive
    `);
    expect(Object.values(grants ?? { missing: true }).every((v) => !v)).toBe(true);
  });
});
