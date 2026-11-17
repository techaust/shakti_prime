import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestVoicePrincipal,
  principalFor,
} from '../../src/testing/index';

// V2 Live voice (docs/03-roadmap-appendix/phase2.md §7.5, SECURITY §3.4, migration of V2): a
// session is read by its person and by the Executive (audit.read for the group), in a request
// covering all its companies; no request role writes the table; a person holding voice.use opens
// their own through app.voice_session_open(), which checks the day's limits across every company;
// the platform (voice.session.record) records its end, minutes and spend through
// app.record_voice_session(), only forward; and a request acting through a voice session writes
// audit rows naming the session and its person, and is no person to the merge definers. The role
// × company read is in role-entity-matrix.test.ts. The suites never clean these tables, so every
// row here is found by this run's own ids.

afterAll(closeDb);

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    return cause instanceof Error ? cause.message : String(cause);
  }
  throw new Error('expected the statement to fail');
}

async function rows<T = Record<string, unknown>>(principal: Principal, query: SQL): Promise<T[]> {
  return asPrincipal(principal, async ({ tx }) => (await tx.execute(query)) as unknown as T[]);
}

const workers: Principal = {
  ...principalFor('system:workers', []),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
};

interface Opened {
  outcome: string;
  minutes_used: number;
  paise_used: number;
}

/** Opens a session as `who`, with the day's limits of question 12. */
function open(who: Principal, session: string, entityIds: readonly number[] = [1]) {
  return rows<Opened>(
    who,
    sql`select outcome, minutes_used, paise_used
          from app.voice_session_open(${session}::uuid, ${`{${entityIds.join(',')}}`}::smallint[],
                                      'ask', true, 30, 20000, 15)`,
  );
}

/** A session of `userId`'s written as the owner, as an earlier day's or an ended one would be. */
async function pastSession(
  userId: string,
  values: { startedAt: string; minutes: number; costPaise?: number; entityIds?: number[] },
): Promise<string> {
  const id = newId();
  const entityIds = values.entityIds ?? [1];
  const entityId = entityIds.length === 1 ? (entityIds[0] ?? null) : null;
  await asMigrator(async (m) => {
    await m`insert into principals (id, kind, display_name) values (${id}, 'voice_session', 'test voice')`;
    await m`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording,
                                        started_at, ended_at, minutes, cost_paise)
            values (${id}, ${userId}, ${entityId}, ${entityIds}::smallint[], 'ask', false,
                    ${values.startedAt}::timestamptz,
                    ${values.startedAt}::timestamptz + interval '1 minute' * ${values.minutes},
                    ${values.minutes}, ${values.costPaise ?? 0})`;
  });
  return id;
}

interface SessionRow {
  user_id: string;
  entity_id: number | null;
  entity_ids: number[];
  ended_at: Date | null;
  minutes: number | null;
  cost_paise: number;
  turn_stats_json: Record<string, unknown>;
}

async function session(id: string): Promise<SessionRow | undefined> {
  const [row] = await asMigrator(
    (m) => m<SessionRow[]>`
      select user_id, entity_id, entity_ids, ended_at, minutes, cost_paise, turn_stats_json
        from voice_sessions where id = ${id}`,
  );
  return row;
}

describe('voice_sessions', () => {
  it('is read by its person and the Executive, in a request covering its companies', async () => {
    const gm = await createTestPrincipal('general_manager', [1, 2]);
    const id = newId();
    expect(await open(gm, id, [1, 2])).toEqual([
      { outcome: 'started', minutes_used: 0, paise_used: 0 },
    ]);
    const read = sql`select id from voice_sessions where id = ${id}`;
    expect(await rows(gm, read)).toHaveLength(1);
    // Narrowed to one of its two companies, even the person does not read it.
    expect(await rows({ ...gm, entityIds: [1] }, read)).toHaveLength(0);
    // The Executive reads it with audit.read for the group; another GM (audit.read by company)
    // and an Accounts person do not, nor does the reporting role at all.
    expect(await rows(principalFor('executive', [1, 2]), read)).toHaveLength(1);
    expect(await rows(principalFor('executive', [1]), read)).toHaveLength(0);
    expect(await rows(principalFor('general_manager', [1, 2]), read)).toHaveLength(0);
    expect(await rows(principalFor('accounts', [1, 2]), read)).toHaveLength(0);
    const [reporter] = await asMigrator(
      (m) => m<{ ok: boolean }[]>`
        select has_table_privilege('readonly_reporter', 'voice_sessions', 'select') as ok`,
    );
    expect(reporter?.ok).toBe(false);
  });

  it('is written by no request role directly', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const id = newId();
    expect(
      await failure(
        rows(
          exec,
          sql`insert into voice_sessions (id, user_id, entity_id, entity_ids, mode, consent_recording)
              values (${id}, ${exec.id}, 1, '{1}', 'ask', true)`,
        ),
      ),
    ).toMatch(/permission denied/);
    await open(exec, id);
    expect(
      await failure(rows(exec, sql`update voice_sessions set minutes = 0 where id = ${id}`)),
    ).toMatch(/permission denied/);
    expect(await failure(rows(exec, sql`delete from voice_sessions where id = ${id}`))).toMatch(
      /permission denied/,
    );
  });
});

