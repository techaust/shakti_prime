import { newId } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { closeWebhookDb, storeWebhookDelivery } from '../../src/webhook-client';
import {
  asMigrator,
  asPrincipal,
  asWebhookReceiver,
  closeDb,
  PLATFORM_TABLES,
  principalFor,
  withoutContext,
} from '../../src/testing/index';

afterAll(async () => {
  await closeWebhookDb();
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

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

/** A stored delivery of its own, with a provider event id no other run uses. */
async function delivery(provider = 'livekit'): Promise<string> {
  const payload = { id: `EV_${newId()}`, event: 'room_started' };
  const stored = await storeWebhookDelivery(provider, payload.id, payload, sha(payload.id));
  return stored.inboxId;
}

interface Row {
  processed_at: Date | null;
  failed_at: Date | null;
  error_code: string | null;
  attempts: number;
  claimed_until: Date | null;
  entity_id: number | null;
  payload_json: unknown;
}

async function row(id: string): Promise<Row | undefined> {
  const [r] = await asMigrator(
    (m) => m<Row[]>`select processed_at, failed_at, error_code, attempts, claimed_until, entity_id,
                           payload_json
                      from webhook_inbox where id = ${id}`,
  );
  return r;
}

const workers = principalFor('system:workers', []);
const executive = principalFor('executive');

interface Claim {
  provider: string;
  payload: unknown;
  attempts: number;
  lease: string | null;
  error_code: string | null;
}

function claim(id: string, principal = workers): Promise<Claim[]> {
  return asPrincipal(
    principal,
    async ({ tx }) =>
      (await tx.execute(
        sql`select * from app.webhook_claim(${id}::uuid, 60)`,
      )) as unknown as Claim[],
  );
}

async function mark(
  id: string,
  lease: string | null,
  outcome: 'processed' | 'failed' | 'released',
  code: string | null = null,
  entity: number | null = null,
): Promise<boolean> {
  return asPrincipal(workers, async ({ tx }) => {
    const [r] = (await tx.execute(
      sql`select app.webhook_mark(${id}::uuid, ${lease}, ${outcome}, ${code},
                                  ${entity}::smallint) as changed`,
    )) as unknown as { changed: boolean }[];
    return r?.changed === true;
  });
}

const REQUEST_ROLES = [
  'app_user',
  'app_reader',
  'auth_service',
  'outbox_publisher',
  'readonly_reporter',
  'webhook_receiver',
];

describe('webhook_inbox (docs/03-roadmap-appendix/phase2.md §5.1)', () => {
  it('is a platform table that no request role may read or write', async () => {
    expect(PLATFORM_TABLES).toContain('webhook_inbox');
    for (const role of REQUEST_ROLES) {
      const [p] = await withoutContext<Record<string, boolean>>(sql`
        select has_any_column_privilege(${role}, 'webhook_inbox', 'SELECT') as s,
               has_any_column_privilege(${role}, 'webhook_inbox', 'INSERT') as i,
               has_any_column_privilege(${role}, 'webhook_inbox', 'UPDATE') as u,
               has_table_privilege(${role}, 'webhook_inbox', 'DELETE') as d,
               has_table_privilege(${role}, 'webhook_inbox', 'TRUNCATE') as t`);
      expect(p, role).toEqual({ s: false, i: false, u: false, d: false, t: false });
    }
    expect(
      await failure(
        asPrincipal(executive, ({ tx }) => tx.execute(sql`select * from webhook_inbox`)),
      ),
    ).toMatch(/permission denied/);
  });

  it('keeps a row as it arrived, the owner included, and removes one only through the purge', async () => {
    const id = await delivery();
    expect(
      await failure(
        asMigrator((m) => m`update webhook_inbox set provider = 'meta_leadgen' where id = ${id}`),
      ),
    ).toMatch(/only the delivery and purge columns/);
    expect(
      await failure(
        asMigrator((m) => m`update webhook_inbox set payload_json = '{"x":1}' where id = ${id}`),
      ),
    ).toMatch(/only ever removed/);
    expect(await failure(asMigrator((m) => m`delete from webhook_inbox where id = ${id}`))).toMatch(
      /only by the purge/,
    );
    expect(
      await failure(asMigrator((m) => m`update webhook_inbox set attempts = -1 where id = ${id}`)),
    ).toMatch(/counted up|webhook_inbox_attempts_check/);
  });

  it('refuses a failed signature, an unknown provider and a malformed checksum at the table', async () => {
    const insert = (provider: string, hash: string, ok = true) =>
      asMigrator(
        (m) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                            payload_sha256, signature_ok)
                 values (${newId()}, ${provider}, ${newId()}, '{}'::jsonb, ${hash}, ${ok})`,
      );
    expect(await failure(insert('livekit', sha('x'), false))).toMatch(
      /webhook_inbox_signature_check/,
    );
    expect(await failure(insert('twilio', sha('x')))).toMatch(/webhook_inbox_provider_check/);
    expect(await failure(insert('livekit', 'not-a-hash'))).toMatch(/webhook_inbox_sha256_check/);
  });
});

describe('webhook_receiver (the routes’ login role)', () => {
  it('logs in, is no superuser, cannot bypass RLS and gives up after two seconds', async () => {
    const [r] = await withoutContext(sql`
      select r.rolcanlogin as login, r.rolsuper as super, r.rolbypassrls as bypass,
             r.rolcreaterole as createrole, r.rolcreatedb as createdb,
             (select array_agg(s order by s) from pg_db_role_setting d, unnest(d.setconfig) s
               where d.setrole = r.oid) as settings
        from pg_roles r where r.rolname = 'webhook_receiver'`);
    expect(r).toEqual({
      login: true,
      super: false,
      bypass: false,
      createrole: false,
      createdb: false,
      settings: [
        'idle_in_transaction_session_timeout=30s',
        'lock_timeout=1s',
        'statement_timeout=2s',
      ],
    });
  });

  it('may execute app.webhook_receive() and no other definer, and holds no table or sequence', async () => {
    const definers = await withoutContext<{ fn: string }>(sql`
      select p.oid::regprocedure::text as fn
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where p.prosecdef and n.nspname in ('app', 'public')
         and has_function_privilege('webhook_receiver', p.oid, 'EXECUTE')`);
    expect(definers.map((d) => d.fn)).toEqual(['app.webhook_receive(text,text,jsonb,text)']);
    const [held] = await withoutContext<{ tables: number; sequences: number }>(sql`
      select (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in ('public', 'app', 'audit_partitions', 'audit_archive', 'drizzle') and c.relkind in ('r', 'p', 'v', 'm')
                 and has_any_column_privilege('webhook_receiver', c.oid, 'SELECT, INSERT, UPDATE')) as tables,
             (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
               where n.nspname in ('public', 'app', 'audit_partitions', 'audit_archive', 'drizzle')
                 and case when c.relkind = 'S'
                          then has_sequence_privilege('webhook_receiver', c.oid, 'USAGE, SELECT, UPDATE')
                          else false end) as sequences`);
    expect(held).toEqual({ tables: 0, sequences: 0 });
  });

  it('stores a delivery once: a repeat answers the same row, which is processed once', async () => {
    const eventId = `EV_${newId()}`;
    const payload = { id: eventId, event: 'room_finished' };
    const first = await storeWebhookDelivery('livekit', eventId, payload, sha(eventId));
    const again = await storeWebhookDelivery('livekit', eventId, payload, sha(eventId));
    expect(first.repeated).toBe(false);
    expect(again).toEqual({ inboxId: first.inboxId, repeated: true });
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from webhook_inbox
                                 where provider = 'livekit' and provider_event_id = ${eventId}`,
    );
    expect(count?.n).toBe(1);
    // The same event id from another provider is another delivery.
    const other = await storeWebhookDelivery('meta_leadgen', eventId, payload, sha(eventId));
    expect(other.inboxId).not.toBe(first.inboxId);
    // Processed once: the second claim finds the row taken, and after processing nothing at all.
    const [lease] = await claim(first.inboxId);
    expect(await claim(first.inboxId)).toEqual([]);
    expect(await mark(first.inboxId, lease?.lease ?? '', 'processed')).toBe(true);
    expect(await claim(first.inboxId)).toEqual([]);
    expect((await row(first.inboxId))?.attempts).toBe(1);
  });

  it('reads nothing and calls nothing else, its own rows included', async () => {
    const id = await delivery();
    await asWebhookReceiver(async (r) => {
      expect(await failure(r`select count(*) from webhook_inbox`)).toMatch(/permission denied/);
      expect(await failure(r`select * from app.webhook_claim(${id}::uuid, 60)`)).toMatch(
        /permission denied/,
      );
      expect(await failure(r`select * from app.webhook_health(10)`)).toMatch(/permission denied/);
      expect(await failure(r`select count(*) from entities`)).toMatch(/permission denied/);
    });
  });
});

describe('the worker’s definers (webhooks.process, platform-only)', () => {
  const SIGNATURES = [
    'app.webhook_claim(uuid,integer)',
    'app.webhook_mark(uuid,text,text,text,smallint)',
    'app.webhook_waiting(integer,integer)',
    'app.webhook_purge(integer,integer,integer)',
    'app.webhook_replay(uuid)',
  ];

  it('are callable by app_user alone', async () => {
    for (const fn of SIGNATURES) {
      const [g] = await withoutContext<Record<string, boolean>>(sql`
        select has_function_privilege('app_user', ${fn}, 'execute') as app,
               has_function_privilege('app_reader', ${fn}, 'execute') as reader,
               has_function_privilege('auth_service', ${fn}, 'execute') as auth,
               has_function_privilege('outbox_publisher', ${fn}, 'execute') as outbox,
               has_function_privilege('webhook_receiver', ${fn}, 'execute') as receiver,
               has_function_privilege('readonly_reporter', ${fn}, 'execute') as reporter,
               has_function_privilege('public', ${fn}, 'execute') as pub`);
      expect(g, fn).toEqual({
        app: true,
        reader: false,
        auth: false,
        outbox: false,
        receiver: false,
        reporter: false,
        pub: false,
      });
    }
  });

  it('webhooks.process is platform-only and held by the workers alone', async () => {
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('webhooks.process');
    const [held] = await asMigrator(
      (m) => m<{ roles: string[] }[]>`
        select coalesce(array_agg(r.key order by r.key), '{}') as roles
          from role_permissions rp join roles r on r.id = rp.role_id
         where rp.permission_key = 'webhooks.process'`,
    );
    expect(held?.roles).toEqual(['system:workers']);
  });

  it('refuses every person and agent, the Executive included', async () => {
    const id = await delivery();
    for (const role of ['executive', 'general_manager', 'agent:triage'] as const) {
      const principal = principalFor(role);
      expect(await failure(claim(id, principal)), role).toMatch(/webhooks\.process/);
      expect(
        await failure(
          asPrincipal(principal, ({ tx }) =>
            tx.execute(sql`select app.webhook_mark(${id}::uuid, null, 'failed', 'x', null)`),
          ),
        ),
        role,
      ).toMatch(/webhooks\.process/);
      expect(
        await failure(
          asPrincipal(principal, ({ tx }) =>
            tx.execute(sql`select * from app.webhook_purge(30, 90, 10)`),
          ),
        ),
        role,
      ).toMatch(/webhooks\.process/);
    }
  });

  it('marks only under the caller’s lease, and records the company the handler named', async () => {
    const id = await delivery();
    const [lease] = await claim(id);
    expect(lease).toMatchObject({ provider: 'livekit', attempts: 1 });
    expect((lease?.payload as { event: string }).event).toBe('room_started');
    expect(await mark(id, '2001-01-01 00:00:00+00', 'processed')).toBe(false);
    expect(await mark(id, null, 'processed').catch(() => 'refused')).toBe('refused');
    expect(await mark(id, lease?.lease ?? '', 'processed', null, 2)).toBe(true);
    expect(await row(id)).toMatchObject({ entity_id: 2, error_code: null, claimed_until: null });
    // A processed row stays processed, even for the owner.
    expect(
      await failure(
        asMigrator((m) => m`update webhook_inbox set processed_at = null where id = ${id}`),
      ),
    ).toMatch(/stays processed/);
  });

  it('a row no handler takes is processed with its code', async () => {
    const id = await delivery('exotel_incoming');
    const [lease] = await claim(id);
    expect(await mark(id, lease?.lease ?? '', 'processed', 'no_handler')).toBe(true);
    expect(await row(id)).toMatchObject({ error_code: 'no_handler', failed_at: null });
  });

  it('fails an unreadable row for good: no claim takes it again', async () => {
    const id = await delivery('meta_whatsapp');
    const [lease] = await claim(id);
    expect(await mark(id, lease?.lease ?? '', 'failed', 'payload_unreadable')).toBe(true);
    expect(await claim(id)).toEqual([]);
    expect(await row(id)).toMatchObject({ error_code: 'payload_unreadable', attempts: 1 });
  });

  it('a released row waits a backoff that grows with its tries; the failure callback needs no live lease', async () => {
    const id = await delivery();
    const [first] = await claim(id);
    expect(await mark(id, null, 'failed', 'handler_failed')).toBe(false);
    expect(await mark(id, first?.lease ?? '', 'released')).toBe(true);
    // In its backoff: no claim takes it, and it is not leased.
    expect(await claim(id)).toEqual([]);
    const backoff = async () => {
      const [r] = await asMigrator(
        (m) => m<{ minutes: number; leased: boolean }[]>`
          select round(extract(epoch from retry_at - now()) / 60)::int as minutes,
                 claimed_until is not null as leased
            from webhook_inbox where id = ${id}`,
      );
      return r;
    };
    expect(await backoff()).toEqual({ minutes: 1, leased: false });
    const minutes: number[] = [];
    for (let n = 2; n <= 7; n += 1) {
      await asMigrator((m) => m`update webhook_inbox set retry_at = now() where id = ${id}`);
      const [next] = await claim(id);
      expect(next?.attempts).toBe(n);
      await mark(id, next?.lease ?? '', 'released');
      minutes.push((await backoff())?.minutes ?? -1);
    }
    // 1 minute after the first try, then 2, 4, 8 and 16, then 30 at most.
    expect(minutes).toEqual([2, 4, 8, 16, 30, 30]);
    // QStash's failure callback may fail a released row: no live lease holds it.
    expect(await mark(id, null, 'failed', 'handler_failed')).toBe(true);
    expect(await row(id)).toMatchObject({ error_code: 'handler_failed', attempts: 7 });
  });

  it('fails a row tried ten times instead of trying it again, and says so', async () => {
    const id = await delivery();
    await asMigrator((m) => m`update webhook_inbox set attempts = 10 where id = ${id}`);
    expect(await claim(id)).toEqual([
      {
        provider: 'livekit',
        payload: null,
        attempts: 10,
        lease: null,
        error_code: 'too_many_attempts',
      },
    ]);
    expect(await row(id)).toMatchObject({ error_code: 'too_many_attempts' });
    expect(await claim(id)).toEqual([]);
  });

  it('Process again counts ten tries afresh: a row failed after ten tries is processed', async () => {
    const id = await delivery();
    await asMigrator((m) => m`update webhook_inbox set attempts = 10 where id = ${id}`);
    await claim(id);
    const replay = async () => {
      const [r] = await asPrincipal(
        executive,
        async ({ tx }) =>
          (await tx.execute(sql`select * from app.webhook_replay(${id}::uuid)`)) as unknown as {
            attempts: number;
            error_code: string;
          }[],
      );
      return r;
    };
    expect(await replay()).toMatchObject({ attempts: 10, error_code: 'too_many_attempts' });
    const [again] = await claim(id);
    expect(again).toMatchObject({ attempts: 11, error_code: null });
    expect(again?.lease).not.toBeNull();
    // It fails once more, and a second Process again names a later attempt, so a new delivery.
    await mark(id, again?.lease ?? '', 'failed', 'payload_unreadable');
    expect(await replay()).toMatchObject({ attempts: 11, error_code: 'payload_unreadable' });
    const [third] = await claim(id);
    expect(await mark(id, third?.lease ?? '', 'processed')).toBe(true);
    expect(await row(id)).toMatchObject({ attempts: 12, failed_at: null });
    // attempts_at_replay only rises, and never past the attempts.
    expect(
      await failure(
        asMigrator((m) => m`update webhook_inbox set attempts_at_replay = 0 where id = ${id}`),
      ),
    ).toMatch(/counted up/);
    expect(
      await failure(
        asMigrator((m) => m`update webhook_inbox set attempts_at_replay = 99 where id = ${id}`),
      ),
    ).toMatch(/webhook_inbox_attempts_at_replay_check/);
  });

  it('lists for the sweep only the rows no delivery is on its way to', async () => {
    const [unclaimed, live, lapsed, inBackoff, backoffOver, justArrived] = [
      newId(),
      newId(),
      newId(),
      newId(),
      newId(),
      newId(),
    ];
    await asMigrator(
      (m) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                          payload_sha256, received_at, attempts, claimed_until,
                                          retry_at)
               values (${unclaimed}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(unclaimed)},
                       now() - interval '5 minutes', 0, null, null),
                      (${live}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(live)},
                       now() - interval '5 minutes', 1, now() + interval '30 seconds', null),
                      (${lapsed}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(lapsed)},
                       now() - interval '5 minutes', 1, now() - interval '2 minutes', null),
                      (${inBackoff}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(inBackoff)},
                       now() - interval '5 minutes', 2, null, now() + interval '3 minutes'),
                      (${backoffOver}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(backoffOver)},
                       now() - interval '20 minutes', 4, null, now() - interval '2 minutes'),
                      (${justArrived}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(justArrived)},
                       now(), 0, null, null)`,
    );
    const ids = await asPrincipal(workers, async ({ tx }) =>
      (
        (await tx.execute(sql`select inbox_id from app.webhook_waiting(60, 500)`)) as unknown as {
          inbox_id: string;
        }[]
      ).map((r) => r.inbox_id),
    );
    expect(ids).toEqual(expect.arrayContaining([unclaimed, lapsed, backoffOver]));
    for (const id of [live, inBackoff, justArrived]) expect(ids).not.toContain(id);
  });

  it('removes payloads 30 days after processing, and only finished rows 90 days after arrival', async () => {
    const recent = newId();
    const oldPayload = newId();
    const oldProcessed = newId();
    const oldFailed = newId();
    const oldWaiting = newId();
    const oldLeased = newId();
    await asMigrator(
      (m) => m`insert into webhook_inbox (id, provider, provider_event_id, payload_json,
                                          payload_sha256, received_at, processed_at, failed_at,
                                          error_code, attempts, claimed_until)
               values (${recent}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(recent)},
                       now() - interval '29 days', now() - interval '29 days', null, null, 1, null),
                      (${oldPayload}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(oldPayload)},
                       now() - interval '40 days', now() - interval '31 days', null, null, 1, null),
                      (${oldProcessed}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(oldProcessed)},
                       now() - interval '91 days', now() - interval '91 days', null, null, 1, null),
                      (${oldFailed}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(oldFailed)},
                       now() - interval '91 days', null, now() - interval '91 days',
                       'payload_unreadable', 1, null),
                      (${oldWaiting}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(oldWaiting)},
                       now() - interval '91 days', null, null, null, 0, null),
                      (${oldLeased}, 'livekit', ${newId()}, '{}'::jsonb, ${sha(oldLeased)},
                       now() - interval '91 days', null, null, null, 1, now() + interval '1 minute')`,
    );
    const purge = async () => {
      const [r] = await asPrincipal(
        workers,
        async ({ tx }) =>
          (await tx.execute(sql`select * from app.webhook_purge(30, 90, 5000)`)) as unknown as {
            payloads: number;
            rows_removed: number;
          }[],
      );
      return r;
    };
    const runs = () =>
      asMigrator(
        (m) => m<{ n: number }[]>`select count(*)::int as n from retention_runs
                                    where job = 'webhook-inbox-purge'`,
      ).then((r) => r[0]?.n ?? 0);
    const before = await runs();
    const run = await purge();
    expect(run?.payloads).toBeGreaterThanOrEqual(1);
    expect(run?.rows_removed).toBeGreaterThanOrEqual(2);
    expect((await row(recent))?.payload_json).toEqual({});
    expect((await row(oldPayload))?.payload_json).toBeNull();
    expect(await row(oldProcessed)).toBeUndefined();
    expect(await row(oldFailed)).toBeUndefined();
    // A row still waiting, or leased, is never removed, whatever its age.
    expect(await row(oldWaiting)).toBeDefined();
    expect(await row(oldLeased)).toBeDefined();
    // A purged row is never processed: its payload is gone.
    expect(await claim(oldPayload)).toEqual([]);
    // One run row for the call that removed something; none for a call that found nothing.
    expect(await runs()).toBe(before + 1);
    const [recorded] = await asMigrator(
      (m) => m<{ error: string | null; rows: number }[]>`
        select error, rows_affected as rows from retention_runs
         where job = 'webhook-inbox-purge' order by started_at desc limit 1`,
    );
    expect(recorded?.error).toBeNull();
    expect(recorded?.rows).toBeGreaterThanOrEqual(3);
    await asMigrator(
      (m) => m`update webhook_inbox set claimed_until = null, processed_at = now(), attempts = 1
                where id in (${oldWaiting}, ${oldLeased})`,
    );
    await purge();
    const quiet = await runs();
    expect(await purge()).toEqual({ payloads: 0, rows_removed: 0 });
    expect(await runs()).toBe(quiet);
    expect(
      await failure(
        asPrincipal(workers, ({ tx }) =>
          tx.execute(sql`select * from app.webhook_purge(0, 90, 10)`),
        ),
      ),
    ).toMatch(/at least one/);
  });

  it('two stores of one delivery at once make one row, and two claims of it one lease', async () => {
    const eventId = `EV_${newId()}`;
    const payload = { id: eventId, event: 'room_started' };
    const stored = await Promise.all(
      Array.from({ length: 4 }, () =>
        storeWebhookDelivery('livekit', eventId, payload, sha(eventId)),
      ),
    );
    expect(new Set(stored.map((s) => s.inboxId)).size).toBe(1);
    expect(stored.filter((s) => !s.repeated)).toHaveLength(1);
    const [count] = await asMigrator(
      (m) => m<{ n: number }[]>`select count(*)::int as n from webhook_inbox
                                 where provider = 'livekit' and provider_event_id = ${eventId}`,
    );
    expect(count?.n).toBe(1);
    const id = stored[0]?.inboxId ?? '';
    const claims = await Promise.all(Array.from({ length: 4 }, () => claim(id)));
    expect(claims.flat().filter((c) => c.lease !== null)).toHaveLength(1);
    expect((await row(id))?.attempts).toBe(1);
  });
});

describe('Integration Health and Process again', () => {
  it('app.webhook_health() answers every provider and the failed rows to the Executive alone', async () => {
    const id = await delivery('google_leadform');
    const [lease] = await claim(id);
    await mark(id, lease?.lease ?? '', 'failed', 'payload_unreadable');
    const health = await asPrincipal(executive, async ({ tx }) => {
      const [r] = (await tx.execute(sql`select app.webhook_health(50) as h`)) as unknown as {
        h: {
          providers: { provider: string; failed24h: number }[];
          failed: { total: number; items: { inboxId: string; errorCode: string }[] };
        };
      }[];
      return r?.h;
    });
    expect(health?.providers.map((p) => p.provider)).toEqual([
      'meta_whatsapp',
      'meta_leadgen',
      'google_leadform',
      'exotel_status',
      'exotel_incoming',
      'livekit',
    ]);
    expect(health?.providers[2]?.failed24h).toBeGreaterThanOrEqual(1);
    expect(health?.failed.items[0]).toMatchObject({ inboxId: id, errorCode: 'payload_unreadable' });
    expect(JSON.stringify(health)).not.toContain('payload_json');
    for (const role of ['general_manager', 'accounts', 'system:workers', 'agent:triage'] as const) {
      expect(
        await failure(
          asPrincipal(principalFor(role), ({ tx }) =>
            tx.execute(sql`select app.webhook_health(50)`),
          ),
        ),
        role,
      ).toMatch(/admin\.integrations\.write/);
    }
    const [reader] = await withoutContext<{ ok: boolean }>(
      sql`select has_function_privilege('app_reader', 'app.webhook_health(integer)', 'execute') as ok`,
    );
    expect(reader?.ok).toBe(true);
  });

  it('Process again clears a failure once; a row that has not failed answers nothing', async () => {
    const id = await delivery('meta_leadgen');
    const [lease] = await claim(id);
    await mark(id, lease?.lease ?? '', 'failed', 'payload_unreadable');
    const replay = (principal = executive) =>
      asPrincipal(
        principal,
        async ({ tx }) =>
          (await tx.execute(sql`select * from app.webhook_replay(${id}::uuid)`)) as unknown as {
            provider: string;
            attempts: number;
            error_code: string | null;
          }[],
      );
    expect(await failure(replay(principalFor('general_manager')))).toMatch(
      /integrations\.dlq\.replay/,
    );
    expect(await failure(replay(workers))).toMatch(/integrations\.dlq\.replay/);
    expect(await replay()).toEqual([
      { provider: 'meta_leadgen', attempts: 1, error_code: 'payload_unreadable' },
    ]);
    expect(await replay()).toEqual([]);
    const [again] = await claim(id);
    expect(again?.attempts).toBe(2);
    expect(await mark(id, again?.lease ?? '', 'processed')).toBe(true);
    expect(await row(id)).toMatchObject({ failed_at: null, error_code: null });
  });
});
