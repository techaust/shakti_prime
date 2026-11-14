import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
  type ProviderCallDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { placeDial, type PlaceDialDeps } from '../../src/calls/place-dial';
import type { AnyCommand } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { dialCall } from '../../src/commands/calls/dial-call';
import { logCall } from '../../src/commands/calls/log-call';
import { playCallRecording } from '../../src/commands/calls/play-recording';
import {
  attachCallRecording,
  callRecordingKey,
  deleteCallRecording,
  recordProviderCall,
} from '../../src/commands/calls/provider-calls';
import { setDialPhone } from '../../src/commands/crm/caller-profiles';
import { withdrawConsent } from '../../src/commands/crm/consent';
import { createLead } from '../../src/commands/crm/create-lead';
import { setEntityChannel } from '../../src/commands/org/channels';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  fakeClickToDial,
  unreachableClickToDial,
  type ClickToDial,
} from '../../src/ports/click-to-dial';
import { fixtureDndRegistry, type DndRegistry } from '../../src/ports/dnd';

// T3 Click-to-dial and recordings (docs/03-roadmap-appendix/phase2.md §6.3; PRD TEL-01 and TEL-04):
// a person's dial is checked against every calling rule before anything reaches the provider,
// recorded as dialling, then placed through the provider port and recorded by the platform; the
// provider's reports only move a call forward; a recording is kept, removed after the retention
// period, and heard only with calls.recording.listen, every listen audited; a log of a dialled call
// takes its start and length from the provider. Company 4 holds the suite's numbers, which no
// other suite reads; the numbers are synthetic DLT ones.

const ENTITY = 4;
const PROMO = '+911400000401';
const SERVICE = '+911600000401';
const CALLER_PHONE = '+919800000401';
const DAY = 86_400_000;
const MINUTE = 60_000;

/** Yesterday at 11:00 IST: inside calling hours and always in the past. */
const NOON = ((): Date => {
  const yesterday = new Date(Date.now() - DAY).toLocaleDateString('en-CA', {
    timeZone: 'Asia/Kolkata',
  });
  return new Date(`${yesterday}T11:00:00+05:30`);
})();
/** The same day at 21:30 IST, after calling hours. */
const LATE = new Date(NOON.getTime() + 10.5 * 60 * MINUTE);

/** Each dial of the suite a few minutes after the last, so no dial reads as a second press. */
let tick = 0;
function nextMinute(): Date {
  tick += 3;
  return new Date(NOON.getTime() + tick * MINUTE);
}

let exec: Principal;
let caller: Principal;
let colleague: Principal;
let teamLead: Principal;
let otherTeamLead: Principal;
let accounts: Principal;

const workers = (entityId: number = ENTITY): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run(principal: Principal, command: AnyCommand, input: unknown, now?: Date): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, ...(now === undefined ? {} : { now }) }, input),
  );
}

async function failure(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: string | undefined; refusals?: unknown }> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string; refusals?: unknown } };
    return {
      code: err.code,
      reason: err.details?.reason,
      ...(err.details?.refusals === undefined ? {} : { refusals: err.details.refusals }),
    };
  }
  throw new Error('expected a refusal');
}

interface Lead {
  id: string;
  accountId: string;
  contactId: string;
  phoneId: string;
  e164: string;
}

let leadNo = 0;

