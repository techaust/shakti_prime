import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type InboundCallRecordDto,
  type NoticeBatchDto,
  type Principal,
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
  whatsappCustomer,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeQuery } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { inboundCallLines, recordInboundCall } from '../../src/commands/calls/inbound-calls';
import { notifyEvent } from '../../src/commands/notifications/notify';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// T4 Inbound calls (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05 and CRM-01): the platform
// records a customer's call to a company's IVR or missed-call number through the calls.process
// definers, matches the company's customers holding the number (none, one or several; never
// another company's), finds the person the IVR rings by their own dial phone, and for a missed
// call makes or joins the lead with a callback for its owner inside calling hours; a repeated
// CallSid changes nothing. Company 4 holds the suite's lines (synthetic numbers no other suite
// uses); company 1 is the other company.

const ENTITY = 4;
const OTHER = 1;
const IVR = '+918047119401';
const MISSED = '+918047119402';
const OTHER_IVR = '+918047119403';
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Yesterday at 11:00 IST, inside calling hours; and 22:00 IST the same day, after them. */
const YESTERDAY = new Date(Date.now() - DAY).toLocaleDateString('en-CA', {
  timeZone: 'Asia/Kolkata',
});
const IN_HOURS = new Date(`${YESTERDAY}T11:00:00+05:30`);
const AFTER_HOURS = new Date(`${YESTERDAY}T22:00:00+05:30`);
/** The next opening after 22:00 IST: 09:00 IST the day after. */
const NEXT_OPENING = new Date(IN_HOURS.getTime() + 22 * HOUR);

let exec: Principal;
let caller: Principal;
let callerPhone: string;

const workers = (entityId: number = ENTITY): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run<T>(principal: Principal, command: AnyCommand, input: unknown, now?: Date): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, ...(now === undefined ? {} : { now }) }, input),
  ) as Promise<T>;
}

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  throw new Error('expected a refusal');
}

const sid = (): string => `t4${newId().replaceAll('-', '')}`;

function call(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    entityId: ENTITY,
    series: 'ivr',
    callSid: sid(),
    from: `+91${testPhone()}`,
    ...overrides,
  };
}

/** The company's active line of a kind is this number (a line replaced stays out of use). */
async function line(entityId: number, channel: 'ivr' | 'missed_call', number: string) {
  await asMigrator(async (m) => {
    const [current] = await m<{ number_e164: string }[]>`
      select number_e164 from entity_channels
       where entity_id = ${entityId} and channel = ${channel} and is_active`;
    if (current?.number_e164 === number) return;
    await m`update entity_channels set is_active = false
             where entity_id = ${entityId} and channel = ${channel} and is_active`;
    await m`insert into entity_channels (id, entity_id, channel, number_e164, created_by)
             values (${newId()}, ${entityId}, ${channel}, ${number}, ${exec.id})`;
  });
}

