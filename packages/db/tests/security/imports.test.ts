import { newId, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

const SHA = 'b'.repeat(64);
const IMPORT_TABLES = ['files', 'import_mapping_templates', 'import_jobs', 'import_rows'] as const;

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

interface Fixture {
  fileId: string;
  templateId: string;
  jobId: string;
}

/** A file, template, job and two rows in one entity, written as the table owner. */
async function fixture(entityId: number, createdBy: string): Promise<Fixture> {
  const f: Fixture = { fileId: newId(), templateId: newId(), jobId: newId() };
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
        values (${f.fileId}, ${entityId}, 'import', 'test', ${`imports/${f.fileId}`}, 'leads.csv', 'text/csv', 10, ${SHA}, 'ready', ${createdBy})`;
      await tx`insert into import_mapping_templates (id, entity_id, kind, name, mapping_json, created_by)
        values (${f.templateId}, ${entityId}, 'leads', ${`template ${f.templateId}`}, '{}'::jsonb, ${createdBy})`;
      await tx`insert into import_jobs (id, entity_id, kind, file_id, template_id, format, columns_json, state, total_rows, created_by)
        values (${f.jobId}, ${entityId}, 'leads', ${f.fileId}, ${f.templateId}, 'csv', '["Name"]'::jsonb, 'uploaded', 2, ${createdBy})`;
      await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, created_by)
        values (${f.jobId}, ${entityId}, 1, '{"Name": "one"}'::jsonb, ${createdBy}),
               (${f.jobId}, ${entityId}, 2, '{"Name": "two"}'::jsonb, ${createdBy})`;
    }),
  );
  return f;
}

async function seen(principal: Principal, query: SQL): Promise<number> {
  return asPrincipal(principal, async ({ tx }) => {
    const rows = (await tx.execute(query)) as unknown as { n: number }[];
    return rows[0]?.n ?? -1;
  });
}

function countOf(table: (typeof IMPORT_TABLES)[number], f: Fixture): SQL {
  switch (table) {
    case 'files':
      return sql`select count(*)::int as n from files where id = ${f.fileId}`;
    case 'import_mapping_templates':
      return sql`select count(*)::int as n from import_mapping_templates where id = ${f.templateId}`;
    case 'import_jobs':
      return sql`select count(*)::int as n from import_jobs where id = ${f.jobId}`;
    case 'import_rows':
      return sql`select count(*)::int as n from import_rows where job_id = ${f.jobId}`;
  }
}

const expected = { files: 1, import_mapping_templates: 1, import_jobs: 1, import_rows: 2 };

let executive: Principal;
let gm1: Principal;
let gm2: Principal;
let caller1: Principal;
let one: Fixture;
let two: Fixture;

beforeAll(async () => {
  executive = await createTestPrincipal('executive');
  gm1 = await createTestPrincipal('general_manager', [1]);
  gm2 = await createTestPrincipal('general_manager', [2]);
  caller1 = await createTestPrincipal('tele_caller_cc', [1]);
  one = await fixture(1, gm1.id);
  two = await fixture(2, gm2.id);
});

describe('imports are seen only with imports.write in their entity (design §8)', () => {
  it.each(IMPORT_TABLES)('%s shows nothing without a request context', async (table) => {
    const [row] = await withoutContext<{ n: number }>(countOf(table, one));
    expect(row?.n).toBe(0);
  });

  it.each(IMPORT_TABLES)('%s shows a General Manager their own entity only', async (table) => {
    expect(await seen(gm1, countOf(table, one))).toBe(expected[table]);
    expect(await seen(gm1, countOf(table, two))).toBe(0);
    expect(await seen(gm2, countOf(table, two))).toBe(expected[table]);
  });

  it.each(IMPORT_TABLES)('%s shows an Executive every entity in the request', async (table) => {
    expect(await seen(executive, countOf(table, one))).toBe(expected[table]);
    expect(await seen(executive, countOf(table, two))).toBe(expected[table]);
    expect(await seen({ ...executive, entityIds: [2] }, countOf(table, one))).toBe(0);
  });

  it.each(IMPORT_TABLES)('%s shows nothing to a role without imports.write', async (table) => {
    expect(await seen(caller1, countOf(table, one))).toBe(0);
  });
});

