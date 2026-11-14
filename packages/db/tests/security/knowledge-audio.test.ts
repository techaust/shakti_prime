import {
  newId,
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
} from '../../src/testing/index';

// Vault recordings under row-level security (docs/03-roadmap-appendix/phase2.md §6.4, K3): a
// recording's transcript is a column of its vault file, read by the file's company and
// sensitivity as a document's text is; it is kept by the index job's definer and replaced by a
// person only as a correction, which sends the file back to be read. The text is synthetic.

const SHA = 'e'.repeat(64);

const made = { files: [] as string[], vault: [] as string[] };

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`delete from knowledge_files where id = any(${made.vault}) or file_id = any(${made.files})`;
    await m`delete from files where id = any(${made.files})`;
  });
  await closeDb();
});

let owner: Principal;

async function upload(entityId: number, createdBy: string, contentType = 'audio/wav') {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
      values (${id}, ${entityId}, 'knowledge', 'test', ${`${String(entityId)}/knowledge/${id}.wav`}, 'vault.wav', ${contentType}, 10, ${SHA}, 'ready', ${createdBy})`,
  );
  made.files.push(id);
  return id;
}

/** A recording with its transcript, written as the owner: the index job's work, done directly. */
async function recording(
  entityId: number | null,
  sensitivity: KnowledgeSensitivity,
  state = 'indexed',
  sourceType = 'audio',
): Promise<string> {
  const id = newId();
  const file = await upload(
    entityId ?? 1,
    owner.id,
    sourceType === 'audio' ? 'audio/wav' : 'application/pdf',
  );
  const transcript = sourceType === 'audio' ? `transcript ${sensitivity}` : null;
  await asMigrator(
    (
      m,
    ) => m`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, state, transcript, created_by)
      values (${id}, ${entityId}, ${file}, 'vault audio file', ${sensitivity}, ${sourceType}, ${state}, ${transcript}, ${owner.id})`,
  );
  made.vault.push(id);
  return id;
}

const files: Record<string, string> = {};

beforeAll(async () => {
  owner = await createTestPrincipal('executive', [1, 2]);
  const cases: [string, number | null, KnowledgeSensitivity][] = [
    ['staff@1', 1, 'staff_ai_ok'],
    ['management@1', 1, 'management'],
    ['exec@1', 1, 'exec_only'],
    ['staff@2', 2, 'staff_ai_ok'],
    ['exec@group', null, 'exec_only'],
  ];
  for (const [name, entityId, sensitivity] of cases) {
    files[name] = await recording(entityId, sensitivity);
  }
});

/** The transcripts of this run's recordings, by name, that `who` can select. */
async function transcripts(who: Principal): Promise<string[]> {
  const ids = Object.values(files);
  const rows = await asPrincipal(
    who,
    async ({ tx }) =>
      (await tx.execute(
        sql`select id::text, transcript from knowledge_files
             where id = any(${`{${ids.join(',')}}`}::uuid[]) and transcript is not null`,
      )) as unknown as { id: string }[],
  );
  const byId = new Map(Object.entries(files).map(([name, id]) => [id, name]));
  return rows.map((r) => byId.get(r.id) ?? r.id).sort();
}

describe('a recording’s transcript is read by its file’s company and sensitivity', () => {
  it.each<[RoleKey, string[]]>([
    ['tele_caller_cc', ['staff@1']],
    ['field_engineer', ['staff@1']],
    ['accounts', ['management@1', 'staff@1']],
    ['general_manager', ['management@1', 'staff@1']],
    ['executive', ['exec@1', 'exec@group', 'management@1', 'staff@1']],
    ['agent:copilot', ['staff@1']],
    ['system:workers', []],
  ])('%s acting in company 1 reads only the transcripts it may', async (role, expected) => {
    expect(await transcripts(principalFor(role, [1]))).toEqual(expected);
  });

  it('keeps a company’s transcript out of another company', async () => {
    expect(await transcripts(principalFor('executive', [2]))).toEqual(['exec@group', 'staff@2']);
    expect(await transcripts(principalFor('tele_caller_cc', [2]))).toEqual(['staff@2']);
  });
});

describe('a request changes a transcript only as a correction', () => {
  const exec = () => principalFor('executive', [1]);
  const run = (who: Principal, statement: SQL) =>
    asPrincipal(who, ({ tx }) => tx.execute(statement)).then(
      () => true,
      () => false,
    );

  it('corrects a recording that is not being read, sending it back to waiting', async () => {
    const id = await recording(1, 'staff_ai_ok', 'failed');
    const writer = await createTestPrincipal('executive', [1]);
    expect(
      await run(
        writer,
        sql`update knowledge_files set transcript = 'corrected', state = 'waiting' where id = ${id}`,
      ),
    ).toBe(true);
    const [row] = await asMigrator(
      (m) => m<{ transcript: string; state: string; corrected: boolean }[]>`
        select transcript, state, transcript_corrected_at is not null as corrected
          from knowledge_files where id = ${id}`,
    );
    expect(row).toEqual({ transcript: 'corrected', state: 'waiting', corrected: true });
  });

  it('refuses any other change of a transcript, and any change by a reader', async () => {
    const indexed = await recording(1, 'staff_ai_ok', 'indexed');
    const waiting = await recording(1, 'staff_ai_ok', 'waiting');
    const archived = await recording(1, 'staff_ai_ok', 'archived');
    const pdf = await recording(1, 'staff_ai_ok', 'indexed', 'pdf');
    // Left in its state, or while it is being read, or archived, or cleared, or not a recording.
    expect(
      await run(exec(), sql`update knowledge_files set transcript = 'x' where id = ${indexed}`),
    ).toBe(false);
    expect(
      await run(
        exec(),
        sql`update knowledge_files set transcript = 'x', state = 'waiting' where id = ${waiting}`,
      ),
    ).toBe(false);
    expect(
      await run(
        exec(),
        sql`update knowledge_files set transcript = 'x', state = 'waiting' where id = ${archived}`,
      ),
    ).toBe(false);
    expect(
      await run(
        exec(),
        sql`update knowledge_files set transcript = null, state = 'waiting' where id = ${indexed}`,
      ),
    ).toBe(false);
    expect(
      await run(
        exec(),
        sql`update knowledge_files set transcript = 'x', state = 'waiting' where id = ${pdf}`,
      ),
    ).toBe(false);
    expect(
      await run(
        exec(),
        sql`update knowledge_files set transcript_corrected_at = now(), state = 'waiting' where id = ${indexed}`,
      ),
    ).toBe(false);
    // A reader without the write changes no row.
    const changed = await asPrincipal(
      principalFor('tele_caller_cc', [1]),
      async ({ tx }) =>
        (await tx.execute(
          sql`update knowledge_files set transcript = 'x', state = 'waiting' where id = ${indexed} returning id`,
        )) as unknown as unknown[],
    );
    expect(changed).toHaveLength(0);
    const [row] = await asMigrator(
      (m) =>
        m<{ transcript: string }[]>`select transcript from knowledge_files where id = ${indexed}`,
    );
    expect(row?.transcript).toBe('transcript staff_ai_ok');
  });

  it('adds a recording from a WAV upload as audio, with no transcript', async () => {
    const writer = await createTestPrincipal('executive', [1]);
    const insert = async (contentType: string, sourceType: string, transcript: string | null) =>
      run(
        writer,
        sql`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, transcript, created_by)
          values (${newId()}, 1, ${await upload(1, writer.id, contentType)}, 'vault audio file', 'staff_ai_ok',
                  ${sourceType}, ${transcript}, ${writer.id})`,
      );
    expect(await insert('audio/wav', 'audio', null)).toBe(true);
    expect(await insert('audio/wav', 'audio', 'typed before reading')).toBe(false);
    expect(await insert('audio/wav', 'pdf', null)).toBe(false);
    expect(await insert('application/pdf', 'audio', null)).toBe(false);
  });

  it('holds a transcript to Roman script and to recordings, whoever writes it', async () => {
    const pdf = await recording(1, 'staff_ai_ok', 'indexed', 'pdf');
    const audio = await recording(1, 'staff_ai_ok', 'indexed');
    const write = (id: string, text: string) =>
      asMigrator((m) => m`update knowledge_files set transcript = ${text} where id = ${id}`).then(
        () => true,
        () => false,
      );
    expect(await write(pdf, 'text')).toBe(false);
    // Devanagari, as escapes so this file holds none.
    expect(await write(audio, 'pump पंप')).toBe(false);
    expect(await write(audio, 'pump ki service, 120 meter')).toBe(true);
  });
});

describe('the index job keeps and reads a transcript only through its definers', () => {
  const workers = (entityIds: number[]) =>
    principalFor('system:workers', entityIds, { id: SYSTEM_WORKERS_PRINCIPAL_ID });

  const keep = (who: Principal, id: string, text: string) =>
    asPrincipal(
      who,
      async ({ tx }) =>
        (await tx.execute(
          sql`select app.record_knowledge_transcript(${id}::uuid, ${text}) as stored`,
        )) as unknown as { stored: boolean }[],
    );
  const read = (who: Principal, id: string) =>
    asPrincipal(
      who,
      async ({ tx }) =>
        (await tx.execute(
          sql`select app.knowledge_file_transcript(${id}::uuid) as transcript`,
        )) as unknown as { transcript: string | null }[],
    );

  it('keeps the first transcript of a waiting recording, once', async () => {
    const id = newId();
    const file = await upload(1, owner.id);
    await asMigrator(
      (
        m,
      ) => m`insert into knowledge_files (id, entity_id, file_id, title, sensitivity, source_type, created_by)
        values (${id}, 1, ${file}, 'vault audio file', 'exec_only', 'audio', ${owner.id})`,
    );
    made.vault.push(id);
    expect(await read(workers([1]), id)).toEqual([{ transcript: null }]);
    expect(await keep(workers([1]), id, 'first hearing')).toEqual([{ stored: true }]);
    expect(await keep(workers([1]), id, 'second hearing')).toEqual([{ stored: false }]);
    // The workers read the transcript through the definer, never the Executive-only row itself.
    expect(await read(workers([1]), id)).toEqual([{ transcript: 'first hearing' }]);
    expect(await transcripts(workers([1]))).toEqual([]);
  });

  it('refuses a person, a file outside the request’s company, and a file that is no recording', async () => {
    const audio = files['staff@1'] ?? '';
    await expect(keep(principalFor('executive', [1]), audio, 'x')).rejects.toThrow();
    await expect(read(principalFor('executive', [1]), audio)).rejects.toThrow();
    await expect(keep(workers([2]), audio, 'x')).rejects.toThrow();
    expect(await read(workers([2]), audio)).toEqual([{ transcript: null }]);
    const pdf = await recording(1, 'staff_ai_ok', 'waiting', 'pdf');
    await expect(keep(workers([1]), pdf, 'x')).rejects.toThrow();
    // An indexed recording keeps what it has.
    expect(await keep(workers([1]), audio, 'x')).toEqual([{ stored: false }]);
  });
});
