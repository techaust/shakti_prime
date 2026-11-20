import { newId } from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  whatsappChannel,
  whatsappCustomer,
  whatsappMediaMessage,
  whatsappMediaState,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
  type WhatsAppMediaFixture,
} from '@shakti/db/testing';
import { memoryFileStore, WORKSHOP_DEFAULTS, type FileStore, type Logger } from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  mediaOrphanSweepOn,
  mediaRetentionOn,
  ORPHAN_RECHECK_DAYS,
  runNightlyRetention,
  runWhatsAppMediaRetention,
  sweepStart,
  uuidTimePrefix,
} from '../src/workers/whatsapp-media-retention';

// W2 WhatsApp media retention on real Postgres (docs/03-roadmap-appendix/phase2.md §11): the job
// removes the files of media messages older than the period from a faked store and records them,
// keeps the newer ones and those another record uses, changes nothing in a dry run, shares its
// time fairly between the companies, sweeps keys no file names from where its last good sweep
// left off, and fails when the store removes nothing it was given. This suite's files live in a
// bucket of its own, so the job passes by every other suite's rows (counted as another store's).
// Company 2 holds the rows this suite counts, which no other suite's media writes.

afterAll(closeDb);

const BUCKET = 'w2-media-web';
const DAY = 86_400_000;
const YEARS = WORKSHOP_DEFAULTS.retention.whatsappMediaYears;
const old = (days = 2) => new Date(Date.now() - (YEARS * 365 + days) * DAY);
const recent = () => new Date(Date.now() - (YEARS * 365 - 2) * DAY);

/** A UUIDv7-shaped id made at `at`, as a key's file id. */
function idAt(at: Date): string {
  return `${uuidTimePrefix(at)}${newId().slice(13)}`;
}

let store: ReturnType<typeof memoryFileStore>;
const chats = new Map<
  number,
  { channel: WhatsAppChannelFixture; customer: WhatsAppCustomerFixture }
>();

/** A media message of a customer of the company whose bytes this suite's store holds. */
async function stored(
  at: Date,
  options: {
    entityId?: 1 | 2 | 3 | 4;
    contentType?: 'image/jpeg' | 'application/pdf';
    checkedCopy?: boolean;
    fileId?: string;
  } = {},
): Promise<WhatsAppMediaFixture> {
  const chat = chats.get(options.entityId ?? 1);
  if (!chat) throw new Error('no chat');
  const media = await whatsappMediaMessage(chat.channel, chat.customer, {
    at,
    bucket: BUCKET,
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
    ...(options.checkedCopy === undefined ? {} : { checkedCopy: options.checkedCopy }),
    ...(options.fileId === undefined ? {} : { fileId: options.fileId }),
  });
  await store.put(media.key, Uint8Array.from([1, 2, 3]), options.contentType ?? 'image/jpeg');
  return media;
}

/** A key under the company's WhatsApp folder that no file names, made and stored at `at`. */
function orphanAt(entityId: number, at: Date): string {
  const key = `${String(entityId)}/whatsapp_media/${idAt(at)}.jpg`;
  store.objects.set(key, {
    bytes: Uint8Array.from([9]),
    contentType: 'image/jpeg',
    tags: {},
    storedAt: at,
  });
  return key;
}

/** A clock that moves on a fixed step at each reading, so a run's time can be spent exactly. */
function steppingClock(stepMs: number): () => Date {
  let at = Date.now();
  return () => new Date((at += stepMs));
}

async function mediaRuns(entityId: number): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`
      select count(*)::int as n from retention_runs
       where job like 'whatsapp-media-%' and entity_id = ${entityId}`,
  );
  return row?.n ?? 0;
}

const silent: Logger = { log: () => undefined };

beforeAll(async () => {
  for (const entityId of [1, 2, 3, 4] as const) {
    chats.set(entityId, {
      channel: await whatsappChannel(entityId),
      customer: await whatsappCustomer(entityId),
    });
  }
  store = memoryFileStore(BUCKET);
});

