import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DueWhatsAppMediaDto,
  type Principal,
} from '@shakti/contracts';
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
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import {
  expireWhatsAppMedia,
  recordWhatsAppMediaOrphans,
} from '../../src/commands/messaging/media-retention';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  dueWhatsAppMedia,
  whatsAppMediaKeysKept,
} from '../../src/queries/messaging/media-retention';
import { readMediaSummary, readWhatsAppThread } from '../../src/queries/messaging/whatsapp';
import { WORKSHOP_DEFAULTS } from '../../src/workshop-defaults';

// W2 WhatsApp media retention (docs/03-roadmap-appendix/phase2.md §11): the two commands and the
// two reads the job runs as `system:workers`, on real Postgres. The suites never clean these
// tables, so every assertion is about this run's own rows.

afterAll(closeDb);

const DAY = 86_400_000;
const YEARS = WORKSHOP_DEFAULTS.retention.whatsappMediaYears;
const old = () => new Date(Date.now() - (YEARS * 365 + 2) * DAY);
const recent = () => new Date(Date.now() - (YEARS * 365 - 2) * DAY);

const workers = (entityId = 1): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run(principal: Principal, command: AnyCommand, input: unknown): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

async function failure(promise: Promise<unknown>): Promise<{ code: string | undefined }> {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code };
  }
  throw new Error('expected the command to fail');
}

let channel1: WhatsAppChannelFixture;
let customer: WhatsAppCustomerFixture;
let exec: Principal;

beforeAll(async () => {
  channel1 = await whatsappChannel(1);
  customer = await whatsappCustomer(1);
  exec = await createTestPrincipal('executive', [1]);
});

describe('messaging.media.expire', () => {
  it('is refused to a person, an agent and the workers of another company', async () => {
    const media = await whatsappMediaMessage(channel1, customer, { at: old() });
    const input = { entityId: 1, messageIds: [media.messageId] };
    expect(await failure(run(exec, expireWhatsAppMedia, input))).toEqual({ code: 'forbidden' });
    expect(await failure(run(customer.owner, expireWhatsAppMedia, input))).toEqual({
      code: 'forbidden',
    });
    expect(
      await failure(run(principalFor('agent:concierge', [1]), expireWhatsAppMedia, input)),
    ).toEqual({ code: 'forbidden' });
    expect(await failure(run(workers(2), expireWhatsAppMedia, input))).toEqual({
      code: 'forbidden',
    });
    expect((await whatsappMediaState(media)).fileDeletedAt).toBeNull();
  });

  it('removes an old file with its summary, leaves a newer one, and audits the file', async () => {
    const media = await whatsappMediaMessage(channel1, customer, {
      at: old(),
      caption: 'borewell photo',
      status: 'rejected',
    });
    const fresh = await whatsappMediaMessage(channel1, customer, { at: recent() });
    const answer = await run(workers(), expireWhatsAppMedia, {
      entityId: 1,
      messageIds: [media.messageId, fresh.messageId],
    });
    expect(answer).toEqual({
      entityId: 1,
      removed: [{ messageId: media.messageId, fileId: media.fileId }],
      inUse: 0,
    });
    expect(await whatsappMediaState(media)).toMatchObject({
      fileId: media.fileId,
      bodyMasked: 'borewell photo',
      mediaSummary: expect.objectContaining({ verdict: 'refused', size: 2048 }) as unknown,
    });
    expect((await whatsappMediaState(media)).fileDeletedAt).not.toBeNull();
    expect(await whatsappMediaState(fresh)).toMatchObject({
      fileDeletedAt: null,
      mediaSummary: null,
    });
    // The chat shows the summary in place of the file, to whoever reads it.
    const view = await asPrincipal(customer.owner, (ctx) =>
      readWhatsAppThread(ctx, { entityId: 1, threadId: media.threadId, limit: 50 }),
    );
    const shown = new Map(view.messages.map((m) => [m.id, m]));
    expect(shown.get(media.messageId)).toMatchObject({
      fileId: media.fileId,
      body: 'borewell photo',
      mediaSummary: { contentType: 'image/jpeg', verdict: 'refused', keptYears: YEARS },
    });
    expect(shown.get(fresh.messageId)?.mediaSummary).toBeNull();
    const rows = await asMigrator(
      (m) => m<{ command: string; after_json: Record<string, unknown> }[]>`
        select command, after_json from audit_logs
         where aggregate_type = 'file' and aggregate_id = ${media.fileId}`,
    );
    expect(rows).toEqual([
      {
        command: 'messaging.media.expire',
        after_json: { deletedAt: expect.any(String) as string },
      },
    ]);
  });
});