describe('app.voice_session_open', () => {
  it('opens only for a person holding voice.use, as themselves, over companies of the request', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [1]);
    expect(await failure(open(caller, newId()))).toMatch(/voice.use is required/);
    // A principal holding voice.use under an agent's role, and a voice session.
    const agentLike = await createTestPrincipal('agent:chief', [1], {
      kind: 'user',
      permissions: [{ key: 'voice.use', scope: 'all' }],
    });
    expect(await failure(open(agentLike, newId()))).toMatch(/only a person/);
    const voice = await createTestVoicePrincipal('executive', [1]);
    expect(await failure(open(voice, newId()))).toMatch(/only a person/);
    const exec = await createTestPrincipal('executive', [1, 2]);
    expect(await failure(open({ ...exec, entityIds: [1] }, newId(), [1, 2]))).toMatch(
      /outside the request/,
    );
    const id = newId();
    await open(exec, id, [2]);
    expect(await session(id)).toMatchObject({ user_id: exec.id, entity_id: 2, entity_ids: [2] });
    // Its principal is the session's own, made by the person.
    const [principal] = await asMigrator(
      (m) => m<{ kind: string; created_by: string }[]>`
        select kind, created_by from principals where id = ${id}`,
    );
    expect(principal).toEqual({ kind: 'voice_session', created_by: exec.id });
  });

  it("ends the person's earlier open session, at most the longest length after its start", async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const first = newId();
    await open(exec, first);
    expect((await session(first))?.ended_at).toBeNull();
    // Moved back 40 minutes: it ends at its 15-minute limit, with 15 minutes.
    await asMigrator(
      (m) =>
        m`update voice_sessions set started_at = now() - interval '40 minutes' where id = ${first}`,
    );
    const second = newId();
    expect(await open(exec, second)).toEqual([
      { outcome: 'started', minutes_used: 15, paise_used: 0 },
    ]);
    expect(await session(first)).toMatchObject({ minutes: 15 });
    expect((await session(second))?.ended_at).toBeNull();
  });

  it("refuses at the day's minutes or spend across every company, and writes nothing", async () => {
    const exec = await createTestPrincipal('executive', [1, 2]);
    // An earlier day's session in India does not count.
    await pastSession(exec.id, {
      startedAt: new Date(Date.now() - 36 * 3600_000).toISOString(),
      minutes: 30,
    });
    await pastSession(exec.id, { startedAt: new Date().toISOString(), minutes: 20 });
    await pastSession(exec.id, {
      startedAt: new Date().toISOString(),
      minutes: 10,
      entityIds: [2],
    });
    // Acting in company 1 only, the session in company 2 still counts.
    const id = newId();
    expect(await open({ ...exec, entityIds: [1] }, id, [1])).toEqual([
      { outcome: 'cap_reached', minutes_used: 30, paise_used: 0 },
    ]);
    expect(await session(id)).toBeUndefined();
    const [made] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from principals where id = ${id}`,
    );
    expect(made?.n).toBe(0);
    // The spend: ₹200 is 20,000 paise.
    const spender = await createTestPrincipal('executive', [1]);
    await pastSession(spender.id, {
      startedAt: new Date().toISOString(),
      minutes: 1,
      costPaise: 20_000,
    });
    expect(await open(spender, newId())).toEqual([
      { outcome: 'cap_reached', minutes_used: 1, paise_used: 20_000 },
    ]);
  });
});

describe('app.record_voice_session', () => {
  it('refuses everyone but the platform', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const id = newId();
    await open(exec, id);
    for (const who of [exec, principalFor('general_manager', [1])]) {
      expect(
        await failure(
          rows(
            who,
            sql`select * from app.record_voice_session(${id}::uuid, now(), 3, 100, null, null, null)`,
          ),
        ),
      ).toMatch(/voice.session.record is required/);
    }
  });

  it('only moves forward, and answers missing for an unknown session', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const id = newId();
    await open(exec, id);
    const record = (args: SQL) =>
      rows<{ outcome: string; minutes: number | null; cost_paise: number | null }>(
        workers,
        sql`select outcome, minutes, cost_paise
              from app.record_voice_session(${id}::uuid, ${args}, null, null)`,
      );
    // Spend before the end: no minutes yet.
    expect(await record(sql`null, null, 120, null`)).toEqual([
      { outcome: 'recorded', minutes: null, cost_paise: 120 },
    ]);
    // The end with no minutes given: from the times, rounded up.
    expect(await record(sql`now() + interval '61 seconds', null, null, null`)).toEqual([
      { outcome: 'recorded', minutes: 2, cost_paise: 120 },
    ]);
    // A late or repeated event lowers nothing.
    expect(await record(sql`now() + interval '1 hour', 1, 50, null`)).toEqual([
      { outcome: 'unchanged', minutes: 2, cost_paise: 120 },
    ]);
    expect(await record(sql`null, 4, 300, '{"turns": 3, "steps": {}}'::jsonb`)).toEqual([
      { outcome: 'recorded', minutes: 4, cost_paise: 300 },
    ]);
    expect(await record(sql`null, null, null, '{"turns": 2, "steps": {}}'::jsonb`)).toEqual([
      { outcome: 'unchanged', minutes: 4, cost_paise: 300 },
    ]);
    expect(await session(id)).toMatchObject({ turn_stats_json: { turns: 3, steps: {} } });
    expect(
      await rows(
        workers,
        sql`select outcome from app.record_voice_session(${newId()}::uuid, now(), 1, 1, null, null, null)`,
      ),
    ).toEqual([{ outcome: 'missing' }]);
  });
});

describe('the files of a Teach session', () => {
  /** A vault upload of `owner`'s, as the voice worker files it for the person. */
  async function vaultFile(owner: string): Promise<string> {
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
               values (${id}, 1, 'knowledge', 'test', ${`1/knowledge/${id}.wav`}, 'teach.wav', 'audio/wav', 1,
                       ${'e'.repeat(64)}, 'ready', ${owner})`,
    );
    return id;
  }

  const link = (session: string, audio: string, transcript: string) =>
    rows<{ outcome: string; files_linked: boolean }>(
      workers,
      sql`select outcome, files_linked from app.record_voice_session(${session}::uuid, null, null,
                                                                      null, null, ${audio}::uuid,
                                                                      ${transcript}::uuid)`,
    );

  it("links the person's own vault files once, and only with the recording answer", async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const recorded = newId();
    await open(exec, recorded);
    const [audio, transcript] = [await vaultFile(exec.id), await vaultFile(exec.id)];
    // Another person's file is never linked.
    const other = await createTestPrincipal('executive', [1]);
    expect(await link(recorded, await vaultFile(other.id), transcript)).toEqual([
      { outcome: 'recorded', files_linked: false },
    ]);
    const before = await asMigrator(
      (m) => m<{ audio_file_id: string | null; transcript_file_id: string | null }[]>`
        select audio_file_id, transcript_file_id from voice_sessions where id = ${recorded}`,
    );
    expect(before).toEqual([{ audio_file_id: null, transcript_file_id: transcript }]);
    expect(await link(recorded, audio, await vaultFile(exec.id))).toEqual([
      { outcome: 'recorded', files_linked: true },
    ]);
    // Never replaced.
    expect(await link(recorded, await vaultFile(exec.id), await vaultFile(exec.id))).toEqual([
      { outcome: 'unchanged', files_linked: true },
    ]);
    // A session without the recording answer keeps no file.
    const unrecorded = newId();
    await rows(
      exec,
      sql`select * from app.voice_session_open(${unrecorded}::uuid, '{1}'::smallint[], 'teach',
                                               false, 30, 20000, 15)`,
    );
    expect(await link(unrecorded, await vaultFile(exec.id), await vaultFile(exec.id))).toEqual([
      { outcome: 'unchanged', files_linked: false },
    ]);
  });
});

