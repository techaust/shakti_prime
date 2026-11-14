import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import { closeWebhookDb } from '@shakti/db/webhooks';
import {
  attachCallRecording,
  callRecordingKey,
  createLead,
  executeCommand,
  fakeClickToDial,
  fixtureDndRegistry,
  memoryFileStore,
  placeDial,
  setDialPhone,
  setEntityChannel,
  type ClickToDial,
  type FileStore,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as EXOTEL_STATUS } from '../src/app/api/v1/webhooks/exotel/call-status/route';
import type { ExotelClient } from '../src/integrations/exotel/client';
import { signedStatusCallbackUrl } from '../src/integrations/exotel/status-callback';
import {
  OPEN_CALL_HOURS,
  sweepCalls,
  UNPLACED_DIAL_MINUTES,
} from '../src/workers/calls/sweep-calls';
import { exotelStatusHandler } from '../src/workers/webhooks/exotel-status';
import { TEST_ORIGIN, TEST_WEBHOOK_ENV } from '../src/webhooks/signed-deliveries';
import exotelStatus from '../src/integrations/exotel/fixtures/status-callback.json';

// T3 on real Postgres (docs/03-roadmap-appendix/phase2.md §6.3): Exotel's status reports reach a
// placed call through the `exotel_status` handler, recorded callbacks in and out of order, the
// recording copied into the file store under the call's id and its link never kept; and the hourly
// sweep closes a dial the provider never took and removes recordings past the retention period.
// Company 2 holds this suite's numbers, which no other suite sets.

const ENTITY = 2;
const PROMO = '+911400000201';
const SERVICE = '+911600000201';
const DAY = 86_400_000;

/** Yesterday at 11:00 IST: inside calling hours and always in the past. */
const NOON = ((): Date => {
  const yesterday = new Date(Date.now() - DAY).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  return new Date(`${yesterday}T11:00:00+05:30`);
})();
let tick = 0;
const nextMinute = (): Date => new Date(NOON.getTime() + (tick += 3) * 60_000);

let exec: Principal;
let caller: Principal;

const workers = (entityId: number): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

const QUEUE = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'] as const;
const saved = new Map<string, string | undefined>();

beforeAll(async () => {
  for (const name of [...QUEUE, ...Object.keys(TEST_WEBHOOK_ENV)]) {
    saved.set(name, process.env[name]);
  }
  for (const name of QUEUE) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, TEST_WEBHOOK_ENV);

  exec = await createTestPrincipal('executive', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'click-to-dial web team');
  const user = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team },
  ]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id, teamId: team });
  await asMigrator(
    (m) =>
      m`update entity_channels set is_active = false
         where entity_id = ${ENTITY} and channel in ('call_promo_140', 'call_service_160') and is_active`,
  );
  for (const [channel, number] of [
    ['call_promo_140', PROMO],
    ['call_service_160', SERVICE],
  ] as const) {
    await executeCommand(exec, { entityIds: [ENTITY] }, setEntityChannel, {
      entityId: ENTITY,
      channel,
      number,
      verified: true,
    });
  }
  await executeCommand(caller, { entityIds: [ENTITY] }, setDialPhone, {
    entityId: ENTITY,
    phone: '+919800000201',
  });
});

afterAll(async () => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await closeWebhookDb();
  await closeDb();
});

/** A consented service call placed on a new lead of the caller's, through `dialler`. */
async function placed(dialler: ClickToDial = fakeClickToDial()) {
  const lead = (await executeCommand(caller, { entityIds: [ENTITY] }, createLead, {
    entityId: ENTITY,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Click-to-dial web customer', phone: testPhone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Phulera', pin: '303338' },
    sourceCode: 'website',
    consent: { channel: 'call', purpose: 'service', source: 'web_form', textVersion: 'v1' },
  })) as { id: string };
  const at = nextMinute();
  const call = await placeDial(
    caller,
    { entityId: ENTITY, opportunityId: lead.id },
    {
      registry: fixtureDndRegistry({ now: () => at }),
      dialler,
      workers,
      requestId: newId(),
      hosted: false,
      now: at,
    },
  );
  return { lead: lead.id, call, sid: `fake${call.id.replaceAll('-', '')}` };
}

async function stored(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        status: string;
        provider_call_sid: string | null;
        answered_at: Date | null;
        ended_at: Date | null;
        duration_s: number | null;
        recording_file_id: string | null;
      }[]
    >`select status, provider_call_sid, answered_at, ended_at, duration_s, recording_file_id
        from provider_calls where id = ${id}`,
  );
  if (!row) throw new Error(`provider call ${id} missing`);
  return row;
}