describe('the WhatsApp media retention job', () => {
  it('counts in a dry run and changes nothing, records nothing, then removes old files and keeps newer ones', async () => {
    const photo = await stored(old(), { entityId: 2 });
    // The checks stored a masked copy of the PDF beside its upload, whose original and pages a
    // failed clean-up left behind.
    const pdf = await stored(old(), {
      entityId: 2,
      contentType: 'application/pdf',
      checkedCopy: true,
    });
    const masked = pdf.key;
    const original = pdf.originalKey ?? '';
    const page = original.replace(/\.pdf$/, '-checked/p0001.jpg');
    await store.put(original, Uint8Array.from([4]), 'application/pdf');
    await store.put(page, Uint8Array.from([5]), 'image/jpeg');
    const fresh = await stored(recent(), { entityId: 2 });
    const orphan = orphanAt(2, new Date(Date.now() - 2 * DAY));

    const runsBefore = await mediaRuns(2);
    const dry = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      dryRun: true,
      logger: silent,
    });
    expect(dry).toMatchObject({ dryRun: true, done: true });
    expect(dry.removed).toBeGreaterThanOrEqual(2);
    expect(dry.orphansRemoved).toBeGreaterThanOrEqual(1);
    for (const key of [photo.key, original, masked, page, fresh.key, orphan]) {
      expect(store.objects.has(key)).toBe(true);
    }
    for (const media of [photo, pdf, fresh]) {
      expect(await whatsappMediaState(media)).toMatchObject({
        fileDeletedAt: null,
        mediaSummary: null,
      });
    }
    expect(await mediaRuns(2)).toBe(runsBefore);

    const result = await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(result).toMatchObject({ dryRun: false, failed: 0, done: true });
    expect(result.removed).toBeGreaterThanOrEqual(2);
    for (const key of [photo.key, original, masked, page, orphan]) {
      expect(store.objects.has(key)).toBe(false);
    }
    expect(store.objects.has(fresh.key)).toBe(true);
    // The same run wrote its batch and its sweep, so the count above could have moved.
    expect(await mediaRuns(2)).toBeGreaterThanOrEqual(runsBefore + 2);
    expect(await whatsappMediaState(photo)).toMatchObject({
      fileId: photo.fileId,
      mediaSummary: expect.objectContaining({
        contentType: 'image/jpeg',
        verdict: 'passed',
      }) as unknown,
    });
    expect((await whatsappMediaState(pdf)).mediaSummary).toMatchObject({
      contentType: 'application/pdf',
    });
    expect(await whatsappMediaState(fresh)).toMatchObject({
      fileDeletedAt: null,
      mediaSummary: null,
    });
  });

  it('keeps a file another record uses', async () => {
    const filed = await stored(old());
    const customer = chats.get(1)?.customer;
    if (!customer) throw new Error('no customer');
    await asMigrator(
      (m) => m`
        insert into consents (id, contact_id, channel, purpose, source, text_version, given_at,
                              evidence_file_id, created_by)
        values (${newId()}, ${customer.contactId}, 'whatsapp', 'service', 'whatsapp_opt_in',
                'w2-web-test', now(), ${filed.fileId}, ${customer.owner.id})`,
    );
    const result = await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(result.inUse).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(filed.key)).toBe(true);
    expect(await whatsappMediaState(filed)).toMatchObject({
      fileDeletedAt: null,
      mediaSummary: null,
    });
  });

  it('fails the run when the store removes nothing, never records a file removed while its bytes remain, and records the refusal', async () => {
    const stuck = await stored(old());
    const refusing: FileStore = {
      ...store,
      delete: () => Promise.reject(new Error('the store is down')),
    };
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    const before = new Date();
    await expect(
      runWhatsAppMediaRetention({
        store: refusing,
        requestId: newId(),
        orphans: false,
        logger: { log: (_level, event, fields) => lines.push({ event, fields: fields ?? {} }) },
      }),
    ).rejects.toThrow(/removed none/);
    expect(store.objects.has(stuck.key)).toBe(true);
    expect(await whatsappMediaState(stuck)).toMatchObject({
      fileDeletedAt: null,
      mediaSummary: null,
    });
    const failed = lines.find((l) => l.event === 'messaging.media_retention_delete_failed');
    expect(failed?.fields).toMatchObject({ entityId: 1, fileId: stuck.fileId });
    // Ids and counts only: no customer's number, name or words in any line.
    expect(JSON.stringify(lines)).not.toContain(chats.get(1)?.customer.waId ?? 'none');
    const runs = await asMigrator(
      (m) => m<{ error: string | null }[]>`
        select error from retention_runs
         where job = 'whatsapp-media-expire' and entity_id = 1 and started_at >= ${before}`,
    );
    expect(runs.map((r) => r.error)).toContain('the store refused 1 file');

    // The nightly call fails with it, so the failure streak counts it.
    await expect(
      runNightlyRetention(
        {},
        {
          env: { WHATSAPP_MEDIA_RETENTION: 'on' },
          store: refusing,
          logger: silent,
        },
      ),
    ).rejects.toThrow(/removed none/);

    // The next run with a working store removes it.
    await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(store.objects.has(stuck.key)).toBe(false);
  }, 120_000);

  it('shares its time between the companies, so a backlog in one never stops the others or their sweeps', async () => {
    const backlog: WhatsAppMediaFixture[] = [];
    for (let i = 0; i < 20; i += 1) backlog.push(await stored(old(10 + i)));
    const three = await stored(old(), { entityId: 3 });
    const four = await stored(old(), { entityId: 4 });
    const orphanThree = orphanAt(3, new Date(Date.now() - 2 * DAY));

    // Each reading of the clock costs 10 ms of a 600 ms run: company 1's 20 files take more than
    // its share, the other companies' one file and one key each take less.
    const first = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      budgetMs: 600,
      now: steppingClock(10),
      logger: silent,
    });
    expect(first.done).toBe(false);
    expect(store.objects.has(three.key)).toBe(false);
    expect(store.objects.has(four.key)).toBe(false);
    expect(store.objects.has(orphanThree)).toBe(false);
    const left = () => backlog.filter((m) => store.objects.has(m.key)).length;
    expect(left()).toBeGreaterThan(0);
    expect(left()).toBeLessThan(20);

    // Company 1's backlog goes on over the next runs, from the oldest file still kept.
    for (let run = 0; run < 20 && left() > 0; run += 1) {
      await runWhatsAppMediaRetention({
        store,
        requestId: newId(),
        budgetMs: 600,
        now: steppingClock(10),
        logger: silent,
      });
    }
    expect(left()).toBe(0);
  }, 120_000);
});

