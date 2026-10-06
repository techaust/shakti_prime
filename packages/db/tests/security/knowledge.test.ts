import {
  AGENT_PRINCIPAL_IDS,
  newId,
  SYSTEM_MATRIX,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type KnowledgeSensitivity,
  type Principal,
  type RoleKey,
} from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

// The Knowledge Vault under row-level security (docs/design/phase1.md §8.4, SECURITY §3.2, §3.3
// and §11 item 6): retrieval respects sensitivity per role. A vault file and its passages are read
// in the companies of the request (or for the whole group), only with the read permission of
// their sensitivity; passages are written only by the index job's definer; a file is added,
// indexed again and archived by knowledge.vault.write. The passages' text is synthetic.

const SHA = 'd'.repeat(64);
const DIMENSIONS = 1024;

/** A unit vector along one dimension, as `[...]` text for pgvector. */
const along = (dimension: number): string =>
  `[${Array.from({ length: DIMENSIONS }, (_, i) => (i === dimension ? 1 : 0)).join(',')}]`;

/** This run's own direction, so the search below ranks this run's passages first. */
const DIRECTION = 1 + Math.floor(Math.random() * (DIMENSIONS - 1));

const made = { files: [] as string[], vault: [] as string[] };

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from knowledge_chunks where knowledge_file_id = any(${made.vault})`;
    await m`delete from knowledge_files where id = any(${made.vault})`;
    await m`delete from files where id = any(${made.files})`;
  });
  await closeDb();
});

let owner: Principal;

async function upload(entityId: number, createdBy: string, contentType = 'application/pdf') {
  const id = newId();
  await asMigrator(
    (m) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, ${entityId}, 'knowledge', 'test', ${`${String(entityId)}/knowledge/${id}.pdf`}, 'vault.pdf', ${contentType}, 10, ${SHA}, 'ready', ${createdBy})`,
  );
  made.files.push(id);
  return id;
}

/** A vault file with one passage, written as the owner: the index job's work, done directly. */
async function vaultFile(
  entityId: number | null,
  sensitivity: KnowledgeSensitivity,
  fileEntityId = entityId ?? 1,
): Promise<{ file: string; chunk: string; upload: string }> {
  const ids = { file: newId(), chunk: newId(), upload: await upload(fileEntityId, owner.id) };
  await asMigrator(async (m) => {
    await m`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, chunks, created_by)
      values (${ids.file}, ${entityId}, ${ids.upload}, 'vault rls file', ${sensitivity}, 'pdf', 'indexed', 1, ${owner.id})`;
    await m`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
      values (${ids.chunk}, ${ids.file}, ${entityId}, ${sensitivity}, 0, 'vault rls passage', ${along(DIRECTION)}::vector)`;
  });
  made.vault.push(ids.file);
  return ids;
}

/** The passages of this run, by name, that `who` finds by searching this run's direction. */
async function found(who: Principal): Promise<string[]> {
  const rows = await asPrincipal(who, async ({ tx }) => {
    await tx.execute(sql`select set_config('hnsw.iterative_scan', 'relaxed_order', true)`);
    return (await tx.execute(sql`
      with nearest as materialized (
        select c.id, c.embedding <=> ${along(DIRECTION)}::vector as distance
          from knowledge_chunks c
         order by c.embedding <=> ${along(DIRECTION)}::vector
         limit 8)
      select id::text from nearest order by distance`)) as unknown as { id: string }[];
  });
  return names(rows.map((r) => r.id));
}

/** The passages of this run, by name, that `who` can select at all. */
async function readable(who: Principal): Promise<string[]> {
  const ids = Object.values(passages);
  const rows = await asPrincipal(
    who,
    async ({ tx }) =>
      (await tx.execute(
        sql`select id::text from knowledge_chunks where id = any(${`{${ids.join(',')}}`}::uuid[])`,
      )) as unknown as { id: string }[],
  );
  return names(rows.map((r) => r.id));
}

const passages: Record<string, string> = {};
const vaultFiles: Record<string, string> = {};
const uploads: Record<string, string> = {};

function names(ids: readonly string[]): string[] {
  const byId = new Map(Object.entries(passages).map(([name, id]) => [id, name]));
  return ids.flatMap((id) => {
    const name = byId.get(id);
    return name === undefined ? [] : [name];
  }).sort();
}