/** Exotel's recorded terminal report, for one call and one status. */
function report(ref: string, sid: string, fields: Record<string, unknown> = {}) {
  return {
    ...exotelStatus,
    ConversationDuration: '251',
    Legs: [],
    CallSid: sid,
    CustomField: ref,
    bos_ref: ref,
    ...fields,
  } as Parameters<ReturnType<typeof exotelStatusHandler>>[0];
}

/** A stand-in Exotel account that hands out one MP3 and counts its downloads. */
function recordings(): { client: ExotelClient; downloads: string[] } {
  const downloads: string[] = [];
  const client = {
    connectCall: () => Promise.reject(new Error('not dialled here')),
    getCall: () => Promise.reject(new Error('not read here')),
    recordingAllowed: (url: string) => url.startsWith('https://recordings.exotel.com/'),
    fetchRecording: (url: string) => {
      downloads.push(url);
      return Promise.resolve({
        bytes: new TextEncoder().encode(`mp3 bytes of ${url}`),
        contentType: 'audio/mpeg' as const,
      });
    },
  } satisfies ExotelClient;
  return { client, downloads };
}

describe('the exotel_status handler', () => {
  it('records the answer, the end and the recording once, whatever order and how often the reports come', async () => {
    const { call, sid } = await placed();
    const files = memoryFileStore();
    const exotel = recordings();
    const handle = exotelStatusHandler({ client: () => exotel.client, store: () => files });
    const context = { requestId: newId() };
    const link = 'https://recordings.exotel.com/shaktiprime1/call.mp3';

    expect(
      await handle(
        report(call.id, sid, { Status: 'in-progress', DateUpdated: '2026-09-28 11:00:20' }),
        context,
      ),
    ).toEqual({ entityId: ENTITY });
    expect(await stored(call.id)).toMatchObject({
      status: 'in_progress',
      answered_at: new Date('2026-09-28T11:00:20+05:30'),
    });

    const completed = report(call.id, sid, { RecordingUrl: link });
    await handle(completed, context);
    const row = await stored(call.id);
    expect(row).toMatchObject({
      status: 'completed',
      duration_s: 251,
      ended_at: new Date('2026-09-28T11:04:40+05:30'),
      recording_file_id: call.id,
    });
    const key = callRecordingKey(ENTITY, call.id, 'audio/mpeg');
    expect(files.objects.has(key)).toBe(true);
    const [file] = await asMigrator(
      (m) => m<{ purpose: string; key: string; name: string }[]>`
        select purpose, key, name from files where id = ${call.id}`,
    );
    // The file keeps where the store holds it, never Exotel's link.
    expect(file).toEqual({ purpose: 'call_recording', key, name: 'call-recording.mp3' });
    expect(JSON.stringify(file)).not.toContain('exotel');

    // The same end again, an answer that comes late and another end change nothing back.
    await handle(completed, context);
    await handle(report(call.id, sid, { Status: 'in-progress' }), context);
    await handle(report(call.id, sid, { Status: 'failed', ConversationDuration: '0' }), context);
    expect(await stored(call.id)).toMatchObject({ status: 'completed', duration_s: 251 });
    expect(exotel.downloads).toEqual([link]);
  });

  it('records nothing for a report of no call of ours, or of a call that holds another CallSid', async () => {
    const { call } = await placed();
    const handle = exotelStatusHandler({ client: () => undefined, store: () => undefined });
    const context = { requestId: newId() };
    expect(await handle(report(newId(), `x${newId().replaceAll('-', '')}`), context)).toEqual({
      entityId: null,
    });
    expect(await handle(report(call.id, `other${newId().replaceAll('-', '')}`), context)).toEqual({
      entityId: null,
    });
    expect(await stored(call.id)).toMatchObject({ status: 'ringing' });
  });

  it("takes the CallSid of a dial the provider did not answer in time, and keeps a completed call's recording waiting without a store", async () => {
    const { call } = await placed(fakeClickToDial({ fail: 'uncertain' }));
    expect(await stored(call.id)).toMatchObject({ status: 'dialling', provider_call_sid: null });
    const sid = `late${newId().replaceAll('-', '')}`;
    const handle = exotelStatusHandler({ client: () => undefined, store: () => undefined });
    await handle(report(call.id, sid, { RecordingUrl: 'https://recordings.exotel.com/a.mp3' }), {
      requestId: newId(),
    });
    expect(await stored(call.id)).toMatchObject({
      status: 'completed',
      provider_call_sid: sid,
      recording_file_id: null,
    });
  });

  it('reaches the call through the signed status address and the webhook worker', async () => {
    const { call, sid } = await placed();
    const url = signedStatusCallbackUrl(
      `${TEST_ORIGIN}/api/v1/webhooks/exotel/call-status`,
      call.id,
      TEST_WEBHOOK_ENV.EXOTEL_CALLBACK_SECRET,
      new Date(),
    );
    const body = new URLSearchParams({
      CallSid: sid,
      Status: 'no-answer',
      DateUpdated: '2026-09-28 11:01:00',
      CustomField: call.id,
    }).toString();
    const send = () =>
      EXOTEL_STATUS(
        new Request(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        }),
      );
    expect((await send()).status).toBe(200);
    // Without a queue the worker runs in this process after the answer.
    for (let i = 0; i < 50 && (await stored(call.id)).status !== 'no_answer'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(await stored(call.id)).toMatchObject({ status: 'no_answer' });
    // A copy of the address with another reference is refused before anything is stored.
    const forged = await EXOTEL_STATUS(
      new Request(url.replace(call.id, newId()), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      }),
    );
    expect(forged.status).toBe(401);
  });
});