describe('the sweep of keys no file names', () => {
  it('starts where the last good sweep left off, or at the folder’s start when there is none', () => {
    const folder = '1/whatsapp_media/';
    expect(sweepStart(folder, null)).toBeUndefined();
    expect(
      sweepStart(folder, { startedAt: '2026-11-20T00:00:00.000000Z', resumeKey: `${folder}k` }),
    ).toBe(`${folder}k`);
    const from = Date.parse('2026-11-20T00:00:00Z') - DAY - ORPHAN_RECHECK_DAYS * DAY;
    expect(sweepStart(folder, { startedAt: '2026-11-20T00:00:00.000000Z', resumeKey: null })).toBe(
      `${folder}${uuidTimePrefix(new Date(from))}`,
    );
  });

  it('sweeps the whole folder the first time, keeps young and named keys, resumes after a stop, and covers a refused key again', async () => {
    // Company 2 with no sweep yet: the whole folder, however old its keys.
    await asMigrator(
      (m) => m`delete from retention_runs where job = 'whatsapp-media-orphans' and entity_id = 2`,
    );
    const ancient = orphanAt(2, new Date(Date.now() - 900 * DAY));
    const young = orphanAt(2, new Date(Date.now() - 3_600_000));
    // A key a file names, two days old by its id and its storing, so only its name keeps it.
    const twoDaysAgo = new Date(Date.now() - 2 * DAY);
    const named = await stored(recent(), { entityId: 2, fileId: idAt(twoDaysAgo) });
    store.objects.set(named.key, {
      bytes: Uint8Array.from([1]),
      contentType: 'image/jpeg',
      tags: {},
      storedAt: twoDaysAgo,
    });

    const whole = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      expire: false,
      logger: silent,
    });
    expect(whole.orphansRemoved).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(ancient)).toBe(false);
    expect(store.objects.has(young)).toBe(true);
    // The file row names its key, so the sweep keeps it whatever its age.
    expect(store.objects.has(named.key)).toBe(true);

    // A sweep stopped for time records where it stopped, and the next goes on after it. The
    // clock moves only when the store deletes one of company 2's keys, 100 ms each, so with a
    // second for the sweep company 2's share (a third of it) ends after its fourth deletion.
    await asMigrator(
      (m) => m`delete from retention_runs where job = 'whatsapp-media-orphans' and entity_id = 2`,
    );
    const strays = [7, 6, 5, 4, 3].map((h) =>
      orphanAt(2, new Date(Date.now() - DAY - h * 3_600_000)),
    );
    let at = Date.now();
    const slow: FileStore = {
      ...store,
      delete: async (key) => {
        if (key.startsWith('2/whatsapp_media/')) at += 100;
        await store.delete(key);
      },
    };
    await runWhatsAppMediaRetention({
      store: slow,
      requestId: newId(),
      expire: false,
      budgetMs: 1000,
      now: () => new Date(at),
      logger: silent,
    });
    const [stop] = await asMigrator(
      (m) => m<{ resume_key: string | null; rows_affected: number }[]>`
        select resume_key, rows_affected from retention_runs
         where job = 'whatsapp-media-orphans' and entity_id = 2
         order by started_at desc limit 1`,
    );
    expect(stop).toEqual({ resume_key: strays[3], rows_affected: 4 });
    expect(strays.map((k) => store.objects.has(k))).toEqual([false, false, false, false, true]);
    await runWhatsAppMediaRetention({ store, requestId: newId(), expire: false, logger: silent });
    expect(strays.filter((k) => store.objects.has(k))).toEqual([]);

    // A sweep the store refused a key in is no good sweep: the next covers that key again.
    const refused = orphanAt(2, new Date(Date.now() - 2 * DAY));
    const refusing: FileStore = {
      ...store,
      delete: (key) =>
        key === refused ? Promise.reject(new Error('the store is down')) : store.delete(key),
    };
    await runWhatsAppMediaRetention({
      store: refusing,
      requestId: newId(),
      expire: false,
      logger: silent,
    }).catch(() => undefined);
    expect(store.objects.has(refused)).toBe(true);
    await runWhatsAppMediaRetention({ store, requestId: newId(), expire: false, logger: silent });
    expect(store.objects.has(refused)).toBe(false);
  }, 120_000);

  it('removes nothing without a store', async () => {
    const lines: string[] = [];
    const result = await runWhatsAppMediaRetention({
      store: undefined,
      requestId: newId(),
      logger: { log: (_level, event) => lines.push(event) },
    });
    expect(result).toMatchObject({ removed: 0, companies: 0, done: true });
    expect(lines).toContain('messaging.media_retention_no_store');
  });
});