/** A lead of `owner`'s; `consent` records a service consent for calls on the form. */
async function leadOf(
  options: { source?: string; consent?: boolean; owner?: Principal } = {},
): Promise<Lead> {
  leadNo += 1;
  const created = (await run(options.owner ?? caller, createLead, {
    entityId: ENTITY,
    pipelineKey: 'farmer_pumps',
    contact: { name: `Click-to-dial customer ${leadNo}`, phone: testPhone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Phulera', pin: '303338' },
    ...(options.source === undefined ? {} : { sourceCode: options.source }),
    ...(options.consent === true
      ? { consent: { channel: 'call', purpose: 'service', source: 'web_form', textVersion: 'v1' } }
      : {}),
  })) as { id: string; account: { id: string } };
  const [phone] = await asMigrator(
    (m) => m<{ id: string; e164: string; contact_id: string }[]>`
      select cp.id, cp.e164, cp.contact_id from contact_phones cp
        join account_contacts ac on ac.contact_id = cp.contact_id
       where ac.account_id = ${created.account.id} order by cp.id limit 1`,
  );
  if (!phone) throw new Error('the lead has no phone');
  return {
    id: created.id,
    accountId: created.account.id,
    contactId: phone.contact_id,
    phoneId: phone.id,
    e164: phone.e164,
  };
}

/** The phone's DND state as the platform last recorded it, set directly for a case. */
function checked(lead: Lead, onDnd: boolean, at: Date | null): Promise<unknown> {
  return asMigrator(
    (m) => m`update contact_phones set is_dnd = ${onDnd}, dnd_checked_at = ${at}
              where id = ${lead.phoneId}`,
  );
}

function deps(
  dialler: ClickToDial | undefined,
  now: Date = nextMinute(),
  registry: DndRegistry = fixtureDndRegistry({ now: () => now }),
): PlaceDialDeps {
  return { registry, dialler, workers, requestId: newId(), hosted: false, now };
}

function dial(lead: Lead, d: PlaceDialDeps, who: Principal = caller): Promise<ProviderCallDto> {
  return placeDial(who, { entityId: ENTITY, opportunityId: lead.id }, d);
}

async function providerCall(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        status: string;
        provider_call_sid: string | null;
        series: string;
        purpose: string;
        started_at: Date;
        duration_s: number | null;
        ended_at: Date | null;
        answered_at: Date | null;
        recording_file_id: string | null;
        call_id: string | null;
      }[]
    >`select status, provider_call_sid, series, purpose, started_at, duration_s, ended_at,
             answered_at, recording_file_id, call_id
        from provider_calls where id = ${id}`,
  );
  if (!row) throw new Error(`provider call ${id} missing`);
  return row;
}

function report(input: Record<string, unknown>, who: Principal = workers()): Promise<unknown> {
  return run(who, recordProviderCall, { entityId: ENTITY, ...input });
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [ENTITY]);
  accounts = await createTestPrincipal('accounts', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'click-to-dial team');
  const otherTeam = await createTestTeam(ENTITY, 'click-to-dial other team');
  const a = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: a.id, teamId: team });
  const b = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team }]);
  colleague = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: b.id, teamId: team });
  const l = await createTestUser([{ entityId: ENTITY, roleKey: 'sales_team_lead', teamId: team }]);
  teamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { id: l.id, teamId: team });
  const o = await createTestUser([
    { entityId: ENTITY, roleKey: 'sales_team_lead', teamId: otherTeam },
  ]);
  otherTeamLead = await createTestPrincipal('sales_team_lead', [ENTITY], {
    id: o.id,
    teamId: otherTeam,
  });
  // Earlier runs' numbers are taken out of use, so this run sets them afresh.
  await asMigrator(
    (m) =>
      m`update entity_channels set is_active = false where entity_id = ${ENTITY} and is_active`,
  );
  for (const [channel, number] of [
    ['call_promo_140', PROMO],
    ['call_service_160', SERVICE],
  ] as const) {
    await run(exec, setEntityChannel, { entityId: ENTITY, channel, number, verified: true });
  }
  await run(caller, setDialPhone, { entityId: ENTITY, phone: CALLER_PHONE });
});

afterAll(closeDb);

