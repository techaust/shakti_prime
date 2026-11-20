import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  whatsappChannel,
  whatsappCustomer,
  whatsappMediaMessage,
  whatsappMediaState,
  withoutContext,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '../../src/testing/index';

// W2 WhatsApp media retention (docs/03-roadmap-appendix/phase2.md §11, BLUEPRINT §7.9): only the
// platform's messaging.media.expire reaches the four definers, which no person's role or agent
// holds; the removal touches only a media message older than the period whose WhatsApp file no
// other record uses (found through the catalogue's foreign keys to files), writes the summary
// once, and records every batch in retention_runs. The suites never clean these tables, so every
// row here is found by this run's own ids.

afterAll(closeDb);

const YEARS = 3;
const DAY = 86_400_000;
/** A day past the three years, and a day inside them. */
const old = () => new Date(Date.now() - (YEARS * 365 + 2) * DAY);
const recent = () => new Date(Date.now() - (YEARS * 365 - 2) * DAY);

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

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

const uuids = (ids: readonly string[]) => `{${ids.join(',')}}`;

function due(principal: Principal, entityId = 1, limit = 500) {
  return rows<{ message_id: string; file_id: string; in_use: boolean; message_at: string }>(
    principal,
    sql`select * from app.whatsapp_media_due(${entityId}::smallint, ${YEARS}::integer, null, null,
                                            ${limit}::integer)`,
  );
}

function expire(principal: Principal, messageIds: readonly string[], entityId = 1, failed = 0) {
  return rows<{ result: { removed: { messageId: string; fileId: string }[]; inUse: number } }>(
    principal,
    sql`select app.whatsapp_expire_media(${entityId}::smallint, ${YEARS}::integer,
                                         ${uuids(messageIds)}::uuid[], ${failed}::integer) as result`,
  );
}

function kept(principal: Principal, keys: readonly string[], entityId = 1) {
  return rows<{ k: string }>(
    principal,
    sql`select k from app.whatsapp_media_keys_kept(${entityId}::smallint, 'memory',
                                                   ${`{${keys.join(',')}}`}::text[]) as k`,
  );
}

let channel1: WhatsAppChannelFixture;
let customer: WhatsAppCustomerFixture;
let exec1: Principal;
let gm1: Principal;
let concierge: Principal;

beforeAll(async () => {
  channel1 = await whatsappChannel(1);
  customer = await whatsappCustomer(1);
  exec1 = await createTestPrincipal('executive', [1]);
  gm1 = await createTestPrincipal('general_manager', [1]);
  concierge = principalFor('agent:concierge', [1]);
});

