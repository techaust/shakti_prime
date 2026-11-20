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
  mediaRetentionOn,
  ORPHAN_LOOKBACK_DAYS,
  runNightlyRetention,
  runWhatsAppMediaRetention,
  uuidTimePrefix,
} from '../src/workers/whatsapp-media-retention';

// W2 WhatsApp media retention on real Postgres (docs/03-roadmap-appendix/phase2.md §11): the job
// removes the files of media messages older than the period from a faked store and records them,
// keeps the newer ones and those another record uses, changes nothing in a dry run, resumes from
// its cursor, and removes keys no file names. This suite's files live in a bucket of its own, so
// the job passes by every other suite's rows (counted as another store's).

afterAll(closeDb);

const BUCKET = 'w2-media-web';
const DAY = 86_400_000;
const YEARS = WORKSHOP_DEFAULTS.retention.whatsappMediaYears;
const old = (days = 2) => new Date(Date.now() - (YEARS * 365 + days) * DAY);
const recent = () => new Date(Date.now() - (YEARS * 365 - 2) * DAY);

/** A UUIDv7-shaped id made at `at`, as a key's file id. */
function idAt(at: Date): string {
  const rest = newId().slice(13);
  return `${uuidTimePrefix(at)}${rest}`;
}

let channel: WhatsAppChannelFixture;
let customer: WhatsAppCustomerFixture;
let store: ReturnType<typeof memoryFileStore>;

/** A media message whose bytes this suite's store holds. */
async function stored(
  at: Date,
  options: { contentType?: 'image/jpeg' | 'application/pdf'; checkedCopy?: boolean } = {},
) {
  const media = await whatsappMediaMessage(channel, customer, { at, bucket: BUCKET, ...options });
  await store.put(media.key, Uint8Array.from([1, 2, 3]), options.contentType ?? 'image/jpeg');
  return media;
}

const silent: Logger = { log: () => undefined };

beforeAll(async () => {
  channel = await whatsappChannel(1);
  customer = await whatsappCustomer(1);
  store = memoryFileStore(BUCKET);
});