describe('crm.caller_profile.set_dial_phone', () => {
  it("sets the caller's own phone, audited to its last four digits", async () => {
    const requestId = newId();
    const answer = await executeCommand(
      colleague,
      { entityIds: [ENTITY], requestId },
      setDialPhone,
      { entityId: ENTITY, phone: '+919800000402' },
      { hosted: false },
    );
    expect(answer).toEqual({ entityId: ENTITY, dialPhone: '+919800000402' });
    const rows = await asMigrator(
      (m) => m<{ after: unknown }[]>`
        select after_json as after from audit_logs
         where request_id = ${requestId} and command = 'crm.caller_profile.set_dial_phone'`,
    );
    expect(JSON.stringify(rows)).not.toContain('9800000402');
    expect(JSON.stringify(rows)).toContain('0402');
    expect(await run(colleague, setDialPhone, { entityId: ENTITY, phone: null })).toEqual({
      entityId: ENTITY,
      dialPhone: null,
    });
  });

  it('is refused to a role that does not dial, to an agent and outside the company', async () => {
    expect(
      await failure(run(accounts, setDialPhone, { entityId: ENTITY, phone: CALLER_PHONE })),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(
        run(principalFor('agent:triage', [ENTITY]), setDialPhone, {
          entityId: ENTITY,
          phone: CALLER_PHONE,
        }),
      ),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(run(caller, setDialPhone, { entityId: 2, phone: CALLER_PHONE })),
    ).toMatchObject({ code: 'forbidden' });
  });

  it("never lets a manager set a caller's dial phone", async () => {
    await expect(
      asPrincipal(teamLead, ({ tx }) =>
        tx.execute(
          sql`update caller_profiles set dial_phone_e164 = '+919800000499'
               where user_id = ${caller.id} and entity_id = ${ENTITY}`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('calls.call.dial (PRD TEL-01, TEL-04)', () => {
  it('is denied to a role without calls.dial and to an agent, and outside the company', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const input = { entityId: ENTITY, opportunityId: lead.id };
    expect(await failure(run(accounts, dialCall, input, nextMinute()))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(run(principalFor('agent:triage', [ENTITY]), dialCall, input, nextMinute())),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(run(caller, dialCall, { ...input, entityId: 2 }, nextMinute())),
    ).toMatchObject({ code: 'forbidden' });
    // A colleague's lead is not the caller's to read, so it is not found.
    const theirs = await leadOf({ source: 'website', consent: true, owner: colleague });
    const port = unreachableClickToDial();
    expect(await failure(dial(theirs, deps(port)))).toMatchObject({ code: 'not_found' });
    expect(port.calls).toBe(0);
  });

  it('places a consented enquiry as a service call from the caller to the customer on the 160 number', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const port = fakeClickToDial();
    const call = await dial(lead, deps(port));
    expect(call).toMatchObject({
      entityId: ENTITY,
      opportunityId: lead.id,
      callerId: caller.id,
      direction: 'outbound',
      series: '160',
      purpose: 'service',
      status: 'ringing',
      hasRecording: false,
      callId: null,
    });
    expect(port.placed).toEqual([
      {
        ref: call.id,
        agentNumber: CALLER_PHONE,
        customerNumber: lead.e164,
        callerId: SERVICE,
        purpose: 'service',
        hasRecordedConsent: true,
        onDnd: false,
        callConsentWithdrawn: false,
        record: true,
      },
    ]);
    expect(await providerCall(call.id)).toMatchObject({
      status: 'ringing',
      provider_call_sid: `fake${call.id.replaceAll('-', '')}`,
    });
  });

  it('places a call with no consent as promotional on the 140 number', async () => {
    const lead = await leadOf({ source: 'website' });
    await checked(lead, false, new Date(NOON.getTime() - DAY));
    const port = fakeClickToDial();
    const call = await dial(lead, deps(port));
    expect(call).toMatchObject({ series: '140', purpose: 'promotional' });
    expect(port.placed[0]).toMatchObject({ callerId: PROMO, purpose: 'promotional', onDnd: false });
  });

  it('never reaches the provider for a refused dial, and lists every broken rule', async () => {
    const port = unreachableClickToDial();
    // Outside calling hours.
    const late = await leadOf({ source: 'website', consent: true });
    expect(await failure(dial(late, deps(port, LATE)))).toEqual({
      code: 'conflict',
      reason: 'dial_refused',
      refusals: ['outside_calling_hours'],
    });
    // A promotional call to a number on DND (the fixture register lists it).
    const onDnd = await leadOf();
    await checked(onDnd, true, new Date(NOON.getTime() - DAY));
    expect(await failure(dial(onDnd, deps(port)))).toMatchObject({
      reason: 'dial_refused',
      refusals: ['recipient_on_dnd'],
    });
    // A promotional call whose DND state cannot be had: the register does not answer.
    const unknown = await leadOf();
    const at = nextMinute();
    expect(
      await failure(dial(unknown, deps(port, at, fixtureDndRegistry({ unreachable: true })))),
    ).toMatchObject({ reason: 'dial_refused', refusals: ['dnd_unknown'] });
    // A customer who withdrew consent to calls, on any path.
    const optedOut = await leadOf({ source: 'website', consent: true });
    const [consent] = await asMigrator(
      (m) => m<{ id: string }[]>`select id from consents where contact_id = ${optedOut.contactId}`,
    );
    await run(exec, withdrawConsent, {
      entityId: ENTITY,
      accountId: optedOut.accountId,
      consentId: consent?.id ?? '',
    });
    expect(await failure(dial(optedOut, deps(port)))).toMatchObject({
      reason: 'dial_refused',
      refusals: expect.arrayContaining(['call_consent_withdrawn']) as unknown,
    });
    expect(port.calls).toBe(0);
    // The command itself refuses too, whoever skips the dialler's own check.
    expect(
      await failure(run(caller, dialCall, { entityId: ENTITY, opportunityId: late.id }, LATE)),
    ).toMatchObject({ reason: 'dial_refused', refusals: ['outside_calling_hours'] });
    const none = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from provider_calls
         where opportunity_id = any(${[late.id, onDnd.id, unknown.id, optedOut.id]}::uuid[])`,
    );
    expect(none[0]?.n).toBe(0);
  });

  it("refuses a promotional dial whose DND check is stale, without the dialler's refresh", async () => {
    const lead = await leadOf();
    await checked(lead, false, new Date(NOON.getTime() - 30 * DAY));
    expect(
      await failure(run(caller, dialCall, { entityId: ENTITY, opportunityId: lead.id }, nextMinute())),
    ).toMatchObject({ reason: 'dial_refused', refusals: ['dnd_unknown'] });
    // The dialler refreshes it through the platform first, and the call goes out.
    const port = fakeClickToDial();
    expect(await dial(lead, deps(port))).toMatchObject({ purpose: 'promotional' });
    expect(port.placed).toHaveLength(1);
  });

  it('refuses a company with no number for the purpose, without the provider', async () => {
    await asMigrator(
      (m) => m`update entity_channels set is_active = false
                where entity_id = ${ENTITY} and channel = 'call_service_160' and is_active`,
    );
    try {
      const lead = await leadOf({ source: 'website', consent: true });
      const port = unreachableClickToDial();
      expect(await failure(dial(lead, deps(port)))).toMatchObject({
        reason: 'dial_refused',
        refusals: ['company_number_missing'],
      });
      expect(port.calls).toBe(0);
    } finally {
      await run(exec, setEntityChannel, {
        entityId: ENTITY,
        channel: 'call_service_160',
        number: SERVICE,
        verified: true,
      });
    }
  });

  it('asks the caller for their own phone first', async () => {
    const lead = await leadOf({ source: 'website', consent: true, owner: colleague });
    const port = fakeClickToDial();
    expect(await failure(dial(lead, deps(port), colleague))).toMatchObject({
      code: 'validation_failed',
      reason: 'dial_phone_missing',
    });
    expect(port.placed).toHaveLength(0);
  });

  it('refuses a second press while the last call is being placed', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const at = nextMinute();
    const port = fakeClickToDial();
    await dial(lead, deps(port, at));
    expect(
      await failure(dial(lead, deps(port, new Date(at.getTime() + 10_000)))),
    ).toMatchObject({ code: 'conflict', reason: 'dial_in_progress' });
    expect(port.placed).toHaveLength(1);
  });

  it('records a call the provider refused as failed, and leaves one it did not answer dialling', async () => {
    const refusedLead = await leadOf({ source: 'website', consent: true });
    expect(
      await failure(dial(refusedLead, deps(fakeClickToDial({ fail: 'refused' })))),
    ).toMatchObject({ code: 'integration_unavailable', reason: 'dial_failed' });
    const [failed] = await asMigrator(
      (m) => m<{ status: string }[]>`
        select status from provider_calls where opportunity_id = ${refusedLead.id}`,
    );
    expect(failed?.status).toBe('failed');

    const slowLead = await leadOf({ source: 'website', consent: true });
    const slow = await dial(slowLead, deps(fakeClickToDial({ fail: 'uncertain' })));
    expect(slow.status).toBe('dialling');
    expect((await providerCall(slow.id)).provider_call_sid).toBeNull();
  });

  it('says calling is not set up on a runtime with no provider, writing nothing', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    expect(await failure(dial(lead, deps(undefined)))).toMatchObject({
      code: 'integration_unavailable',
      reason: 'calling_not_set_up',
    });
    const rows = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from provider_calls where opportunity_id = ${lead.id}`,
    );
    expect(rows[0]?.n).toBe(0);
  });
});

describe("calls.provider_call.record: the provider's reports", () => {
  async function placed(): Promise<{ lead: Lead; call: ProviderCallDto; sid: string }> {
    const lead = await leadOf({ source: 'website', consent: true });
    const call = await dial(lead, deps(fakeClickToDial()));
    return { lead, call, sid: `fake${call.id.replaceAll('-', '')}` };
  }

  it('is refused to a person, an agent and another company', async () => {
    const { call } = await placed();
    const input = { providerCallId: call.id, status: 'completed' };
    expect(await failure(report(input, exec))).toMatchObject({ code: 'forbidden' });
    expect(await failure(report(input, principalFor('agent:triage', [ENTITY])))).toMatchObject({
      code: 'forbidden',
    });
    expect(await failure(report({ ...input, entityId: 2 }))).toMatchObject({ code: 'forbidden' });
    expect(
      await failure(run(workers(2), recordProviderCall, { ...input, entityId: ENTITY })),
    ).toMatchObject({ code: 'forbidden' });
    // The workers acting for another company find no such call.
    expect(await run(workers(2), recordProviderCall, { ...input, entityId: 2 })).toMatchObject({
      outcome: 'missing',
    });
  });

  it('only moves a status forward: a repeated or late report changes nothing back', async () => {
    const { lead, call, sid } = await placed();
    const answeredAt = new Date(NOON.getTime() + 5_000).toISOString();
    const endedAt = new Date(NOON.getTime() + 95_000).toISOString();
    expect(await report({ providerCallId: call.id, callSid: sid, status: 'in_progress', answeredAt })).toEqual({
      providerCallId: call.id,
      outcome: 'moved',
      status: 'in_progress',
    });
    expect(
      await report({ providerCallId: call.id, callSid: sid, status: 'completed', endedAt, durationSeconds: 90 }),
    ).toMatchObject({ outcome: 'moved', status: 'completed' });
    // The same end again, an earlier status and another end all change nothing.
    for (const status of ['completed', 'ringing', 'in_progress', 'failed', 'no_answer']) {
      expect(
        await report({ providerCallId: call.id, callSid: sid, status, durationSeconds: 5 }),
      ).toMatchObject({ outcome: 'unchanged', status: 'completed' });
    }
    expect(await providerCall(call.id)).toMatchObject({
      status: 'completed',
      duration_s: 90,
      ended_at: new Date(endedAt),
      answered_at: new Date(answeredAt),
    });
    // The end is announced once, with ids, codes and counts only.
    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload: Record<string, unknown> }[]>`
        select type, payload_json as payload from outbox_events where aggregate_id = ${call.id}`,
    );
    expect(events).toEqual([
      {
        type: 'calls.dial.completed',
        payload: {
          v: 1,
          opportunityId: lead.id,
          callerId: caller.id,
          status: 'completed',
          durationSeconds: 90,
        },
      },
    ]);
  });

  it("takes the provider's id from a report when the dial could not record it, and never another call's", async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const call = await dial(lead, deps(fakeClickToDial({ fail: 'uncertain' })));
    const sid = `late${newId().replaceAll('-', '')}`;
    expect(await report({ providerCallId: call.id, callSid: sid, status: 'no_answer' })).toMatchObject({
      outcome: 'moved',
      status: 'no_answer',
    });
    expect((await providerCall(call.id)).provider_call_sid).toBe(sid);
    // Another id for the same call, or this id for another call, is not taken.
    expect(
      await report({ providerCallId: call.id, callSid: `other${newId().replaceAll('-', '')}`, status: 'completed' }),
    ).toMatchObject({ outcome: 'other_call' });
    const { call: second } = await placed();
    expect(await report({ providerCallId: second.id, callSid: sid, status: 'completed' })).toMatchObject({
      outcome: 'other_call',
    });
  });

  it('holds the forward-only rule in the database for every role, the table owner included', async () => {
    const { call } = await placed();
    await report({ providerCallId: call.id, status: 'completed', durationSeconds: 3 });
    await expect(
      asMigrator((m) => m`update provider_calls set status = 'ringing' where id = ${call.id}`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      asMigrator((m) => m`update provider_calls set duration_s = 4 where id = ${call.id}`),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      asMigrator((m) => m`delete from provider_calls where id = ${call.id}`),
    ).rejects.toThrow();
  });
});

describe('call recordings: kept, removed after the retention period, played only with the permission', () => {
  const sha = 'a'.repeat(64);

  async function ended(): Promise<{ lead: Lead; call: ProviderCallDto }> {
    const lead = await leadOf({ source: 'website', consent: true });
    const call = await dial(lead, deps(fakeClickToDial()));
    await report({ providerCallId: call.id, status: 'completed', durationSeconds: 40 });
    return { lead, call };
  }

  function attach(callId: string, fileId: string = newId(), who: Principal = workers()) {
    return run(who, attachCallRecording, {
      entityId: ENTITY,
      providerCallId: callId,
      fileId,
      bucket: 'test',
      key: callRecordingKey(ENTITY, fileId, 'audio/mpeg'),
      contentType: 'audio/mpeg',
      size: 2048,
      sha256: sha,
    });
  }

  it('keeps a recording of an ended call once, as the platform', async () => {
    const { call } = await ended();
    const fileId = newId();
    expect(await failure(attach(call.id, fileId, exec))).toMatchObject({ code: 'forbidden' });
    expect(await attach(call.id, fileId)).toEqual({
      providerCallId: call.id,
      outcome: 'attached',
      fileId,
    });
    expect(await attach(call.id, fileId)).toMatchObject({ outcome: 'already', fileId });
    expect(await attach(call.id)).toMatchObject({ outcome: 'other_file', fileId });
    const [file] = await asMigrator(
      (m) => m<{ purpose: string; status: string; key: string }[]>`
        select purpose, status, key from files where id = ${fileId}`,
    );
    expect(file).toEqual({
      purpose: 'call_recording',
      status: 'ready',
      key: `${String(ENTITY)}/call_recording/${fileId}.mp3`,
    });
    // A call still ringing has no recording yet; a key not the file's own is refused.
    const lead = await leadOf({ source: 'website', consent: true });
    const ringing = await dial(lead, deps(fakeClickToDial()));
    expect(await attach(ringing.id)).toMatchObject({ outcome: 'not_ended', fileId: null });
    expect(
      await failure(
        run(workers(), attachCallRecording, {
          entityId: ENTITY,
          providerCallId: call.id,
          fileId: newId(),
          bucket: 'test',
          key: 'elsewhere/recording.mp3',
          contentType: 'audio/mpeg',
          size: 1,
          sha256: sha,
        }),
      ),
    ).toMatchObject({ reason: 'file_upload_mismatch' });
  });

  it('plays a recording to a listener whose scope covers the lead, auditing every listen', async () => {
    const { call } = await ended();
    const fileId = newId();
    await attach(call.id, fileId);
    const input = { entityId: ENTITY, providerCallId: call.id };
    // The caller who made it holds no calls.recording.listen; an agent never does.
    expect(await failure(run(caller, playCallRecording, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await failure(run(principalFor('agent:triage', [ENTITY]), playCallRecording, input)),
    ).toMatchObject({ code: 'forbidden' });
    // A team lead of another team, and the company outside the request, do not hear it.
    expect(await failure(run(otherTeamLead, playCallRecording, input))).toMatchObject({
      code: 'not_found',
      reason: 'recording_missing',
    });
    expect(
      await failure(run(teamLead, playCallRecording, { ...input, entityId: 2 })),
    ).toMatchObject({ code: 'forbidden' });

    const requestIds = [newId(), newId()];
    for (const requestId of requestIds) {
      const answer = await executeCommand(
        teamLead,
        { entityIds: [ENTITY], requestId },
        playCallRecording,
        input,
        { hosted: false },
      );
      expect(answer).toEqual({
        providerCallId: call.id,
        fileId,
        bucket: 'test',
        key: `${String(ENTITY)}/call_recording/${fileId}.mp3`,
        name: 'call-recording.mp3',
        contentType: 'audio/mpeg',
      });
    }
    const listens = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from audit_logs
         where command = 'calls.recording.play' and outcome = 'ok'
           and request_id = any(${requestIds}::text[]) and actor_principal_id = ${teamLead.id}`,
    );
    expect(listens[0]?.n).toBe(2);
    // The recording is never readable as a file, even by its listener.
    const visible = await asPrincipal(teamLead, ({ tx }) =>
      tx.execute(sql`select id from files where id = ${fileId}`),
    );
    expect(visible).toHaveLength(0);
  });

  it('removes recordings past the retention period, keeping the call and its file row', async () => {
    const { call } = await ended();
    const fileId = newId();
    await attach(call.id, fileId);
    await asMigrator(
      (m) => m`update files set created_at = now() - interval '13 months' where id = ${fileId}`,
    );
    const due = await asPrincipal(workers(), ({ tx }) =>
      tx.execute(
        sql`select file_id from app.call_recordings_due(now() - interval '12 months', 500)`,
      ),
    );
    expect((due as unknown as { file_id: string }[]).map((r) => r.file_id)).toContain(fileId);
    expect(await failure(run(exec, deleteCallRecording, { entityId: ENTITY, fileId }))).toMatchObject({
      code: 'forbidden',
    });
    expect(await run(workers(), deleteCallRecording, { entityId: ENTITY, fileId })).toEqual({
      fileId,
      deleted: true,
    });
    expect(await run(workers(), deleteCallRecording, { entityId: ENTITY, fileId })).toEqual({
      fileId,
      deleted: false,
    });
    expect((await providerCall(call.id)).recording_file_id).toBe(fileId);
    expect(
      await failure(run(teamLead, playCallRecording, { entityId: ENTITY, providerCallId: call.id })),
    ).toMatchObject({ reason: 'recording_missing' });
  });
});

describe('calls.call.log of a dialled call', () => {
  async function outcomeId(): Promise<string> {
    const [row] = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from call_dispositions
         where entity_id is null and segment is null and archived_at is null and next_action = 'retry'
         order by position limit 1`,
    );
    if (!row) throw new Error('no retry outcome seeded');
    return row.id;
  }

  it("takes the provider call's start, length and line, and links it once", async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const at = nextMinute();
    const call = await dial(lead, deps(fakeClickToDial(), at));
    await report({ providerCallId: call.id, status: 'completed', durationSeconds: 75 });
    const loggedAt = new Date(at.getTime() + 3 * MINUTE);
    const input = {
      entityId: ENTITY,
      opportunityId: lead.id,
      dispositionId: await outcomeId(),
      providerCallId: call.id,
      durationSeconds: 20,
    };
    const logged = (await run(caller, logCall, input, loggedAt)) as {
      call: { id: string; startedAt: string; durationS: number; numberSeries: string };
    };
    expect(logged.call).toMatchObject({
      startedAt: at.toISOString(),
      durationS: 75,
      numberSeries: '160',
    });
    expect((await providerCall(call.id)).call_id).toBe(logged.call.id);
    expect(await failure(run(caller, logCall, input, loggedAt))).toMatchObject({
      code: 'conflict',
      reason: 'provider_call_logged',
    });
  });

  it('refuses a dialled call of another lead', async () => {
    const lead = await leadOf({ source: 'website', consent: true });
    const call = await dial(lead, deps(fakeClickToDial()));
    const other = await leadOf({ source: 'website', consent: true });
    expect(
      await failure(
        run(
          caller,
          logCall,
          {
            entityId: ENTITY,
            opportunityId: other.id,
            dispositionId: await outcomeId(),
            providerCallId: call.id,
          },
          nextMinute(),
        ),
      ),
    ).toMatchObject({ code: 'not_found', reason: 'provider_call_missing' });
  });
});