describe('messaging.media.expire is the platform’s alone', () => {
  it('is platform-only, held by the worker principal and no other role', async () => {
    const [list] = await withoutContext<{ keys: string[] }>(
      sql`select app.platform_only_permissions() as keys`,
    );
    expect(list?.keys).toContain('messaging.media.expire');
    // The keys before it stay platform-only.
    expect(list?.keys).toEqual(
      expect.arrayContaining([
        'messaging.process',
        'sales.quote.accept.remote',
        'voice.session.record',
      ]),
    );
    const holders = await asMigrator(
      (m) => m<{ key: string }[]>`
        select r.key from role_permissions rp join roles r on r.id = rp.role_id
         where rp.permission_key = 'messaging.media.expire'`,
    );
    expect(holders.map((h) => h.key)).toEqual(['system:workers']);
  });

  it('refuses every definer to a caller without it, and a company outside the request', async () => {
    const media = await whatsappMediaMessage(channel1, customer, { at: old() });
    for (const who of [exec1, gm1, customer.owner, concierge]) {
      expect(await failure(due(who))).toMatch(/messaging.media.expire is required/);
      expect(await failure(expire(who, [media.messageId]))).toMatch(
        /messaging.media.expire is required/,
      );
      expect(await failure(kept(who, [media.key]))).toMatch(/messaging.media.expire is required/);
      expect(
        await failure(
          rows(who, sql`select app.whatsapp_media_orphans_record(1::smallint, now(), 0, 0)`),
        ),
      ).toMatch(/messaging.media.expire is required/);
    }
    const other = workers([2]);
    expect(await failure(due(other))).toMatch(/the company is outside the request/);
    expect(await failure(expire(other, [media.messageId]))).toMatch(
      /the company is outside the request/,
    );
    expect(await failure(kept(other, [media.key]))).toMatch(/the company is outside the request/);
    expect((await whatsappMediaState(media)).fileDeletedAt).toBeNull();
  });

  it('lets no request role run the helpers the definers share', async () => {
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_function_privilege('app_user', 'app.whatsapp_media_files_in_use(uuid[], uuid[], timestamptz)', 'EXECUTE') as in_use_user,
             has_function_privilege('app_reader', 'app.whatsapp_media_files_in_use(uuid[], uuid[], timestamptz)', 'EXECUTE') as in_use_reader,
             has_function_privilege('app_user', 'app.require_media_expire(smallint)', 'EXECUTE') as require_user,
             has_function_privilege('app_reader', 'app.whatsapp_media_due(smallint, integer, timestamptz, uuid, integer)', 'EXECUTE') as due_reader,
             has_function_privilege('readonly_reporter', 'app.whatsapp_expire_media(smallint, integer, uuid[], integer)', 'EXECUTE') as expire_reporter`);
    expect(grants).toEqual({
      in_use_user: false,
      in_use_reader: false,
      require_user: false,
      due_reader: false,
      expire_reporter: false,
    });
  });
});

describe('the removal', () => {
  it('removes an old file, keeps the message’s text, writes its summary and records the batch', async () => {
    const media = await whatsappMediaMessage(channel1, customer, {
      at: old(),
      caption: 'pump nameplate',
    });
    const fresh = await whatsappMediaMessage(channel1, customer, { at: recent() });
    const found = await due(workers([1]));
    expect(found.map((r) => r.message_id)).toContain(media.messageId);
    expect(found.map((r) => r.message_id)).not.toContain(fresh.messageId);

    const before = new Date();
    // The newer message is named too: the definer checks the period itself.
    const [answer] = await expire(workers([1]), [media.messageId, fresh.messageId]);
    expect(answer?.result).toEqual({
      removed: [{ messageId: media.messageId, fileId: media.fileId }],
      inUse: 0,
    });
    const state = await whatsappMediaState(media);
    expect(state.fileId).toBe(media.fileId);
    expect(state.bodyMasked).toBe('pump nameplate');
    expect(state.fileDeletedAt).not.toBeNull();
    expect(state.mediaSummary).toEqual({
      contentType: 'image/jpeg',
      name: media.key.slice(media.key.lastIndexOf('/') + 1),
      size: 2048,
      verdict: 'passed',
      removedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/) as string,
    });
    const untouched = await whatsappMediaState(fresh);
    expect(untouched).toMatchObject({ fileDeletedAt: null, mediaSummary: null });

    // Removed once: it is due no more, and naming it again changes nothing.
    expect((await due(workers([1]))).map((r) => r.message_id)).not.toContain(media.messageId);
    const [again] = await expire(workers([1]), [media.messageId], 1, 1);
    expect(again?.result.removed).toEqual([]);
    const runs = await asMigrator(
      (m) => m<{ rows_affected: number; error: string | null }[]>`
        select rows_affected, error from retention_runs
         where job = 'whatsapp-media-expire' and started_at >= ${before}
         order by started_at`,
    );
    expect(runs).toEqual(
      expect.arrayContaining([
        { rows_affected: 1, error: null },
        { rows_affected: 0, error: 'the store refused 1 file' },
      ]),
    );
  });

  it('keeps a file another record uses: a message within the period, or any table with a key to files', async () => {
    const shared = await whatsappMediaMessage(channel1, customer, { at: old() });
    const filed = await whatsappMediaMessage(channel1, customer, { at: old() });
    // A newer message naming the first file, and a consent filed with the second as evidence.
    await asMigrator(
      (m) => m`
        insert into whatsapp_messages (id, entity_id, thread_id, direction, kind, provider_message_id,
                                       file_id, created_at)
        values (${newId()}, 1, ${shared.threadId}, 'inbound', 'media', ${`wamid.${newId()}`},
                ${shared.fileId}, ${recent()})`,
    );
    await asMigrator(
      (m) => m`
        insert into consents (id, contact_id, channel, purpose, source, text_version, given_at,
                              evidence_file_id, created_by)
        values (${newId()}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in',
                'w2-test', now(), ${filed.fileId}, ${customer.owner.id})`,
    );
    const found = await due(workers([1]));
    const inUse = new Map(found.map((r) => [r.message_id, r.in_use]));
    expect(inUse.get(shared.messageId)).toBe(true);
    expect(inUse.get(filed.messageId)).toBe(true);

    const [answer] = await expire(workers([1]), [shared.messageId, filed.messageId]);
    expect(answer?.result).toEqual({ removed: [], inUse: 2 });
    for (const media of [shared, filed]) {
      expect(await whatsappMediaState(media)).toMatchObject({
        fileDeletedAt: null,
        mediaSummary: null,
      });
    }
  });

  it('reads a batch at a time, oldest first, from the cursor', async () => {
    const other = await whatsappCustomer(3);
    const channel3 = await whatsappChannel(3);
    const base = old().getTime() - 400 * DAY;
    const media = [];
    for (let i = 0; i < 3; i += 1) {
      media.push(await whatsappMediaMessage(channel3, other, { at: new Date(base + i * 1000) }));
    }
    const ids = media.map((m) => m.messageId);
    const seen: string[] = [];
    let after: { at: string; id: string } | null = null;
    for (let page = 0; page < 50; page += 1) {
      const cursor: { at: string; id: string } | null = after;
      const batch: { message_id: string; message_at: string }[] = await rows<{
        message_id: string;
        message_at: string;
      }>(
        workers([3]),
        sql`select * from app.whatsapp_media_due(3::smallint, ${YEARS}::integer,
                                                ${cursor?.at ?? null}::timestamptz,
                                                ${cursor?.id ?? null}::uuid, 1)`,
      );
      const [row] = batch;
      if (!row) break;
      seen.push(row.message_id);
      after = { at: row.message_at, id: row.message_id };
    }
    const mine = seen.filter((id) => ids.includes(id));
    expect(mine).toEqual(ids);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('the media summary', () => {
  it('is written by no one else: never on a new message, never changed once written', async () => {
    const media = await whatsappMediaMessage(channel1, customer, { at: old() });
    expect(
      await failure(
        asMigrator(
          (m) => m`
            insert into whatsapp_messages (id, entity_id, thread_id, direction, kind,
                                           provider_message_id, file_id, media_summary)
            values (${newId()}, 1, ${media.threadId}, 'inbound', 'media', ${`wamid.${newId()}`},
                    ${media.fileId}, '{"name": "forged"}'::jsonb)`,
        ),
      ),
    ).toMatch(/written with no media summary/);
    await expire(workers([1]), [media.messageId]);
    expect(
      await failure(
        asMigrator(
          (m) => m`
            update whatsapp_messages set media_summary = '{"name": "changed"}'::jsonb
             where id = ${media.messageId}`,
        ),
      ),
    ).toMatch(/stays as it was written/);
    // A request role writes no message but a queued one, and never a summary.
    const [grants] = await withoutContext<Record<string, boolean>>(sql`
      select has_table_privilege('app_user', 'whatsapp_messages', 'UPDATE') as user_update,
             has_table_privilege('app_reader', 'whatsapp_messages', 'UPDATE') as reader_update`);
    expect(grants).toEqual({ user_update: false, reader_update: false });
  });
});

describe('the keys no file names', () => {
  it('keeps a key a file names and every key of a file in its checks, and no other', async () => {
    const ready = await whatsappMediaMessage(channel1, customer, { at: recent() });
    const checking = await whatsappMediaMessage(channel1, customer, {
      at: recent(),
      contentType: 'application/pdf',
      status: 'scanning',
    });
    const stray = `1/whatsapp_media/${newId()}.jpg`;
    const leftOriginal = ready.key.replace(/\.jpg$/, '-old.jpg');
    const page = checking.key.replace(/\.pdf$/, '-checked/p0001.jpg');
    const outside = `1/knowledge/${newId()}.pdf`;
    const answer = await kept(workers([1]), [ready.key, stray, leftOriginal, page, outside]);
    expect(answer.map((r) => r.k).sort()).toEqual([outside, page, ready.key].sort());

    // A removed file names its key no more.
    const media = await whatsappMediaMessage(channel1, customer, { at: old() });
    await expire(workers([1]), [media.messageId]);
    expect(await kept(workers([1]), [media.key])).toEqual([]);
  });

  it('records each sweep in retention_runs', async () => {
    const before = new Date();
    await rows(
      workers([1]),
      sql`select app.whatsapp_media_orphans_record(1::smallint, ${before.toISOString()}::timestamptz, 2, 1)`,
    );
    const runs = await asMigrator(
      (m) => m<{ rows_affected: number; error: string | null }[]>`
        select rows_affected, error from retention_runs
         where job = 'whatsapp-media-orphans' and finished_at >= ${before}`,
    );
    expect(runs).toContainEqual({ rows_affected: 2, error: 'the store refused 1 key' });
  });
});
