import { newId, SYSTEM_WORKERS_PRINCIPAL_ID } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await closeDb();
});

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

interface JobRow {
  job: string;
  schedule: string;
  active: boolean;
  recorded_error: string | null;
  history_since: Date | null;
}

const JOBS = [
  'activities-partitions',
  'audit-logs-detach',
  'audit-logs-partitions',
  'idempotency-keys-purge',
  'outbox-events-purge',
];

/** A rollback that carries the answer out of a transaction the test must leave as it found it. */
class Undo<T> extends Error {
  constructor(readonly answer: T) {
    super('undo');
  }
}

describe('app.scheduled_jobs() (audit 2026-10, DATA-3)', () => {
  it('only the request roles may call it', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.scheduled_jobs()', 'execute') as app,
             has_function_privilege('app_reader', 'app.scheduled_jobs()', 'execute') as reader,
             has_function_privilege('auth_service', 'app.scheduled_jobs()', 'execute') as auth,
             has_function_privilege('outbox_publisher', 'app.scheduled_jobs()', 'execute') as outbox,
             has_function_privilege('readonly_reporter', 'app.scheduled_jobs()', 'execute') as reporter,
             has_function_privilege('public', 'app.scheduled_jobs()', 'execute') as pub
    `);
    expect(grants).toEqual({
      app: true,
      reader: true,
      auth: false,
      outbox: false,
      reporter: false,
      pub: false,
    });
  });

  it('refuses a caller with neither permission, and a call with no context', async () => {
    for (const role of ['general_manager', 'accounts', 'agent:triage'] as const) {
      expect(
        await failure(
          asPrincipal(principalFor(role), ({ tx }) =>
            tx.execute(sql`select * from app.scheduled_jobs()`),
          ),
        ),
        role,
      ).toMatch(/platform\.jobs\.check/);
    }
    expect(await failure(withoutContext(sql`select * from app.scheduled_jobs()`))).toMatch(
      /platform\.jobs\.check/,
    );
  });

  it('answers every scheduled job to Integration Health and to the hourly check', async () => {
    const executive = principalFor('executive');
    const workers = principalFor('system:workers', [], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
    for (const principal of [executive, workers]) {
      const rows = await asPrincipal(principal, async ({ tx }) => {
        const answer = await tx.execute(sql`select * from app.scheduled_jobs()`);
        return answer as unknown as JobRow[];
      });
      expect(rows.map((r) => r.job).filter((j) => JOBS.includes(j))).toEqual(JOBS);
      expect(rows.find((r) => r.job === 'outbox-events-purge')).toMatchObject({
        schedule: '45 2 * * *',
        active: true,
      });
    }
  });

  it('answers the error a job recorded itself, cut to 200 characters', async () => {
    // A job name is lower-case words joined by hyphens (`retention_runs_job_check`).
    const job = `test-job-${newId()
      .slice(-8)
      .replace(/[^a-f]/g, 'x')}`;
    // Scheduled, recorded and read in one transaction that is rolled back, so no job is left.
    const rows = await asMigrator(async (m) => {
      try {
        await m.begin(async (tx) => {
          await tx`select cron.schedule(${job}, '5 3 25 * *', 'select 1')`;
          await tx`insert into retention_runs (id, job, started_at, finished_at, error)
                   values (${newId()}, ${job}, now(), now(), ${'x'.repeat(400)})`;
          await tx`select set_config('app.permissions', 'admin.integrations.write:all', true)`;
          const answer = await tx<JobRow[]>`
            select job, schedule, active, recorded_error, history_since
              from app.scheduled_jobs() where job = ${job}`;
          throw new Undo(answer);
        });
      } catch (e) {
        if (e instanceof Undo) return e.answer as JobRow[];
        throw e;
      }
      return [];
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job, schedule: '5 3 25 * *', active: true });
    expect(rows[0]?.recorded_error).toHaveLength(200);
    const left = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from retention_runs where job = ${job}`,
    );
    expect(left).toEqual([{ n: 0 }]);
  });
});
