import {
  AGENT_ROLE_KEYS,
  STAFF_ROLE_KEYS,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// The import purge (audit SEC-1, migration audit_privacy_rls): only the worker principal, through
// the platform-only imports.process, reaches the two definers. One clears what the rows of an
// import said once the reconciliation period has passed since the job ended or was left, keeping
// each row's state, what it made and why it was refused; the other records the import files whose
// bytes the worker deleted, and only those of a job that ended or uploaded long enough ago. Each
// call that changed something is a row of retention_runs.
//
// Every row here has an id starting with the prefix below, and the jobs to purge a last change in
// 2001, so they are the oldest of company 1 and come first.

afterAll(closeDb);

const P = '01990000-0000-7000-8000-0000000b8';
const id = (n: number): string => `${P}${n.toString(16).padStart(3, '0')}`;
const ACTOR = id(0xfff);
const DAYS = 30;
const OPEN_DAYS = 7;
const MARK = `zqpg${Math.random().toString(36).slice(2, 10)}`;

/** The fixture's jobs, by what each is, with its company, state and when it last changed. */
const JOBS = {
  committedOld: { n: 0x10, entity: 1, state: 'committed', changed: '2001-01-01' },
  failedOld: { n: 0x20, entity: 1, state: 'failed', changed: '2001-01-02' },
  rolledBackOld: { n: 0x30, entity: 1, state: 'rolled_back', changed: '2001-01-03' },
  leftOld: { n: 0x40, entity: 1, state: 'previewed', changed: '2001-01-04' },
  committingOld: { n: 0x50, entity: 1, state: 'committing', changed: '2001-01-05' },
  committedRecent: { n: 0x60, entity: 1, state: 'committed', changed: 'now' },
  leftRecent: { n: 0x70, entity: 1, state: 'mapped', changed: 'now' },
  otherCompany: { n: 0x80, entity: 2, state: 'committed', changed: '2001-01-01' },
} as const;
type JobKind = keyof typeof JOBS;
const jobId = (kind: JobKind) => id(JOBS[kind].n);
const fileId = (kind: JobKind) => id(JOBS[kind].n + 1);
/** An import file of company 1 uploaded long ago that never became a job, and one of today. */
const LONE_OLD_FILE = id(0x90);
const LONE_NEW_FILE = id(0x91);
/** A file of another purpose, uploaded long ago. */
const LOGO_FILE = id(0x92);

const workers = (entityIds: number[] = [1]): Principal =>
  principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

function rows<T>(principal: Principal, statement: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(statement)) as unknown as T[]);
}

/** The database's message for a refused statement (drizzle wraps it as the cause). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

/** Clears the rows of the fixture's company 1, as the worker does. */
async function purge(days = DAYS): Promise<{ jobs: string[]; rows: number }> {
  const [answer] = await rows<{ result: { jobs: string[]; rows: number } }>(
    workers(),
    sql`select app.purge_import_rows(1::smallint, ${days}::integer, 100) as result`,
  );
  return answer?.result ?? { jobs: [], rows: 0 };
}

interface RowFacts {
  job_id: string;
  row_no: number;
  raw_json: unknown;
  normalised_json: unknown;
  errors_json: unknown;
  dedupe_json: unknown;
  state: string;
  created_type: string | null;
  created_id: string | null;
}

function rowsOf(kind: JobKind): Promise<RowFacts[]> {
  return asMigrator(
    (m) => m<RowFacts[]>`
      select job_id, row_no, raw_json, normalised_json, errors_json, dedupe_json, state,
             created_type, created_id
        from import_rows where job_id = ${jobId(kind)} order by row_no`,
  );
}

async function purgedAt(kind: JobKind): Promise<Date | null> {
  const [row] = await asMigrator(
    (m) => m<{ purged_at: Date | null }[]>`
      select purged_at from import_jobs where id = ${jobId(kind)}`,
  );
  return row?.purged_at ?? null;
}

async function deletedAt(file: string): Promise<Date | null> {
  const [row] = await asMigrator(
    (m) => m<{ deleted_at: Date | null }[]>`select deleted_at from files where id = ${file}`,
  );
  return row?.deleted_at ?? null;
}