describe('imports are written only as the caller, in the caller’s entity', () => {
  const insertFile = (entityId: number, createdBy: string) => {
    const id = newId();
    return sql`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, ${entityId}, 'import', 'test', ${`imports/${id}`}, 'leads.csv', 'text/csv', 10, ${SHA}, 'ready', ${createdBy})`;
  };

  it('lets a General Manager store a file in their entity', async () => {
    await asPrincipal(gm1, ({ tx }) => tx.execute(insertFile(1, gm1.id)));
  });

  it('refuses a file in another entity, in another person’s name or by a role without imports.write', async () => {
    expect(await failure(asPrincipal(gm1, ({ tx }) => tx.execute(insertFile(2, gm1.id))))).toMatch(
      /row-level security/,
    );
    expect(await failure(asPrincipal(gm1, ({ tx }) => tx.execute(insertFile(1, gm2.id))))).toMatch(
      /row-level security/,
    );
    expect(
      await failure(asPrincipal(caller1, ({ tx }) => tx.execute(insertFile(1, caller1.id)))),
    ).toMatch(/row-level security/);
  });

  it('refuses a row for a job the caller cannot see', async () => {
    const row = sql`insert into import_rows (job_id, entity_id, row_no, raw_json, created_by)
      values (${two.jobId}, 1, 9, '{}'::jsonb, ${gm1.id})`;
    // Entity 1 is in scope, but the job lives in entity 2: the key or the policy refuses it.
    expect(await failure(asPrincipal(gm1, ({ tx }) => tx.execute(row)))).toMatch(
      /row-level security|foreign key/,
    );
  });

  it('keeps a row in its job’s entity, even for the table owner', async () => {
    const row = asMigrator(
      (m) => m`insert into import_rows (job_id, entity_id, row_no, raw_json, created_by)
        values (${one.jobId}, 2, 9, '{}'::jsonb, ${gm1.id})`,
    );
    expect(await failure(row)).toMatch(/import_rows_job_entity_fk/);
  });

  it('keeps a job with a file of its own entity, even for the table owner', async () => {
    const job = asMigrator(
      (
        m,
      ) => m`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, created_by)
        values (${newId()}, 2, 'leads', ${one.fileId}, 'csv', '[]'::jsonb, ${gm1.id})`,
    );
    expect(await failure(job)).toMatch(/import_jobs_file_entity_fk/);
  });

  it('updates the working columns of a job and a row, never what the file said', async () => {
    await asPrincipal(gm1, async ({ tx }) => {
      await tx.execute(sql`update import_jobs set state = 'mapped' where id = ${one.jobId}`);
      await tx.execute(
        sql`update import_rows set state = 'valid' where job_id = ${one.jobId} and row_no = 1`,
      );
    });
    for (const statement of [
      sql`update import_rows set raw_json = '{}'::jsonb where job_id = ${one.jobId}`,
      sql`update import_jobs set columns_json = '[]'::jsonb where id = ${one.jobId}`,
      sql`update import_jobs set file_id = ${two.fileId} where id = ${one.jobId}`,
      sql`update import_mapping_templates set mapping_json = '{}'::jsonb where id = ${one.templateId}`,
      sql`delete from import_rows where job_id = ${one.jobId}`,
      sql`delete from import_jobs where id = ${one.jobId}`,
      sql`delete from files where id = ${one.fileId}`,
    ]) {
      expect(await failure(asPrincipal(gm1, ({ tx }) => tx.execute(statement)))).toMatch(
        /permission denied/,
      );
    }
  });

  it('changes nothing of an import file, which only the file checks could (0062)', async () => {
    const changed = await asPrincipal(gm1, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update files set key = 'elsewhere' where id = ${one.fileId} returning id`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(changed).toBe(0);
  });

  it('changes nothing of another entity’s job', async () => {
    const changed = await asPrincipal(gm1, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update import_jobs set state = 'failed' where id = ${two.jobId} returning id`,
      )) as unknown as unknown[];
      return rows.length;
    });
    expect(changed).toBe(0);
  });
});

describe('the batch count of a job that committed before 0058 (0060)', () => {
  /** The backfill statement of migration 0060, as it was applied. */
  function backfill(): string {
    const text = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../migrations/0060_last_mile.sql'),
      'utf8',
    );
    const statement = text
      .split('--> statement-breakpoint')
      .find((part) => part.includes('update public.import_jobs'));
    if (statement === undefined) throw new Error('0060 has no batch count backfill');
    return statement;
  }

  it('counts the highest batch the rows carry, and leaves the other jobs as they are', async () => {
    const counts = await asMigrator((m) =>
      m
        .begin(async (tx) => {
          const f = { committed: newId(), untouched: newId(), counted: newId() };
          const fileId = newId();
          await tx`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
            values (${fileId}, 1, 'import', 'test', ${`imports/${fileId}`}, 'leads.csv', 'text/csv', 10,
                    ${newId().replaceAll('-', '').padEnd(64, '0')}, 'ready', ${gm1.id})`;
          for (const [jobId, batchCount] of [
            [f.committed, 0],
            [f.untouched, 0],
            [f.counted, 5],
          ] as const) {
            // Last changed long ago, so a change by the backfill shows in updated_at.
            await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state, total_rows, batch_count, created_by, updated_at)
              values (${jobId}, 1, 'leads', ${fileId}, 'csv', '["Name"]'::jsonb, 'committing', 3, ${batchCount}, ${gm1.id}, '2026-01-01T00:00:00Z')`;
          }
          // Rows of batches 1 and 3 and one still waiting; the untouched job has no row committed.
          for (const [jobId, rowNo, batch] of [
            [f.committed, 1, 1],
            [f.committed, 2, 3],
            [f.committed, 3, null],
            [f.untouched, 1, null],
            [f.counted, 1, 2],
          ] as const) {
            await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, committed_batch, created_by)
              values (${jobId}, 1, ${rowNo}, '{"Name": "one"}'::jsonb, ${batch}, ${gm1.id})`;
          }
          await tx.unsafe(backfill());
          const rows = await tx<{ id: string; n: number; changed: boolean }[]>`
            select id, batch_count as n, updated_at > '2026-01-01T00:00:00Z' as changed
              from import_jobs where id in ${tx([f.committed, f.untouched, f.counted])}`;
          const byId = new Map(rows.map((r) => [r.id, { n: r.n, changed: r.changed }]));
          throw new RolledBack({
            committed: byId.get(f.committed),
            untouched: byId.get(f.untouched),
            counted: byId.get(f.counted),
          });
        })
        .catch((e: unknown) => {
          if (e instanceof RolledBack) return e.value;
          throw e;
        }),
    );
    // Only the job whose rows carry a batch is written; the others keep their updated_at.
    expect(counts).toEqual({
      committed: { n: 3, changed: true },
      untouched: { n: 0, changed: false },
      counted: { n: 5, changed: false },
    });
  });
});

/** Carries a transaction's answer out of the rollback that leaves nothing behind. */
class RolledBack extends Error {
  constructor(readonly value: unknown) {
    super('rolled back');
  }
}