describe('the job’s reads', () => {
  it('reads the due files a batch at a time from the cursor, and changes nothing', async () => {
    const other = await whatsappCustomer(4);
    const channel4 = await whatsappChannel(4);
    const base = old().getTime() - 800 * DAY;
    const mine = [];
    for (let i = 0; i < 3; i += 1) {
      mine.push(await whatsappMediaMessage(channel4, other, { at: new Date(base + i * 1000) }));
    }
    const ids = mine.map((m) => m.messageId);
    const seen: string[] = [];
    // From just before this run's own rows, so rows earlier runs left never come first.
    let after: { at: string; id: string } | null = {
      at: new Date(base - 1).toISOString(),
      id: '00000000-0000-0000-0000-000000000000',
    };
    for (let page = 0; page < 100; page += 1) {
      const cursor: { at: string; id: string } | null = after;
      const batch: DueWhatsAppMediaDto[] = await asPrincipal(workers(4), (ctx) =>
        dueWhatsAppMedia(ctx, 4, cursor, 2),
      );
      seen.push(...batch.map((d) => d.messageId));
      const last = batch.at(-1);
      if (batch.length < 2 || last === undefined) break;
      after = { at: last.messageAt, id: last.messageId };
    }
    expect(seen.filter((id) => ids.includes(id))).toEqual(ids);
    for (const media of mine) {
      expect(await whatsappMediaState(media)).toMatchObject({ fileDeletedAt: null });
    }
    // The reads refuse a person.
    await expect(asPrincipal(exec, (ctx) => dueWhatsAppMedia(ctx, 1, null, 10))).rejects.toThrow();
    // Removed, so a later run of the suite or of the job never reads them again.
    await run(workers(4), expireWhatsAppMedia, { entityId: 4, messageIds: ids });
  });

  it('shows a summary it cannot fully read as far as it can, never failing the chat', async () => {
    const media = await whatsappMediaMessage(channel1, customer, { at: old() });
    const empty = await whatsappMediaMessage(channel1, customer, { at: old() });
    // As an older or newer job might have written them: a field of another shape, one unknown.
    await asMigrator(async (m) => {
      await m`update whatsapp_messages
                 set media_summary = '{"size": "big", "verdict": "maybe", "keptYears": 3, "later": true}'::jsonb
               where id = ${media.messageId}`;
      await m`update whatsapp_messages set media_summary = '{}'::jsonb where id = ${empty.messageId}`;
    });
    const view = await asPrincipal(customer.owner, (ctx) =>
      readWhatsAppThread(ctx, { entityId: 1, threadId: media.threadId, limit: 50 }),
    );
    const shown = new Map(view.messages.map((m) => [m.id, m.mediaSummary]));
    expect(shown.get(media.messageId)).toEqual({ keptYears: 3 });
    expect(shown.get(empty.messageId)).toEqual({});
    expect(readMediaSummary(null)).toBeNull();
    expect(readMediaSummary(['not', 'an', 'object'])).toEqual({});
    expect(readMediaSummary({ contentType: 'image/jpeg', size: 10, verdict: 'passed' })).toEqual({
      contentType: 'image/jpeg',
      size: 10,
      verdict: 'passed',
    });
  });

  it('answers the keys still named, whatever characters a listed key holds', async () => {
    const media = await whatsappMediaMessage(channel1, customer, { at: recent() });
    const strange = `1/whatsapp_media/${newId()}.jpg","x`;
    const kept = await asPrincipal(workers(), (ctx) =>
      whatsAppMediaKeysKept(ctx, 1, 'memory', [media.key, strange]),
    );
    expect([...kept]).toEqual([media.key]);
  });
});

describe('messaging.media.record_orphans', () => {
  it('records the sweep for the workers alone', async () => {
    const input = { entityId: 1, startedAt: new Date().toISOString(), removed: 3, failed: 0 };
    expect(await failure(run(exec, recordWhatsAppMediaOrphans, input))).toEqual({
      code: 'forbidden',
    });
    // Not for a company outside the request.
    expect(await failure(run(workers(2), recordWhatsAppMediaOrphans, input))).toEqual({
      code: 'forbidden',
    });
    expect(await run(workers(), recordWhatsAppMediaOrphans, input)).toEqual({
      entityId: 1,
      removed: 3,
      failed: 0,
    });
    const [row] = await asMigrator(
      (m) => m<{ rows_affected: number }[]>`
        select rows_affected from retention_runs
         where job = 'whatsapp-media-orphans' and started_at >= ${input.startedAt}
         order by finished_at desc limit 1`,
    );
    expect(row?.rows_affected).toBe(3);

    // A sweep stopped for time keeps where it stopped. (Company 4, at a key before any file's id,
    // so a sweep of the suites that reads it starts at the folder's start.)
    const stopped = { entityId: 4, startedAt: new Date().toISOString(), removed: 1, failed: 0 };
    await run(workers(4), recordWhatsAppMediaOrphans, {
      ...stopped,
      resumeKey: '4/whatsapp_media/0',
    });
    const [kept] = await asMigrator(
      (m) => m<{ resume_key: string | null }[]>`
        select resume_key from retention_runs
         where job = 'whatsapp-media-orphans' and entity_id = 4 and started_at >= ${stopped.startedAt}
         order by finished_at desc limit 1`,
    );
    expect(kept?.resume_key).toBe('4/whatsapp_media/0');
  });
});