beforeAll(async () => {
  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      const like = `${P}%`;
      await tx`delete from import_rows where job_id::text like ${like}`;
      await tx`delete from import_jobs where id::text like ${like}`;
      await tx`delete from files where id::text like ${like}`;
      await tx`insert into principals (id, kind, display_name)
               values (${ACTOR}, 'user', 'import purge fixture') on conflict (id) do nothing`;
      for (const [kind, job] of Object.entries(JOBS) as [JobKind, (typeof JOBS)[JobKind]][]) {
        const changed = job.changed === 'now' ? new Date() : new Date(job.changed);
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                    sha256, status, created_by, created_at, updated_at)
                 values (${fileId(kind)}, ${job.entity}, 'import', 'memory',
                         ${`${String(job.entity)}/import/${fileId(kind)}.csv`}, 'leads.csv',
                         'text/csv', 100, ${'b8'.repeat(32)}, 'ready', ${ACTOR}, ${changed},
                         ${changed})`;
        await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                                          total_rows, valid_rows, invalid_rows, committed_rows,
                                          created_by, created_at, updated_at)
                 values (${jobId(kind)}, ${job.entity}, 'leads', ${fileId(kind)}, 'csv',
                         '["Name","Mobile"]', ${job.state}, 2, 1, 1,
                         ${job.state === 'committed' ? 1 : 0}, ${ACTOR}, ${changed}, ${changed})`;
        // One row that made a lead, and one refused, each holding what the file said.
        await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, normalised_json,
                                          errors_json, dedupe_json, state, created_type, created_id,
                                          committed_batch, created_by)
                 values (${jobId(kind)}, ${job.entity}, 1,
                         ${tx.json({ Name: `${MARK} one`, Mobile: '9700020000' })}::jsonb,
                         ${tx.json({ contact: { name: `${MARK} one` } })}::jsonb, '[]'::jsonb,
                         ${tx.json({ inFileRowNo: null, existing: [] })}::jsonb,
                         ${job.state === 'committed' ? 'committed' : 'valid'},
                         ${job.state === 'committed' ? 'opportunity' : null},
                         ${job.state === 'committed' ? id(JOBS[kind].n + 2) : null},
                         ${job.state === 'committed' ? 1 : null}, ${ACTOR}),
                        (${jobId(kind)}, ${job.entity}, 2,
                         ${tx.json({ Name: `${MARK} two`, Mobile: '12' })}::jsonb, null,
                         ${tx.json([{ field: 'phone', code: 'phone_invalid' }])}::jsonb, null,
                         'invalid', null, null, null, ${ACTOR})`;
      }
      for (const [file, purpose, at] of [
        [LONE_OLD_FILE, 'import', '2001-01-01'],
        [LONE_NEW_FILE, 'import', new Date().toISOString()],
        [LOGO_FILE, 'entity_logo', '2001-01-01'],
      ] as const) {
        await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size,
                                    sha256, status, created_by, created_at, updated_at)
                 values (${file}, 1, ${purpose}, 'memory', ${`1/${purpose}/${file}.csv`}, 'f.csv',
                         'text/csv', 100, ${'b9'.repeat(32)}, 'ready', ${ACTOR}, ${at}, ${at})`;
      }
    });
  });
});