beforeAll(async () => {
  owner = await createTestPrincipal('executive', [1, 2]);
  const cases: [string, number | null, KnowledgeSensitivity][] = [
    ['staff@1', 1, 'staff_ai_ok'],
    ['management@1', 1, 'management'],
    ['exec@1', 1, 'exec_only'],
    ['staff@2', 2, 'staff_ai_ok'],
    ['staff@group', null, 'staff_ai_ok'],
    ['exec@group', null, 'exec_only'],
  ];
  for (const [name, entityId, sensitivity] of cases) {
    const ids = await vaultFile(entityId, sensitivity);
    passages[name] = ids.chunk;
    vaultFiles[name] = ids.file;
    uploads[name] = ids.upload;
  }
});

/** What each kind of reader finds acting in company 1 (SECURITY §3.2 and §11 item 6). */
const IN_COMPANY_1 = {
  staff: ['staff@1', 'staff@group'],
  management: ['management@1', 'staff@1', 'staff@group'],
  exec: ['exec@1', 'exec@group', 'management@1', 'staff@1', 'staff@group'],
};

describe('retrieval respects sensitivity per role (SECURITY §11 item 6)', () => {
  it.each<[RoleKey, string[]]>([
    ['tele_caller_cc', IN_COMPANY_1.staff],
    ['tele_caller_lc', IN_COMPANY_1.staff],
    ['sales_team_lead', IN_COMPANY_1.staff],
    ['store_manager', IN_COMPANY_1.staff],
    ['inventory_manager', IN_COMPANY_1.staff],
    ['project_manager', IN_COMPANY_1.staff],
    ['field_engineer', IN_COMPANY_1.staff],
    ['hr_admin', IN_COMPANY_1.staff],
    ['accounts', IN_COMPANY_1.management],
    ['general_manager', IN_COMPANY_1.management],
    ['executive', IN_COMPANY_1.exec],
  ])('%s acting in company 1 finds only what it may read', async (role, expected) => {
    const who = principalFor(role, [1]);
    expect(await found(who)).toEqual(expected);
    expect(await readable(who)).toEqual(expected);
  });

  it('a tele-caller finds staff knowledge and none of management or the Executive', async () => {
    const caller = principalFor('tele_caller_cc', [1]);
    const seen = await found(caller);
    expect(seen).toContain('staff@1');
    expect(seen.filter((n) => n.startsWith('management') || n.startsWith('exec'))).toEqual([]);
  });

  it('keeps a company’s file out of another company’s search', async () => {
    expect(await found(principalFor('executive', [2]))).toEqual([
      'exec@group',
      'staff@2',
      'staff@group',
    ]);
    expect(await found(principalFor('tele_caller_cc', [2]))).toEqual(['staff@2', 'staff@group']);
    // All companies: both companies' files and the group's.
    expect(await found(principalFor('tele_caller_cc', [1, 2]))).toEqual([
      'staff@1',
      'staff@2',
      'staff@group',
    ]);
  });

  it.each(Object.keys(AGENT_PRINCIPAL_IDS) as RoleKey[])(
    '%s never reads Executive knowledge',
    async (agent) => {
      const who = principalFor(agent, [1, 2]);
      const seen = await readable(who);
      expect(seen.filter((n) => n.startsWith('exec'))).toEqual([]);
      expect(seen.filter((n) => n.startsWith('management'))).toEqual([]);
    },
  );

  it('the Caller Co-pilot reads staff knowledge only; the workers read none', async () => {
    expect(await readable(principalFor('agent:copilot', [1]))).toEqual(IN_COMPANY_1.staff);
    expect(await readable(principalFor('system:workers', [1, 2]))).toEqual([]);
  });

  it('shows nothing without a request context, or with no company', async () => {
    const rows = await withoutContext<{ n: number }>(
      sql`select count(*)::int as n from knowledge_chunks`,
    );
    expect(rows[0]?.n).toBe(0);
    expect(await readable(principalFor('executive', []))).toEqual([]);
  });

  it('reads a vault file by the same rule as its passages', async () => {
    const titles = async (who: Principal) => {
      const ids = Object.values(vaultFiles);
      const rows = await asPrincipal(
        who,
        async ({ tx }) =>
          (await tx.execute(
            sql`select id::text from knowledge_files where id = any(${`{${ids.join(',')}}`}::uuid[])`,
          )) as unknown as { id: string }[],
      );
      const byId = new Map(Object.entries(vaultFiles).map(([name, id]) => [id, name]));
      return rows.map((r) => byId.get(r.id) ?? r.id).sort();
    };
    expect(await titles(principalFor('tele_caller_cc', [1]))).toEqual(IN_COMPANY_1.staff);
    expect(await titles(principalFor('general_manager', [1]))).toEqual(IN_COMPANY_1.management);
    expect(await titles(principalFor('executive', [1]))).toEqual(IN_COMPANY_1.exec);
  });

  it('reads a vault upload only with a vault file the reader may read, or as its uploader', async () => {
    const seen = async (who: Principal, name: string) =>
      (
        (await asPrincipal(
          who,
          async ({ tx }) =>
            (await tx.execute(
              sql`select 1 from files where id = ${uploads[name] ?? ''}`,
            )) as unknown as unknown[],
        )) as unknown[]
      ).length;
    const caller = principalFor('tele_caller_cc', [1]);
    expect(await seen(caller, 'staff@1')).toBe(1);
    expect(await seen(caller, 'exec@1')).toBe(0);
    expect(await seen(principalFor('general_manager', [1]), 'exec@1')).toBe(0);
    expect(await seen(principalFor('executive', [1]), 'exec@1')).toBe(1);
    // The uploader reads their own vault upload before it is added, while they hold the write.
    const pending = await upload(1, owner.id);
    uploads.pending = pending;
    expect(await seen(principalFor('executive', [1], { id: owner.id }), 'pending')).toBe(1);
    expect(await seen(principalFor('tele_caller_cc', [1], { id: owner.id }), 'pending')).toBe(0);
  });
});