describe('a request acting through a voice session', () => {
  it('writes audit rows only as the session, with its person beside it', async () => {
    const voice = await createTestVoicePrincipal('executive', [1]);
    const sessionId = voice.voiceSessionId ?? '';
    const insert = (who: Principal, actor: string, kind: string, onBehalfOf: string | null) =>
      rows(
        who,
        sql`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind,
                                    on_behalf_of_user_id, command, outcome, request_id)
            values (${newId()}, 1, ${actor}, ${kind}, ${onBehalfOf}, 'voice.test', 'ok', ${newId()})`,
      );
    await insert(voice, sessionId, 'voice_session', voice.id);
    expect(await failure(insert(voice, voice.id, 'user', null))).toMatch(/row-level security/);
    expect(await failure(insert(voice, sessionId, 'voice_session', null))).toMatch(
      /row-level security/,
    );
    // Another person's session, named by this person's request, writes nothing.
    const other = await createTestVoicePrincipal('executive', [1]);
    const borrowed: Principal = { ...voice, voiceSessionId: other.voiceSessionId ?? '' };
    expect(
      await failure(insert(borrowed, other.voiceSessionId ?? '', 'voice_session', voice.id)),
    ).toMatch(/row-level security/);
    // A person's own request still writes rows as themselves only.
    const person = await createTestPrincipal('executive', [1]);
    await insert(person, person.id, 'user', null);
    expect(await failure(insert(person, sessionId, 'voice_session', person.id))).toMatch(
      /row-level security/,
    );
  });

  it('is no person to the merge definers', async () => {
    const voice = await createTestVoicePrincipal('executive', [1]);
    const person = await createTestPrincipal('executive', [1]);
    const ask = (who: Principal) =>
      rows<{ ok: boolean }>(who, sql`select app.request_is_person() as ok`);
    expect(await ask(person)).toEqual([{ ok: true }]);
    expect(await ask(voice)).toEqual([{ ok: false }]);
  });
});