describe('who may reach the import purge', () => {
  const statements = [
    sql`select app.purge_import_rows(1::smallint, ${DAYS}::integer, 10)`,
    sql`select app.record_import_files_deleted(1::smallint, ${OPEN_DAYS}::integer, array[]::uuid[])`,
    sql`select app.import_job_to_check(1::smallint, ${jobId('leftRecent')}::uuid, 10)`,
    sql`select app.record_import_identity_check(1::smallint, ${jobId('leftRecent')}::uuid,
                                                '[]'::jsonb, '{}'::text[], 0, 0, false, null, null,
                                                '[]'::jsonb)`,
    sql`select app.record_import_purge_failure(1::smallint, 'import-rows-purge', '57014')`,
  ];

  it('refuses every person’s role, every agent and the workers without imports.process', async () => {
    const refused: Principal[] = [
      ...STAFF_ROLE_KEYS.map((role) => principalFor(role, [1])),
      ...AGENT_ROLE_KEYS.map((role) => principalFor(role, [1])),
      principalFor('system:workers', [1], {
        id: SYSTEM_WORKERS_PRINCIPAL_ID,
        permissions: [{ key: 'files.process', scope: 'all' }],
      }),
    ];
    for (const principal of refused) {
      for (const statement of statements) {
        expect({
          role: principal.roleKey,
          message: await failure(rows(principal, statement)),
        }).toEqual({
          role: principal.roleKey,
          message: expect.stringMatching(/imports.process is required/) as string,
        });
      }
    }
  });

  it('fails closed with no request context', async () => {
    for (const statement of statements) {
      expect(await failure(withoutContext(statement))).toMatch(/imports.process is required/);
    }
  });

  it('refuses a company outside the request and a period out of range', async () => {
    for (const statement of [
      sql`select app.purge_import_rows(2::smallint, ${DAYS}::integer, 10)`,
      sql`select app.record_import_files_deleted(2::smallint, ${OPEN_DAYS}::integer, array[]::uuid[])`,
      sql`select app.import_job_to_check(2::smallint, ${jobId('otherCompany')}::uuid, 10)`,
      sql`select app.record_import_identity_check(2::smallint, ${jobId('otherCompany')}::uuid,
                                                  '[]'::jsonb, '{}'::text[], 0, 0, false, null, null,
                                                  '[]'::jsonb)`,
      sql`select app.record_import_purge_failure(2::smallint, 'import-rows-purge', '57014')`,
    ]) {
      expect(await failure(rows(workers([1]), statement))).toMatch(/outside the request/);
    }
    expect(
      await failure(rows(workers(), sql`select app.purge_import_rows(1::smallint, 6, 10)`)),
    ).toMatch(/between 7 and 365 days/);
    expect(
      await failure(rows(workers(), sql`select app.purge_import_rows(1::smallint, 30, 101)`)),
    ).toMatch(/between 1 and 100 jobs/);
    expect(
      await failure(
        rows(
          workers(),
          sql`select app.record_import_files_deleted(1::smallint, 0, array[]::uuid[])`,
        ),
      ),
    ).toMatch(/between 1 and 90 days/);
  });

  it('keeps imports.process to the worker principal and away from the reader pool', async () => {
    const held = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from role_permissions rp
          join roles r on r.id = rp.role_id
         where rp.permission_key = 'imports.process' and r.key not like 'system:%'`,
    );
    expect(held[0]?.n).toBe(0);
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('imports.process');
    const grants = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_reader',
               'app.purge_import_rows(smallint, integer, integer)', 'EXECUTE') as rows,
             has_function_privilege('app_reader',
               'app.record_import_files_deleted(smallint, integer, uuid[])', 'EXECUTE') as files,
             has_function_privilege('app_reader',
               'app.import_job_to_check(smallint, uuid, integer)', 'EXECUTE') as read,
             has_function_privilege('app_reader',
               'app.record_import_identity_check(smallint, uuid, jsonb, text[], integer, integer, boolean, text, jsonb, jsonb)',
               'EXECUTE') as write,
             has_function_privilege('app_reader',
               'app.record_import_purge_failure(smallint, text, text)', 'EXECUTE') as failure`);
    expect(grants[0]).toEqual({
      rows: false,
      files: false,
      read: false,
      write: false,
      failure: false,
    });
  });

  it('lets no request clear what a row said, mark a job purged or a file deleted itself', async () => {
    // A General Manager, who may import and change the rows' working columns.
    const gm = principalFor('general_manager', [1]);
    for (const statement of [
      sql`update import_rows set raw_json = '{}'::jsonb where job_id = ${jobId('leftRecent')}`,
      sql`update import_jobs set purged_at = now() where id = ${jobId('leftRecent')}`,
      sql`update import_jobs set left_out_columns = '{}' where id = ${jobId('leftRecent')}`,
      sql`update files set deleted_at = now() where id = ${fileId('leftRecent')}`,
    ]) {
      expect(await failure(rows(gm, statement))).toMatch(/permission denied/);
    }
  });
});