describe('who writes the vault', () => {
  const insertVaultFile = (
    who: Principal,
    fileId: string,
    over: Partial<{ entity: number | null; sensitivity: string; state: string; source: string }>,
  ) => {
    const row = { entity: 1, sensitivity: 'staff_ai_ok', state: 'waiting', source: 'pdf', ...over };
    const id = newId();
    made.vault.push(id);
    return asPrincipal(who, ({ tx }) =>
      tx.execute(sql`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, created_by)
        values (${id}, ${row.entity}, ${fileId}, 'vault write', ${row.sensitivity}, ${row.source}, ${row.state}, ${who.id})`),
    ).then(
      () => true,
      (e: unknown) => {
        if (process.env.K1_DEBUG === '1') console.log(String((e as Error).cause ?? e));
        return false;
      },
    );
  };

  it('adds a vault file only from the caller’s own upload, waiting, with a sensitivity they read', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    const exec = await createTestPrincipal('executive', [1, 2, 3, 4]);
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    expect(await insertVaultFile(gm, await upload(1, gm.id), {})).toBe(true);
    // A GM may not hide a file from themselves.
    expect(await insertVaultFile(gm, await upload(1, gm.id), { sensitivity: 'exec_only' })).toBe(
      false,
    );
    // No write, someone else's upload, another company's upload, not waiting, the wrong type.
    expect(await insertVaultFile(caller, await upload(1, caller.id), {})).toBe(false);
    expect(await insertVaultFile(gm, await upload(1, exec.id), {})).toBe(false);
    expect(await insertVaultFile(exec, await upload(2, exec.id), { entity: 1 })).toBe(false);
    expect(await insertVaultFile(exec, await upload(1, exec.id), { state: 'indexed' })).toBe(false);
    expect(await insertVaultFile(exec, await upload(1, exec.id), { source: 'word' })).toBe(false);
    // The whole group only from a request for every company.
    expect(await insertVaultFile(gm, await upload(1, gm.id), { entity: null })).toBe(false);
    const all = await createTestPrincipal('executive');
    expect(await insertVaultFile(all, await upload(1, all.id), { entity: null })).toBe(true);
  });

  it('writes no passage from a request, and a request moves a file only to waiting or archived', async () => {
    const exec = principalFor('executive', [1]);
    const chunk = passages['staff@1'] ?? '';
    const file = vaultFiles['staff@1'] ?? '';
    const run = (statement: SQL) =>
      asPrincipal(exec, ({ tx }) => tx.execute(statement)).then(
        () => true,
        () => false,
      );
    expect(await run(sql`update knowledge_chunks set chunk_text = 'x' where id = ${chunk}`)).toBe(
      false,
    );
    expect(await run(sql`delete from knowledge_chunks where id = ${chunk}`)).toBe(false);
    expect(
      await run(sql`insert into knowledge_chunks (id, knowledge_file_id, entity_id, sensitivity, position, chunk_text, embedding)
        values (${newId()}, ${file}, 1, 'staff_ai_ok', 9, 'x', ${along(0)}::vector)`),
    ).toBe(false);
    expect(await run(sql`update knowledge_files set state = 'failed' where id = ${file}`)).toBe(
      false,
    );
    expect(await run(sql`update knowledge_files set chunks = 9 where id = ${file}`)).toBe(false);
    expect(await run(sql`delete from knowledge_files where id = ${file}`)).toBe(false);
    // A caller without the write changes nothing.
    const caller = principalFor('tele_caller_cc', [1]);
    const changed = await asPrincipal(
      caller,
      async ({ tx }) =>
        (await tx.execute(
          sql`update knowledge_files set state = 'archived' where id = ${file} returning id`,
        )) as unknown as unknown[],
    );
    expect(changed).toHaveLength(0);
  });

  it('archiving takes the file’s passages out of search at once', async () => {
    const { file, chunk } = await vaultFile(1, 'staff_ai_ok');
    const exec = await createTestPrincipal('executive', [1]);
    await asPrincipal(exec, ({ tx }) =>
      tx.execute(sql`update knowledge_files set state = 'archived' where id = ${file}`),
    );
    const left = await asMigrator(
      (m) => m<{ n: number; chunks: number }[]>`
        select (select count(*)::int from knowledge_chunks where id = ${chunk}) as n,
               (select chunks from knowledge_files where id = ${file}) as chunks`,
    );
    expect(left[0]).toEqual({ n: 0, chunks: 0 });
  });
});

