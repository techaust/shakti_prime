import {
  FILE_PURPOSES,
  hasGrant,
  newId,
  ROLE_KEYS,
  STAFF_ROLE_KEYS,
  type FilePurpose,
  type PermissionKey,
  type Principal,
  type RoleKey,
  type Scope,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(closeDb);

const SHA = 'c'.repeat(64);

/**
 * Who creates and reads a file of each purpose (0062, `app.file_purpose_grant()`); the domain's
 * `files/purposes.ts` holds the same list and a domain test compares the two. Read `company` is
 * every principal of the company.
 */
const WRITE: Partial<Record<FilePurpose, { key: PermissionKey; scope: Scope }>> = {
  import: { key: 'imports.write', scope: 'entity' },
  quote_pdf: { key: 'files.process', scope: 'entity' },
  signed_quote: { key: 'sales.quote.send', scope: 'own' },
  entity_logo: { key: 'admin.entities.write', scope: 'all' },
  letterhead: { key: 'admin.entities.write', scope: 'all' },
  consent_evidence: { key: 'crm.account.write', scope: 'own' },
};
const READ: Partial<Record<FilePurpose, PermissionKey | 'company'>> = {
  import: 'imports.write',
  quote_pdf: 'crm.lead.read',
  signed_quote: 'crm.lead.read',
  entity_logo: 'company',
  letterhead: 'company',
  consent_evidence: 'crm.account.write',
};

const WORKER_GRANTS = [{ key: 'files.process' as const, scope: 'all' as const }];

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

let uploader: Principal;
/** One ready file of every purpose in companies 1 and 2, uploaded by `uploader`. */
const files = new Map<string, { purpose: FilePurpose; entityId: number }>();

async function insertFile(
  entityId: number,
  purpose: FilePurpose,
  createdBy: string,
  status = 'ready',
): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, ${entityId}, ${purpose}, 'test', ${`files/${id}.pdf`}, 'file.pdf', 'application/pdf', 10, ${SHA}, ${status}, ${createdBy})`,
  );
  return id;
}

beforeAll(async () => {
  uploader = await createTestPrincipal('executive', [1, 2]);
  for (const entityId of [1, 2]) {
    for (const purpose of FILE_PURPOSES) {
      files.set(await insertFile(entityId, purpose, uploader.id), { purpose, entityId });
    }
  }
});

/** The fixture files `principal` sees, as `purpose@company`. */
async function visible(principal: Principal): Promise<string[]> {
  const ids = [...files.keys()];
  const rows = await asPrincipal(
    principal,
    ({ tx }) =>
      tx.execute(
        sql`select id::text from files where id = any(${`{${ids.join(',')}}`}::uuid[])`,
      ) as unknown as Promise<{ id: string }[]>,
  );
  return rows
    .map((r) => {
      const f = files.get(r.id);
      return f === undefined ? r.id : `${f.purpose}@${String(f.entityId)}`;
    })
    .sort();
}

describe('a file is read by its purpose (0062)', () => {
  it.each(ROLE_KEYS)(
    '%s acting in company 1 reads what its grants allow, never company 2',
    async (role: RoleKey) => {
      // Not the uploader: a narrower scope than the company's reads nothing here.
      const principal = principalFor(role, [1]);
      const expected = FILE_PURPOSES.filter((purpose) => {
        const read = READ[purpose];
        if (read === undefined) return false;
        return read === 'company' || hasGrant(principal.permissions, read, 'entity');
      })
        .map((p) => `${p}@1`)
        .sort();
      expect(await visible(principal)).toEqual(expected);
    },
  );

  it('shows the uploader, at the narrowest scope, their own files of a purpose they read', async () => {
    const caller = principalFor('tele_caller_lc', [1], { id: uploader.id });
    expect(await visible(caller)).toEqual(
      [
        'consent_evidence@1',
        'entity_logo@1',
        'letterhead@1',
        'quote_pdf@1',
        'signed_quote@1',
      ].sort(),
    );
  });

  it('shows no file without a request context', async () => {
    const rows = await withoutContext<{ n: number }>(sql`select count(*)::int as n from files`);
    expect(rows[0]?.n).toBe(0);
  });

  it('lets the worker read every file of its companies, whatever the purpose', async () => {
    const worker = principalFor('executive', [2], { permissions: WORKER_GRANTS });
    expect(await visible(worker)).toEqual(FILE_PURPOSES.map((p) => `${p}@2`).sort());
  });
});

describe('a file is created by the permission its purpose names', () => {
  const tryInsert = (
    principal: Principal,
    purpose: FilePurpose,
    overrides: Partial<{ entity_id: number; status: string; created_by: string }> = {},
  ) =>
    asPrincipal(principal, ({ tx }) => {
      const row = { entity_id: 1, status: 'pending', created_by: principal.id, ...overrides };
      const id = newId();
      return tx.execute(sql`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
        values (${id}, ${row.entity_id}, ${purpose}, 'test', ${`files/${id}.pdf`}, 'f.pdf', 'application/pdf', 1, ${SHA}, ${row.status}, ${row.created_by})`);
    }).then(
      () => true,
      () => false,
    );

  it.each(STAFF_ROLE_KEYS)('%s uploads exactly the purposes its grants name', async (role) => {
    const principal = await createTestPrincipal(role, [1]);
    const allowed: FilePurpose[] = [];
    for (const purpose of FILE_PURPOSES) {
      if (await tryInsert(principal, purpose)) allowed.push(purpose);
    }
    const expected = FILE_PURPOSES.filter((purpose) => {
      const write = WRITE[purpose];
      return write !== undefined && hasGrant(principal.permissions, write.key, write.scope);
    });
    expect(allowed).toEqual(expected);
  });

  it('starts an upload as pending, as the caller, in the request’s companies', async () => {
    const executive = await createTestPrincipal('executive', [1]);
    expect(await tryInsert(executive, 'entity_logo')).toBe(true);
    expect(await tryInsert(executive, 'entity_logo', { status: 'ready' })).toBe(false);
    expect(await tryInsert(executive, 'entity_logo', { created_by: uploader.id })).toBe(false);
    expect(await tryInsert(executive, 'entity_logo', { entity_id: 2 })).toBe(false);
  });

  it('never lets a request create a vault file or a field photo yet', async () => {
    const executive = await createTestPrincipal('executive', [1]);
    for (const purpose of ['knowledge', 'job_photo', 'selfie'] as const) {
      expect(await tryInsert(executive, purpose)).toBe(false);
    }
  });

  it('lets the worker record a file it makes, of any purpose', async () => {
    const worker = await createTestPrincipal('executive', [1], { permissions: WORKER_GRANTS });
    expect(await tryInsert(worker, 'quote_pdf', { status: 'ready' })).toBe(true);
    expect(await tryInsert(worker, 'knowledge')).toBe(true);
  });
});

describe('a file changes only through its checks', () => {
  const update = (principal: Principal, id: string, set: ReturnType<typeof sql>) =>
    asPrincipal(principal, async ({ tx }) => {
      const rows = (await tx.execute(
        sql`update files set ${set} where id = ${id} returning id`,
      )) as unknown as unknown[];
      return rows.length;
    });

  it('lets the uploader mark their own pending upload complete, and nothing more', async () => {
    const owner = await createTestPrincipal('executive', [1]);
    const other = await createTestPrincipal('executive', [1]);
    const id = await insertFile(1, 'letterhead', owner.id, 'pending');
    expect(await update(other, id, sql`status = 'scanning'`)).toBe(0);
    expect(await failure(update(owner, id, sql`status = 'ready'`))).toMatch(/row-level security/);
    expect(await failure(update(owner, id, sql`status = 'scanning', key = 'elsewhere'`))).toMatch(
      /only the file checks change a stored file/,
    );
    expect(await update(owner, id, sql`status = 'scanning'`)).toBe(1);
    // Once the checks have it, the uploader changes it no more.
    expect(await update(owner, id, sql`status = 'pending'`)).toBe(0);
  });

  it('lets the worker move a file of its companies through the checks', async () => {
    const worker = await createTestPrincipal('executive', [1], { permissions: WORKER_GRANTS });
    const mine = await insertFile(1, 'signed_quote', uploader.id, 'scanning');
    const theirs = await insertFile(2, 'signed_quote', uploader.id, 'scanning');
    expect(
      await update(
        worker,
        mine,
        sql`status = 'ready', key = ${`files/${mine}-checked.jpg`}, content_type = 'image/jpeg',
            size = 5, sha256 = ${'d'.repeat(64)}, scan_result = '{"verdict":"no_threats_found"}'`,
      ),
    ).toBe(1);
    expect(await update(worker, theirs, sql`status = 'ready'`)).toBe(0);
  });

  it('names who changed a file and when, whatever the statement said', async () => {
    const worker = await createTestPrincipal('executive', [1], { permissions: WORKER_GRANTS });
    const id = await insertFile(1, 'signed_quote', uploader.id, 'scanning');
    await asMigrator((m) => m`update files set updated_at = '2001-01-01' where id = ${id}`);
    expect(
      await update(
        worker,
        id,
        sql`status = 'scanned', updated_by = ${uploader.id}, updated_at = '2002-02-02'`,
      ),
    ).toBe(1);
    const [row] = await asMigrator(
      (m) => m<{ updated_by: string; recent: boolean }[]>`
        select updated_by, updated_at > now() - interval '1 minute' as recent from files where id = ${id}`,
    );
    expect(row).toEqual({ updated_by: worker.id, recent: true });
  });

  it('never changes what a file is, whose it is or which company it belongs to', async () => {
    const worker = await createTestPrincipal('executive', [1], { permissions: WORKER_GRANTS });
    const id = await insertFile(1, 'signed_quote', uploader.id, 'scanning');
    for (const set of [
      sql`entity_id = 2`,
      sql`purpose = 'entity_logo'`,
      sql`created_by = ${worker.id}`,
      sql`bucket = 'elsewhere'`,
      sql`name = 'renamed.pdf'`,
    ]) {
      expect(await failure(update(worker, id, set))).toMatch(/permission denied/);
    }
    expect(
      await failure(
        asPrincipal(worker, ({ tx }) => tx.execute(sql`delete from files where id = ${id}`)),
      ),
    ).toMatch(/permission denied/);
  });

  it('grants updates on the status and the checks’ columns only', async () => {
    const rows = await withoutContext<{ column_name: string }>(sql`
      select column_name from information_schema.column_privileges
       where grantee = 'app_user' and table_name = 'files' and privilege_type = 'UPDATE'
       order by column_name`);
    expect(rows.map((r) => r.column_name)).toEqual(
      [
        'content_type',
        'key',
        'scan_result',
        'sha256',
        'size',
        'status',
        'updated_at',
        'updated_by',
      ].sort(),
    );
  });

  it('gives the file checks to no role in the seed', async () => {
    const rows = await asMigrator(
      (m) =>
        m<
          { n: number }[]
        >`select count(*)::int as n from role_permissions where permission_key = 'files.process'`,
    );
    expect(rows[0]?.n).toBe(0);
  });
});