describe('what the purge clears', () => {
  let before: Record<JobKind, RowFacts[]>;
  let answer: { jobs: string[]; rows: number };
  let runsBefore: number;

  beforeAll(async () => {
    before = Object.fromEntries(
      await Promise.all(
        (Object.keys(JOBS) as JobKind[]).map(async (kind) => [kind, await rowsOf(kind)] as const),
      ),
    ) as Record<JobKind, RowFacts[]>;
    const [runs] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from retention_runs where job = 'import-rows-purge'`,
    );
    runsBefore = runs?.n ?? 0;
    answer = await purge();
  });

  it('clears the rows of jobs that ended or were left before the period, oldest first', () => {
    const ours = answer.jobs.filter((job) => job.startsWith(P));
    expect(ours).toEqual([
      jobId('committedOld'),
      jobId('failedOld'),
      jobId('rolledBackOld'),
      jobId('leftOld'),
    ]);
    expect(answer.rows).toBeGreaterThanOrEqual(8);
  });

  it('removes what the file said and keeps each row’s state, what it made and why it was refused', async () => {
    for (const kind of ['committedOld', 'failedOld', 'rolledBackOld', 'leftOld'] as const) {
      const after = await rowsOf(kind);
      expect(after).toEqual(
        before[kind].map((row) => ({ ...row, raw_json: {}, normalised_json: null })),
      );
      expect(await purgedAt(kind)).not.toBeNull();
    }
  });

  it('leaves a job adding rows, a job within the period and another company’s as they were', async () => {
    for (const kind of [
      'committingOld',
      'committedRecent',
      'leftRecent',
      'otherCompany',
    ] as const) {
      expect(await rowsOf(kind)).toEqual(before[kind]);
      expect(await purgedAt(kind)).toBeNull();
    }
  });

  it('records the call in retention_runs by its counts alone', async () => {
    const runs = await asMigrator(
      (m) => m<{ rows_affected: number; error: string | null; finished_at: Date | null }[]>`
        select rows_affected, error, finished_at from retention_runs
         where job = 'import-rows-purge' order by started_at desc`,
    );
    expect(runs.length).toBe(runsBefore + 1);
    expect(runs[0]).toMatchObject({ rows_affected: answer.rows, error: null });
    expect(runs[0]?.finished_at).not.toBeNull();
  });

  it('finds the marker nowhere in the purged jobs, and does nothing the second time', async () => {
    const [left] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from import_rows
         where job_id = any (${[jobId('committedOld'), jobId('failedOld'), jobId('rolledBackOld'), jobId('leftOld')]}::uuid[])
           and (raw_json::text like ${`%${MARK}%`} or coalesce(normalised_json::text, '') like ${`%${MARK}%`})`,
    );
    expect(left?.n).toBe(0);
    const again = await purge();
    expect(again.jobs.filter((job) => job.startsWith(P))).toEqual([]);
  });
});

describe('which import files are recorded deleted', () => {
  it('marks a file whose job ended or that is old, and passes over every other id', async () => {
    const named = [
      fileId('committedRecent'),
      fileId('leftOld'),
      LONE_OLD_FILE,
      fileId('leftRecent'),
      LONE_NEW_FILE,
      LOGO_FILE,
      fileId('otherCompany'),
    ];
    const [answer] = await rows<{ done: string[] }>(
      workers(),
      sql`select app.record_import_files_deleted(1::smallint, ${OPEN_DAYS}::integer,
                                                 ${`{${named.join(',')}}`}::uuid[]) as done`,
    );
    expect([...(answer?.done ?? [])].sort()).toEqual(
      [fileId('committedRecent'), fileId('leftOld'), LONE_OLD_FILE].sort(),
    );
    for (const file of [fileId('leftRecent'), LONE_NEW_FILE, LOGO_FILE, fileId('otherCompany')]) {
      expect(await deletedAt(file)).toBeNull();
    }
    const [run] = await asMigrator(
      (m) => m<{ rows_affected: number }[]>`
        select rows_affected from retention_runs
         where job = 'import-files-purge' order by started_at desc limit 1`,
    );
    expect(run?.rows_affected).toBe(3);
  });

  it('records a file once', async () => {
    const [answer] = await rows<{ done: string[] }>(
      workers(),
      sql`select app.record_import_files_deleted(1::smallint, ${OPEN_DAYS}::integer,
                                                 ${`{${LONE_OLD_FILE}}`}::uuid[]) as done`,
    );
    expect(answer?.done).toEqual([]);
  });
});