describe('the hourly calls sweep', () => {
  it('closes a dial the provider never took after an hour, and nothing sooner', async () => {
    const { call } = await placed(fakeClickToDial({ fail: 'uncertain' }));
    const started = Date.parse(call.startedAt);
    const early = await sweepCalls({
      store: undefined,
      requestId: newId(),
      now: () => new Date(started + (UNPLACED_DIAL_MINUTES - 5) * 60_000),
    });
    expect(early.failures).toBe(0);
    expect(await stored(call.id)).toMatchObject({ status: 'dialling' });
    const swept = await sweepCalls({
      store: undefined,
      requestId: newId(),
      now: () => new Date(started + (UNPLACED_DIAL_MINUTES + 5) * 60_000),
    });
    expect(swept.dialsClosed).toBeGreaterThanOrEqual(1);
    expect(await stored(call.id)).toMatchObject({ status: 'failed' });
    // A report that comes after changes nothing back.
    const handle = exotelStatusHandler({ client: () => undefined, store: () => undefined });
    await handle(report(call.id, `late${newId().replaceAll('-', '')}`), { requestId: newId() });
    expect(await stored(call.id)).toMatchObject({ status: 'failed', duration_s: null });
  });

  it('closes a call left ringing or on the line three hours after the press, and nothing sooner', async () => {
    const { call } = await placed();
    expect(await stored(call.id)).toMatchObject({ status: 'ringing' });
    const started = Date.parse(call.startedAt);
    await sweepCalls({
      store: undefined,
      requestId: newId(),
      now: () => new Date(started + (OPEN_CALL_HOURS * 60 - 5) * 60_000),
    });
    expect(await stored(call.id)).toMatchObject({ status: 'ringing' });
    await sweepCalls({
      store: undefined,
      requestId: newId(),
      now: () => new Date(started + (OPEN_CALL_HOURS * 60 + 5) * 60_000),
    });
    expect(await stored(call.id)).toMatchObject({ status: 'failed' });
  });

  it('removes a recording past twelve months from the store, keeping the call and its file row', async () => {
    const { call, sid } = await placed();
    const files: FileStore & { objects: Map<string, unknown> } = memoryFileStore();
    const handle = exotelStatusHandler({ client: () => recordings().client, store: () => files });
    await handle(report(call.id, sid, { RecordingUrl: 'https://recordings.exotel.com/old.mp3' }), {
      requestId: newId(),
    });
    const key = callRecordingKey(ENTITY, call.id, 'audio/mpeg');
    expect(files.objects.has(key)).toBe(true);
    // Eleven months old: kept.
    await asMigrator(
      (m) => m`update files set created_at = now() - interval '11 months' where id = ${call.id}`,
    );
    await sweepCalls({ store: files, requestId: newId() });
    expect(files.objects.has(key)).toBe(true);
    // Thirteen months old: removed.
    await asMigrator(
      (m) => m`update files set created_at = now() - interval '13 months' where id = ${call.id}`,
    );
    const swept = await sweepCalls({ store: files, requestId: newId() });
    expect(swept.recordingsRemoved).toBeGreaterThanOrEqual(1);
    expect(files.objects.has(key)).toBe(false);
    const [file] = await asMigrator(
      (m) => m<{ deleted: boolean }[]>`
        select deleted_at is not null as deleted from files where id = ${call.id}`,
    );
    expect(file?.deleted).toBe(true);
    expect((await stored(call.id)).recording_file_id).toBe(call.id);
    // The attach of a removed recording is not taken again.
    const again = await executeCommand(
      workers(ENTITY),
      { entityIds: [ENTITY] },
      attachCallRecording,
      {
        entityId: ENTITY,
        providerCallId: call.id,
        fileId: call.id,
        bucket: files.bucket,
        key,
        contentType: 'audio/mpeg',
        size: 1,
        sha256: 'c'.repeat(64),
      },
    );
    expect(again.outcome).toBe('already');
  });
});
