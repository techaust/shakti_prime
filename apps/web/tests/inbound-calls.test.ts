import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  testPhone,
  whatsappCustomer,
} from '@shakti/db/testing';
import { closeWebhookDb } from '@shakti/db/webhooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as INCOMING } from '../src/app/api/v1/webhooks/exotel/incoming/[secret]/route';
import { defaultAuthDeps } from '../src/auth/deps';
import { takeRinging } from '../src/calls/ringing';
import { TEST_ORIGIN, TEST_WEBHOOK_ENV } from '../src/webhooks/signed-deliveries';

// T4 Inbound calls on real Postgres (docs/03-roadmap-appendix/phase2.md §7.4): Exotel's Passthru
// applet calls the secret address with GET and the call's fields; the route stores the delivery
// through `webhook_receiver` and, with no queue configured (as locally and in CI), the worker
// processes it in this process as `system:workers` through the `exotel_incoming` handler. An IVR
// call rings the person whose dial phone it is and waits for their screen-pop; a missed call makes
// or joins the lead with a callback; a repeated delivery changes nothing. Company 2 holds the
// suite's lines, synthetic numbers no other suite uses.

const ENTITY = 2;
const IVR = '+918047119421';
const MISSED = '+918047119422';
const QUEUE = ['QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY'] as const;
const saved = new Map<string, string | undefined>();

let exec: Principal;
let caller: Principal;
let callerPhone: string;

/** Exotel's GET for one call, under the secret path segment. */
function passthru(
  fields: Record<string, string>,
  secret: string = TEST_WEBHOOK_ENV.EXOTEL_INCOMING_SECRET,
) {
  const query = new URLSearchParams({ Direction: 'incoming', ...fields }).toString();
  return INCOMING(
    new Request(`${TEST_ORIGIN}/api/v1/webhooks/exotel/incoming/${secret}?${query}`),
    { params: Promise.resolve({ secret }) },
  );
}

interface Inbox {
  processed: boolean;
  failed: boolean;
  error_code: string | null;
  entity_id: number | null;
}

/** The delivery of a call, once the in-process work after the answer is done (up to 5 s). */
async function settled(callSid: string): Promise<Inbox[]> {
  for (let i = 0; i < 100; i += 1) {
    const rows = await asMigrator(
      (m) => m<Inbox[]>`
        select processed_at is not null as processed, failed_at is not null as failed, error_code,
               entity_id
          from webhook_inbox where provider = 'exotel_incoming' and provider_event_id = ${callSid}`,
    );
    if (rows.length > 0 && rows.every((r) => r.processed || r.failed)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`call ${callSid} was not processed`);
}

async function calls(callSid: string) {
  return asMigrator(
    (m) => m<
      { id: string; series: string; opportunity_id: string | null; caller_id: string | null }[]
    >`
      select id, series, opportunity_id, caller_id from provider_calls
       where provider_call_sid = ${callSid}`,
  );
}

async function line(channel: 'ivr' | 'missed_call', number: string) {
  await asMigrator(async (m) => {
    const [current] = await m<{ number_e164: string }[]>`
      select number_e164 from entity_channels
       where entity_id = ${ENTITY} and channel = ${channel} and is_active`;
    if (current?.number_e164 === number) return;
    await m`update entity_channels set is_active = false
             where entity_id = ${ENTITY} and channel = ${channel} and is_active`;
    await m`insert into entity_channels (id, entity_id, channel, number_e164, created_by)
             values (${newId()}, ${ENTITY}, ${channel}, ${number}, ${exec.id})`;
  });
}

const national = (e164: string) => `0${e164.slice(3)}`;
const sid = () => `t4w${newId().replaceAll('-', '')}`;

beforeAll(async () => {
  for (const name of [...QUEUE, ...Object.keys(TEST_WEBHOOK_ENV)])
    saved.set(name, process.env[name]);
  for (const name of QUEUE) Reflect.deleteProperty(process.env, name);
  Object.assign(process.env, TEST_WEBHOOK_ENV);
  exec = await createTestPrincipal('executive', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'inbound web team');
  const user = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team },
  ]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id, teamId: team });
  callerPhone = `+91${testPhone()}`;
  await asMigrator(async (m) => {
    await m`update caller_profiles set presence = 'away' where entity_id = ${ENTITY}`;
    await m`insert into caller_profiles (id, user_id, entity_id, presence, dial_phone_e164)
              values (${newId()}, ${caller.id}, ${ENTITY}, 'present', ${callerPhone})
            on conflict (user_id, entity_id) do update
              set presence = 'present', dial_phone_e164 = ${callerPhone}`;
  });
  await line('ivr', IVR);
  await line('missed_call', MISSED);
});