describe('the identity pass over imports made before the rule', () => {
  const record = (
    columns: unknown,
    leftOut: string,
    rowsJson: unknown,
    options: { through?: number; done?: boolean; fileName?: string | null } = {},
  ) =>
    rows<{ n: number }>(
      workers(),
      sql`select app.record_import_identity_check(1::smallint, ${jobId('leftRecent')}::uuid,
                                                  ${JSON.stringify(columns)}::jsonb,
                                                  ${leftOut}::text[], 1,
                                                  ${options.through ?? 2}::integer,
                                                  ${options.done ?? true}::boolean,
                                                  ${options.fileName ?? null}::text, null,
                                                  ${JSON.stringify(rowsJson)}::jsonb) as n`,
    );

  it('hands the worker a part of a job not yet checked, and nothing of a job adding rows', async () => {
    const [part] = await rows<{
      job: {
        jobId: string;
        columns: unknown;
        through: number;
        last: boolean;
        rows: unknown[];
      } | null;
    }>(
      workers(),
      sql`select app.import_job_to_check(1::smallint, ${jobId('leftRecent')}::uuid, 1) as job`,
    );
    expect(part?.job).toMatchObject({ jobId: jobId('leftRecent'), through: 0, last: false });
    expect(part?.job?.rows).toHaveLength(1);
    const [adding] = await rows<{ job: unknown }>(
      workers(),
      sql`select app.import_job_to_check(1::smallint, ${jobId('committingOld')}::uuid, 10) as job`,
    );
    expect(adding?.job).toBeNull();
  });

  it('checks the column names, the part being checked and the file name (review L2, L3)', async () => {
    // A column the job does not have, though no more of them than it has.
    expect(await failure(record(['Name', 'Extra'], '{}', []))).toMatch(/never gains a column/);
    // Mobile left out of the job, but row 2 still holds it.
    expect(
      await failure(
        record(['Name'], '{Mobile}', [{ rowNo: 1, raw: { Name: 'x' }, normalised: null }]),
      ),
    ).toMatch(/keeps a column the job no longer has/);
    // A row outside the part.
    expect(
      await failure(
        record(['Name', 'Mobile'], '{}', [{ rowNo: 2, raw: { Name: 'x' } }], { through: 1 }),
      ),
    ).toMatch(/outside the part being checked/);
    // A file name changed in more than its digits.
    expect(await failure(record(['Name', 'Mobile'], '{}', [], { fileName: 'other.csv' }))).toMatch(
      /only loses digits/,
    );
    // A column dropped with no name among those left out, a name not of a dropped column, and a
    // name that keeps twelve digits (second review, L12).
    expect(await failure(record(['Name'], '{}', [], { done: false }))).toMatch(/named once/);
    expect(await failure(record(['Name'], '{Village}', [], { done: false }))).toMatch(/named once/);
    expect(
      await failure(record(['Name'], '{"Mobile 2345 6789 0124"}', [], { done: false })),
    ).toMatch(/named once/);
    // Marked checked with rows past the part it says it read.
    expect(await failure(record(['Name', 'Mobile'], '{}', [], { through: 1, done: true }))).toMatch(
      /outside the part being checked/,
    );
    // A failure is recorded by its code alone, never a value.
    expect(
      await failure(
        rows(
          workers(),
          sql`select app.record_import_purge_failure(1::smallint, 'import-rows-purge', '2345 6789 0124')`,
        ),
      ),
    ).toMatch(/by its job and its code alone/);
    expect(
      await failure(
        rows(
          workers(),
          sql`select app.record_import_purge_failure(1::smallint, 'import-rows-purge', 'Ram 98765')`,
        ),
      ),
    ).toMatch(/by its job and its code alone/);
  });

  it('writes the checked rows, records what was left out, and checks a job once', async () => {
    const before = await rowsOf('leftRecent');
    const [answer] = await record(
      ['Name'],
      '{Mobile}',
      [
        { rowNo: 1, raw: { Name: `${MARK} one` }, normalised: { contact: { name: 'XXXX' } } },
        { rowNo: 2, raw: { Name: `${MARK} two` }, normalised: null },
      ],
      { fileName: 'leads.csv' },
    );
    expect(answer?.n).toBe(2);
    const after = await rowsOf('leftRecent');
    expect(after.map((r) => [r.state, r.errors_json, r.created_type, r.raw_json])).toEqual(
      before.map((r, i) => [
        r.state,
        r.errors_json,
        r.created_type,
        { Name: `${MARK} ${i === 0 ? 'one' : 'two'}` },
      ]),
    );
    const [job] = await asMigrator(
      (m) => m<
        {
          columns_json: unknown;
          left_out_columns: string[];
          masked_values: number;
          identity_checked_at: Date | null;
          identity_checked_through: number;
        }[]
      >`
        select columns_json, left_out_columns, masked_values, identity_checked_at,
               identity_checked_through
          from import_jobs where id = ${jobId('leftRecent')}`,
    );
    expect(job).toMatchObject({
      columns_json: ['Name'],
      left_out_columns: ['Mobile'],
      masked_values: 1,
      identity_checked_through: 2,
    });
    expect(job?.identity_checked_at).not.toBeNull();
    const [run] = await asMigrator(
      (m) => m<{ rows_affected: number }[]>`
        select rows_affected from retention_runs
         where job = 'import-identity-check' and error is null order by started_at desc limit 1`,
    );
    expect(run?.rows_affected).toBe(2);
    expect(await failure(record(['Name'], '{}', []))).toMatch(/not waiting for its identity check/);
  });

  it('records a failure by its code in retention_runs', async () => {
    await rows(
      workers(),
      sql`select app.record_import_purge_failure(1::smallint, 'import-identity-check', '57014')`,
    );
    const [run] = await asMigrator(
      (m) => m<{ error: string | null; rows_affected: number }[]>`
        select error, rows_affected from retention_runs
         where job = 'import-identity-check' order by started_at desc limit 1`,
    );
    expect(run).toEqual({ error: '57014', rows_affected: 0 });
  });
});