async function eventsOf(aggregateId: string) {
  return asOutboxPublisher(
    (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by sequence`,
  );
}

async function providerCall(id: string) {
  const [row] = await asMigrator(
    (m) => m<
      {
        entity_id: number;
        opportunity_id: string | null;
        contact_phone_id: string | null;
        caller_id: string | null;
        direction: string;
        series: string;
        status: string;
        purpose: string | null;
      }[]
    >`select entity_id, opportunity_id, contact_phone_id, caller_id, direction, series, status, purpose
        from provider_calls where id = ${id}`,
  );
  return row;
}

async function openCallbacks(opportunityId: string) {
  return asMigrator(
    (m) => m<{ id: string; assignee_id: string; due_at: Date }[]>`
      select id, assignee_id, due_at from tasks
       where opportunity_id = ${opportunityId} and kind = 'callback' and state = 'open'
       order by due_at`,
  );
}

/** Every caller profile of the company but this person's is away; theirs is present. */
async function onlyPresent(userId: string): Promise<void> {
  await asMigrator(async (m) => {
    await m`update caller_profiles set presence = 'away' where entity_id = ${ENTITY}`;
    await m`insert into caller_profiles (id, user_id, entity_id, presence)
              values (${newId()}, ${userId}, ${ENTITY}, 'present')
            on conflict (user_id, entity_id) do update set presence = 'present'`;
  });
}

beforeAll(async () => {
  exec = await createTestPrincipal('executive', [ENTITY]);
  const team = await createTestTeam(ENTITY, 'inbound team');
  const user = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId: team },
  ]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id, teamId: team });
  callerPhone = `+91${testPhone()}`;
  await asMigrator(
    (m) => m`insert into caller_profiles (id, user_id, entity_id, presence, dial_phone_e164)
               values (${newId()}, ${caller.id}, ${ENTITY}, 'present', ${callerPhone})
             on conflict (user_id, entity_id) do update set dial_phone_e164 = ${callerPhone}`,
  );
  await line(ENTITY, 'ivr', IVR);
  await line(ENTITY, 'missed_call', MISSED);
  await line(OTHER, 'ivr', OTHER_IVR);
});

afterAll(closeDb);

describe('calls.inbound_call.record: who may record an inbound call', () => {
  it('refuses a person, even an Executive, and an agent: calls.process is the platform’s alone', async () => {
    expect(await refusal(run(exec, recordInboundCall, call()))).toBe('forbidden');
    expect(
      await refusal(run(principalFor('agent:copilot', [ENTITY]), recordInboundCall, call())),
    ).toBe('forbidden');
  });

  it('refuses a company outside the request', async () => {
    expect(await refusal(run(workers(ENTITY), recordInboundCall, call({ entityId: OTHER })))).toBe(
      'forbidden',
    );
  });

  it('finds a line by the number dialled, for the platform only', async () => {
    const lines = await asPrincipal(workers(ENTITY), (context) =>
      inboundCallLines(context, MISSED),
    );
    expect(lines).toEqual([{ entityId: ENTITY, series: 'missed_call' }]);
    await expect(
      executeQuery(caller, { entityIds: [ENTITY], requestId: newId() }, (ctx) =>
        inboundCallLines(ctx, IVR),
      ),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});

describe('calls.inbound_call.record on the IVR line', () => {
  it('matches no customer, rings the person whose dial phone it is, and never stores the number', async () => {
    const input = call({ dialWhom: callerPhone.replace('+91', '0') });
    const out = await run<InboundCallRecordDto>(workers(), recordInboundCall, input, IN_HOURS);
    expect(out).toMatchObject({
      outcome: 'recorded',
      series: 'ivr',
      answererId: caller.id,
      accountIds: [],
      leadId: null,
      taskId: null,
    });
    const id = out.providerCallId ?? '';
    expect(await providerCall(id)).toEqual({
      entity_id: ENTITY,
      opportunity_id: null,
      contact_phone_id: null,
      caller_id: caller.id,
      direction: 'inbound',
      series: 'ivr',
      status: 'ringing',
      purpose: null,
    });
    expect(await eventsOf(id)).toEqual([
      {
        type: 'calls.inbound.ringing',
        payload_json: { v: 1, userId: caller.id, accountIds: [] },
      },
    ]);
  });

  it('matches the one customer of the company with the number', async () => {
    const customer = await whatsappCustomer(ENTITY);
    const out = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ from: customer.e164, dialWhom: callerPhone }),
    );
    expect(out.accountIds).toEqual([customer.accountId]);
    expect(await eventsOf(out.providerCallId ?? '')).toEqual([
      {
        type: 'calls.inbound.ringing',
        payload_json: { v: 1, userId: caller.id, accountIds: [customer.accountId] },
      },
    ]);
  });

  it('matches several customers sharing the number, oldest first, and never another company’s', async () => {
    const first = await whatsappCustomer(ENTITY);
    const second = await whatsappCustomer(ENTITY, { e164: first.e164 });
    const elsewhere = await whatsappCustomer(OTHER, { e164: first.e164 });
    const out = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ from: first.e164, dialWhom: callerPhone }),
    );
    expect(out.accountIds).toEqual([first.accountId, second.accountId]);
    expect(out.accountIds).not.toContain(elsewhere.accountId);

    // The other company's own IVR finds only its own customer.
    const theirs = await run<InboundCallRecordDto>(
      workers(OTHER),
      recordInboundCall,
      call({ entityId: OTHER, from: first.e164 }),
    );
    expect(theirs.accountIds).toEqual([elsewhere.accountId]);
    // Nobody of the other company has this dial phone, so the call rings no one there.
    expect(theirs.answererId).toBeNull();
    expect(await eventsOf(theirs.providerCallId ?? '')).toEqual([]);
  });

  it('rings nobody for a dial phone of no one in the company, or of two people', async () => {
    const nobody = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ dialWhom: `+91${testPhone()}` }),
    );
    expect(nobody.answererId).toBeNull();

    const shared = `+91${testPhone()}`;
    for (let i = 0; i < 2; i += 1) {
      const u = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc' }]);
      await asMigrator(
        (m) => m`insert into caller_profiles (id, user_id, entity_id, presence, dial_phone_e164)
                   values (${newId()}, ${u.id}, ${ENTITY}, 'away', ${shared})`,
      );
    }
    const two = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ dialWhom: shared }),
    );
    expect(two.answererId).toBeNull();
    expect(await eventsOf(two.providerCallId ?? '')).toEqual([]);
  });

  it('changes nothing for a repeated CallSid, and records nothing for one another company holds', async () => {
    const input = call({ dialWhom: callerPhone });
    const first = await run<InboundCallRecordDto>(workers(), recordInboundCall, input);
    const again = await run<InboundCallRecordDto>(workers(), recordInboundCall, input);
    expect(again).toMatchObject({
      outcome: 'repeat',
      providerCallId: first.providerCallId,
      answererId: null,
      accountIds: [],
    });
    expect(await eventsOf(first.providerCallId ?? '')).toHaveLength(1);
    const audited = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from audit_logs
         where aggregate_type = 'provider_call' and aggregate_id = ${first.providerCallId}`,
    );
    expect(audited[0]?.n).toBe(1);

    const elsewhere = await run<InboundCallRecordDto>(workers(OTHER), recordInboundCall, {
      ...input,
      entityId: OTHER,
    });
    expect(elsewhere).toMatchObject({ outcome: 'other_company', providerCallId: null });
  });
});