describe('the nightly call', () => {
  it('is switched on only by the value on, each step by its own switch', () => {
    for (const [on, name] of [
      [mediaRetentionOn, 'WHATSAPP_MEDIA_RETENTION'],
      [mediaOrphanSweepOn, 'WHATSAPP_MEDIA_ORPHAN_SWEEP'],
    ] as const) {
      expect(on({})).toBe(false);
      expect(on({ [name]: '' })).toBe(false);
      expect(on({ [name]: 'yes' })).toBe(false);
      expect(on({ [name]: ' on ' })).toBe(true);
    }
    expect(mediaRetentionOn({ WHATSAPP_MEDIA_ORPHAN_SWEEP: 'on' })).toBe(false);
  });

  it('removes nothing while both switches are off, counts in a dry run, and runs each step only with its switch', async () => {
    const photo = await stored(old());
    const orphan = orphanAt(1, new Date(Date.now() - 2 * DAY));
    const off = await runNightlyRetention({}, { env: {}, store, logger: silent });
    expect(off.done).toBe(true);
    expect(off.media).toBeUndefined();
    expect(store.objects.has(photo.key)).toBe(true);
    expect(store.objects.has(orphan)).toBe(true);

    const dry = await runNightlyRetention({ dryRun: true }, { env: {}, store, logger: silent });
    expect(dry.media).toMatchObject({ dryRun: true, done: true });
    expect(dry.media?.removed).toBeGreaterThanOrEqual(1);
    expect(dry.media?.orphansRemoved).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(photo.key)).toBe(true);
    expect(store.objects.has(orphan)).toBe(true);

    // The sweep alone: the old photo waits for the removal's own switch.
    const sweep = await runNightlyRetention(
      {},
      { env: { WHATSAPP_MEDIA_ORPHAN_SWEEP: 'on' }, store, logger: silent },
    );
    expect(sweep.media?.removed).toBe(0);
    expect(store.objects.has(orphan)).toBe(false);
    expect(store.objects.has(photo.key)).toBe(true);
    expect((await whatsappMediaState(photo)).fileDeletedAt).toBeNull();

    const on = await runNightlyRetention(
      {},
      { env: { WHATSAPP_MEDIA_RETENTION: 'on' }, store, logger: silent },
    );
    expect(on.media).toMatchObject({ dryRun: false, done: true, failed: 0 });
    expect(store.objects.has(photo.key)).toBe(false);
    expect((await whatsappMediaState(photo)).mediaSummary).not.toBeNull();
  }, 120_000);
});