afterAll(async () => {
  for (const [name, value] of saved) {
    if (value === undefined) Reflect.deleteProperty(process.env, name);
    else process.env[name] = value;
  }
  await closeWebhookDb();
  await closeDb();
});

describe('an IVR call through the Passthru applet', () => {
  it('rings the person whose dial phone it is, with the matched customer, within 2 seconds', async () => {
    const customer = await whatsappCustomer(ENTITY);
    const callSid = sid();
    const started = performance.now();
    const answer = await passthru({
      CallSid: callSid,
      CallFrom: national(customer.e164),
      CallTo: national(IVR),
      DialWhomNumber: national(callerPhone),
      StartTime: '2026-11-17 11:00:00',
    });
    expect(answer.status).toBe(200);
    const keyValue = defaultAuthDeps().keyValue;
    let pop = await takeRinging(keyValue, caller.id);
    while (pop === undefined && performance.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      pop = await takeRinging(keyValue, caller.id);
    }
    const elapsed = performance.now() - started;
    expect(pop).toMatchObject({
      entityId: ENTITY,
      accountIds: [customer.accountId],
      phone: customer.e164,
    });
    // TEL-05: the pop is waiting within 2 seconds of the Passthru call (the local stack).
    expect(elapsed).toBeLessThan(2_000);
    expect(await settled(callSid)).toEqual([
      { processed: true, failed: false, error_code: null, entity_id: ENTITY },
    ]);
    const [recorded] = await calls(callSid);
    expect(recorded).toMatchObject({
      id: pop?.providerCallId,
      series: 'ivr',
      caller_id: caller.id,
    });
  });

  it('stores and records a repeated delivery once, and pops it once', async () => {
    const callSid = sid();
    const fields = {
      CallSid: callSid,
      CallFrom: national(`+91${testPhone()}`),
      CallTo: national(IVR),
      DialWhomNumber: national(callerPhone),
    };
    expect((await passthru(fields)).status).toBe(200);
    await settled(callSid);
    const keyValue = defaultAuthDeps().keyValue;
    expect(await takeRinging(keyValue, caller.id)).toMatchObject({ accountIds: [] });
    expect((await passthru(fields)).status).toBe(200);
    expect(await settled(callSid)).toHaveLength(1);
    expect(await calls(callSid)).toHaveLength(1);
    expect(await takeRinging(keyValue, caller.id)).toBeUndefined();
  });

  it('accepts nothing without the secret', async () => {
    const callSid = sid();
    const answer = await passthru(
      { CallSid: callSid, CallFrom: national(`+91${testPhone()}`), CallTo: national(IVR) },
      'not-the-secret',
    );
    expect(answer.status).toBe(401);
    const stored = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from webhook_inbox where provider_event_id = ${callSid}`,
    );
    expect(stored[0]?.n).toBe(0);
  });

  it('notes a call to a number no company has, and records nothing', async () => {
    const callSid = sid();
    await passthru({
      CallSid: callSid,
      CallFrom: national(`+91${testPhone()}`),
      CallTo: '08047119499',
    });
    expect(await settled(callSid)).toEqual([
      { processed: true, failed: false, error_code: 'call_number_unknown', entity_id: null },
    ]);
    expect(await calls(callSid)).toEqual([]);
  });
});

describe('a missed call through the Passthru applet', () => {
  it('makes the lead with a callback for its owner, and a repeat makes nothing', async () => {
    const callSid = sid();
    const fields = {
      CallSid: callSid,
      CallFrom: national(`+91${testPhone()}`),
      CallTo: national(MISSED),
    };
    expect((await passthru(fields)).status).toBe(200);
    await settled(callSid);
    const [recorded] = await calls(callSid);
    expect(recorded).toMatchObject({ series: 'missed_call', caller_id: null });
    const tasks = await asMigrator(
      (m) => m<{ assignee_id: string; kind: string }[]>`
        select assignee_id, kind from tasks where opportunity_id = ${recorded?.opportunity_id ?? ''}`,
    );
    expect(tasks).toEqual([{ assignee_id: caller.id, kind: 'callback' }]);

    expect((await passthru(fields)).status).toBe(200);
    expect(await calls(callSid)).toHaveLength(1);
    const again = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from tasks where opportunity_id = ${recorded?.opportunity_id ?? ''}`,
    );
    expect(again[0]?.n).toBe(1);
  });
});