describe('calls.inbound_call.record on the missed-call line', () => {
  it('makes the lead and a callback due now for its owner, inside calling hours', async () => {
    await onlyPresent(caller.id);
    const out = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ series: 'missed_call' }),
      IN_HOURS,
    );
    expect(out).toMatchObject({ outcome: 'recorded', series: 'missed_call', ownerId: caller.id });
    expect(out.taskDueAt).toBe(IN_HOURS.toISOString());
    const id = out.providerCallId ?? '';
    expect(await providerCall(id)).toMatchObject({
      opportunity_id: out.leadId,
      direction: 'inbound',
      series: 'missed_call',
      status: 'no_answer',
      caller_id: null,
    });
    const callbacks = await openCallbacks(out.leadId ?? '');
    expect(callbacks).toEqual([{ id: out.taskId, assignee_id: caller.id, due_at: IN_HOURS }]);
    const lead = await asMigrator(
      (m) => m<{ code: string }[]>`
        select s.code from opportunities o join lead_sources s on s.id = o.source_id
         where o.id = ${out.leadId}`,
    );
    expect(lead).toEqual([{ code: 'missed_call' }]);
    expect(await eventsOf(id)).toEqual([
      {
        type: 'calls.missed.recorded',
        payload_json: { v: 1, opportunityId: out.leadId, ownerId: caller.id, taskId: out.taskId },
      },
    ]);
  });

  it('puts a callback for a call after hours at the next opening', async () => {
    await onlyPresent(caller.id);
    const out = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ series: 'missed_call' }),
      AFTER_HOURS,
    );
    expect(out.taskDueAt).toBe(NEXT_OPENING.toISOString());
    expect((await openCallbacks(out.leadId ?? '')).map((t) => t.due_at)).toEqual([NEXT_OPENING]);
  });

  it('makes the lead for a known customer, and a second missed call no second callback', async () => {
    await onlyPresent(caller.id);
    const customer = await whatsappCustomer(ENTITY);
    const first = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ series: 'missed_call', from: customer.e164 }),
      IN_HOURS,
    );
    expect(first.accountIds).toEqual([customer.accountId]);
    expect(first.ownerId).not.toBeNull();
    expect((await openCallbacks(first.leadId ?? '')).map((t) => t.assignee_id)).toEqual([
      first.ownerId,
    ]);
    const second = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ series: 'missed_call', from: customer.e164 }),
      new Date(IN_HOURS.getTime() + HOUR),
    );
    // The second call joins the lead the first made; the callback already due stands.
    expect(second).toMatchObject({ outcome: 'recorded', leadId: first.leadId, taskId: null });
    expect(await openCallbacks(first.leadId ?? '')).toHaveLength(1);
  });

  it('changes nothing for a repeated CallSid: no second lead, call, callback or event', async () => {
    await onlyPresent(caller.id);
    const input = call({ series: 'missed_call' });
    const first = await run<InboundCallRecordDto>(workers(), recordInboundCall, input, IN_HOURS);
    const again = await run<InboundCallRecordDto>(workers(), recordInboundCall, input, IN_HOURS);
    expect(again).toMatchObject({
      outcome: 'repeat',
      providerCallId: first.providerCallId,
      taskId: null,
    });
    expect(await openCallbacks(first.leadId ?? '')).toHaveLength(1);
    expect(await eventsOf(first.providerCallId ?? '')).toHaveLength(1);
    const leads = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from opportunities o
          join account_contacts ac on ac.account_id = o.account_id
          join contact_phones cp on cp.contact_id = ac.contact_id
         where cp.e164 = ${String(input.from)}`,
    );
    expect(leads[0]?.n).toBe(1);
  });

  it('tells the lead’s owner once, however often the event comes', async () => {
    await onlyPresent(caller.id);
    const out = await run<InboundCallRecordDto>(
      workers(),
      recordInboundCall,
      call({ series: 'missed_call' }),
      IN_HOURS,
    );
    const input = {
      event: 'calls.missed.recorded',
      entityId: ENTITY,
      eventId: newId(),
      providerCallId: out.providerCallId,
      opportunityId: out.leadId,
      ownerId: out.ownerId,
    };
    const batch = await run<NoticeBatchDto>(workers(), notifyEvent, input);
    expect(batch.notices.map((n) => ({ userId: n.userId, type: n.type }))).toEqual([
      { userId: caller.id, type: 'missed_call' },
    ]);
    const again = await run<NoticeBatchDto>(workers(), notifyEvent, { ...input, eventId: newId() });
    expect(again.notices).toEqual([]);
    // A person is refused the notify command.
    expect(await refusal(run(exec, notifyEvent, input))).toBe('forbidden');
  });
});