describe('the index job reaches the vault only through its definers (ADR 0020)', () => {
  const workers = (entityIds: number[]) =>
    principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

  it('holds knowledge.index, which no person and no agent holds', () => {
    expect(SYSTEM_MATRIX['system:workers']).toContainEqual({ key: 'knowledge.index', scope: 'all' });
  });

  it('refuses a person, and a file stored outside the request’s company', async () => {
    const file = vaultFiles['staff@1'] ?? '';
    const facts = (who: Principal) =>
      asPrincipal(
        who,
        async ({ tx }) =>
          (await tx.execute(
            sql`select state from app.knowledge_file_for_index(${file}::uuid)`,
          )) as unknown as { state: string }[],
      );
    await expect(facts(principalFor('executive', [1]))).rejects.toThrow();
    expect(await facts(workers([2]))).toEqual([]);
    expect(await facts(workers([1]))).toEqual([{ state: 'indexed' }]);
  });

  it('replaces a waiting file’s passages with the file’s company and sensitivity, once', async () => {
    const { file, chunk } = await vaultFile(null, 'management');
    await asMigrator((m) => m`update knowledge_files set state = 'waiting' where id = ${file}`);
    const chunks = JSON.stringify(
      [0, 1].map((position) => ({
        id: newId(),
        position,
        text: `vault rls passage ${String(position)}`,
        embedding: Array.from({ length: DIMENSIONS }, (_, i) => (i === position ? 1 : 0)),
      })),
    );
    const record = (who: Principal) =>
      asPrincipal(
        who,
        async ({ tx }) =>
          (await tx.execute(
            sql`select app.record_knowledge_index(${file}::uuid, 'indexed', null, ${chunks}::jsonb) as replaced`,
          )) as unknown as { replaced: number | null }[],
      );
    await expect(record(principalFor('executive', [1]))).rejects.toThrow();
    expect(await record(workers([1]))).toEqual([{ replaced: 1 }]);
    // A delivery that ran again finds the file indexed and changes nothing.
    expect(await record(workers([1]))).toEqual([{ replaced: null }]);
    const rows = await asMigrator(
      (m) => m<{ id: string; entity_id: number | null; sensitivity: string }[]>`
        select id::text, entity_id, sensitivity from knowledge_chunks where knowledge_file_id = ${file}
         order by position`,
    );
    expect(rows.map((r) => [r.entity_id, r.sensitivity])).toEqual([
      [null, 'management'],
      [null, 'management'],
    ]);
    expect(rows.map((r) => r.id)).not.toContain(chunk);
  });
});