describe('the WhatsApp media retention job', () => {
  it('counts in a dry run and changes nothing, then removes old files and keeps newer ones', async () => {
    const photo = await stored(old());
    // The checks stored a masked copy of the PDF beside its upload, whose original and pages a
    // failed clean-up left behind.
    const pdf = await stored(old(), { contentType: 'application/pdf', checkedCopy: true });
    const masked = pdf.key;
    const original = pdf.originalKey ?? '';
    const page = original.replace(/\.pdf$/, '-checked/p0001.jpg');
    await store.put(original, Uint8Array.from([4]), 'application/pdf');
    await store.put(page, Uint8Array.from([5]), 'image/jpeg');
    const fresh = await stored(recent());

    const dry = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      dryRun: true,
      logger: silent,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.removed).toBeGreaterThanOrEqual(2);
    expect(dry.next).toBeNull();
    for (const key of [photo.key, original, masked, page, fresh.key]) {
      expect(store.objects.has(key)).toBe(true);
    }
    for (const media of [photo, pdf, fresh]) {
      expect(await whatsappMediaState(media)).toMatchObject({
        fileDeletedAt: null,
        mediaSummary: null,
      });
    }

    const result = await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(result).toMatchObject({ dryRun: false, failed: 0, next: null });
    expect(result.removed).toBeGreaterThanOrEqual(2);
    for (const key of [photo.key, original, masked, page]) {
      expect(store.objects.has(key)).toBe(false);
    }
    expect(store.objects.has(fresh.key)).toBe(true);
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

  it('never records a file removed while the store keeps its bytes, and records the refusal', async () => {
    const stuck = await stored(old());
    const refusing: FileStore = {
      ...store,
      delete: (key) =>
        key === stuck.key ? Promise.reject(new Error('the store is down')) : store.delete(key),
    };
    const lines: { event: string; fields: Record<string, unknown> }[] = [];
    const before = new Date();
    const result = await runWhatsAppMediaRetention({
      store: refusing,
      requestId: newId(),
      logger: { log: (_level, event, fields) => lines.push({ event, fields: fields ?? {} }) },
    });
    expect(result.failed).toBe(1);
    expect(store.objects.has(stuck.key)).toBe(true);
    expect(await whatsappMediaState(stuck)).toMatchObject({
      fileDeletedAt: null,
      mediaSummary: null,
    });
    const failed = lines.find((l) => l.event === 'messaging.media_retention_delete_failed');
    expect(failed?.fields).toMatchObject({ entityId: 1, fileId: stuck.fileId });
    // Ids and counts only: no customer's number, name or words in any line.
    expect(JSON.stringify(lines)).not.toContain(customer.waId);
    const runs = await asMigrator(
      (m) => m<{ error: string | null }[]>`
        select error from retention_runs
         where job = 'whatsapp-media-expire' and started_at >= ${before}`,
    );
    expect(runs.map((r) => r.error)).toContain('the store refused 1 file');

    // The next run removes it.
    await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(store.objects.has(stuck.key)).toBe(false);
  });

  it('hands on where its time ran out, and the next call resumes from the cursor', async () => {
    const other = await whatsappCustomer(2);
    const channel2 = await whatsappChannel(2);
    const at = old(900).getTime();
    const media: WhatsAppMediaFixture[] = [];
    for (let i = 0; i < 3; i += 1) {
      const m = await whatsappMediaMessage(channel2, other, {
        at: new Date(at + i * 1000),
        bucket: BUCKET,
      });
      await store.put(m.key, Uint8Array.from([1]), 'image/jpeg');
      media.push(m);
    }
    const [first, second, third] = media;
    if (!first || !second || !third) throw new Error('no media');

    const stopped = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      budgetMs: 0,
      start: { entityId: 2, step: 'expire', after: null },
      logger: silent,
    });
    expect(stopped.next).toEqual({ entityId: 2, step: 'expire', after: null });
    expect(store.objects.has(first.key)).toBe(true);

    const resumed = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      batchSize: 1,
      start: { entityId: 2, step: 'expire', after: { at: first.createdAt, id: first.messageId } },
      logger: silent,
    });
    expect(resumed.batches).toBeGreaterThanOrEqual(2);
    expect(store.objects.has(first.key)).toBe(true);
    expect(store.objects.has(second.key)).toBe(false);
    expect(store.objects.has(third.key)).toBe(false);
    expect((await whatsappMediaState(first)).mediaSummary).toBeNull();
  });

  it('removes keys no file names that are more than a day old, within its window', async () => {
    const named = await stored(recent());
    const folder = '1/whatsapp_media/';
    const put = (key: string, storedAt: Date) =>
      store.objects.set(key, {
        bytes: Uint8Array.from([9]),
        contentType: 'image/jpeg',
        tags: {},
        storedAt,
      });
    const twoDays = new Date(Date.now() - 2 * DAY);
    const anHour = new Date(Date.now() - 3_600_000);
    const longAgo = new Date(Date.now() - (ORPHAN_LOOKBACK_DAYS + 5) * DAY);
    const orphan = `${folder}${idAt(twoDays)}.jpg`;
    const young = `${folder}${idAt(anHour)}.jpg`;
    const beyond = `${folder}${idAt(longAgo)}.jpg`;
    put(orphan, twoDays);
    put(young, anHour);
    put(beyond, longAgo);

    const dry = await runWhatsAppMediaRetention({
      store,
      requestId: newId(),
      dryRun: true,
      logger: silent,
    });
    expect(dry.orphansRemoved).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(orphan)).toBe(true);

    const result = await runWhatsAppMediaRetention({ store, requestId: newId(), logger: silent });
    expect(result.orphansRemoved).toBeGreaterThanOrEqual(1);
    expect(store.objects.has(orphan)).toBe(false);
    expect(store.objects.has(young)).toBe(true);
    expect(store.objects.has(beyond)).toBe(true);
    expect(store.objects.has(named.key)).toBe(true);
  });

  it('removes nothing without a store', async () => {
    const lines: string[] = [];
    const result = await runWhatsAppMediaRetention({
      store: undefined,
      requestId: newId(),
      logger: { log: (_level, event) => lines.push(event) },
    });
    expect(result).toMatchObject({ removed: 0, companies: 0, next: null });
    expect(lines).toContain('messaging.media_retention_no_store');
  });
});

describe('the nightly call', () => {
  it('is switched on only by WHATSAPP_MEDIA_RETENTION=on', () => {
    expect(mediaRetentionOn({})).toBe(false);
    expect(mediaRetentionOn({ WHATSAPP_MEDIA_RETENTION: '' })).toBe(false);
    expect(mediaRetentionOn({ WHATSAPP_MEDIA_RETENTION: 'yes' })).toBe(false);
    expect(mediaRetentionOn({ WHATSAPP_MEDIA_RETENTION: ' on ' })).toBe(true);
  });

  it('removes nothing while the switch is off, counts in a dry run, and removes once it is on', async () => {
    const photo = await stored(old());
    const off = await runNightlyRetention({}, { env: {}, store, logger: silent });
    expect(off.done).toBe(true);
    expect(off.media).toBeUndefined();
    expect(store.objects.has(photo.key)).toBe(true);

    const dry = await runNightlyRetention({ dryRun: true }, { env: {}, store, logger: silent });
    expect(dry.media).toMatchObject({ dryRun: true, done: true });
    expect(dry.media?.removed).toBeGreaterThanOrEqual(1);
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
