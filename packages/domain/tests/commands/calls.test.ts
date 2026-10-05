import { newId, type LogCallResultDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { logCall } from '../../src/commands/calls/log-call';
import { createLead } from '../../src/commands/crm/create-lead';
import { nurtureOpportunity } from '../../src/commands/crm/nurture-opportunity';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// calls.log (docs/design/phase1.md §7.2, PRD TEL-01): a person logs a call they made by hand, and
// the outcome's next step runs: a callback, the retry rule (three attempts on day 1, 2 and 3, the
// owner's default for CALL-3), nurture with its calls on day 7, 30 and 90 (CALL-5), the move to
// Qualified, or the lead lost. The suite works in company 4 with an outcome list of its own for
// farmer pumps, so every next step has a key and no other suite's list changes what it reads.

const ENTITY = 4;
/** An instant given as IST wall-clock time. */
const ist = (local: string): Date => new Date(`${local}+05:30`);
/** Mid-morning on a Monday: inside calling hours. */
const MONDAY = ist('2030-03-04T11:00:00');

const OUTCOMES = {
  callback: newId(),
  retry: newId(),
  qualified: newId(),
  not_interested: newId(),
  wrong_number: newId(),
  nurture: newId(),
} as const;

let teamId: string;
let caller: Principal;
let colleague: Principal;
let teamLead: Principal;

beforeAll(async () => {
  await asMigrator(async (m) => {
    await m`update call_dispositions set archived_at = now()
             where entity_id = ${ENTITY} and segment = 'farmer_pumps' and archived_at is null`;
    let key = 1;
    for (const [nextAction, id] of Object.entries(OUTCOMES)) {
      await m`insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position)
               values (${id}, ${ENTITY}, 'farmer_pumps', ${key}, ${`suite_${nextAction}`},
                       ${`Suite ${nextAction}`}, ${nextAction}, ${key})`;
      key += 1;
    }
  });
  teamId = await createTestTeam(ENTITY, 'calls team');
  const callerUser = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId },
  ]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: callerUser.id, teamId });
  const colleagueUser = await createTestUser([
    { entityId: ENTITY, roleKey: 'tele_caller_cc', teamId },
  ]);
  colleague = await createTestPrincipal('tele_caller_cc', [ENTITY], {
    id: colleagueUser.id,
    teamId,
  });
  const leadUser = await createTestUser([
    { entityId: ENTITY, roleKey: 'sales_team_lead', teamId },
  ]);
  teamLead = await createTestPrincipal('sales_team_lead', [ENTITY], { id: leadUser.id, teamId });
});

afterAll(async () => {
  await asMigrator(
    (m) => m`update call_dispositions set archived_at = now()
              where id = any(${Object.values(OUTCOMES)}::uuid[]) and archived_at is null`,
  );
  await closeDb();
});

function run(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  now: Date = MONDAY,
): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, now }, input),
  );
}

const phone = (): string => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function leadOf(owner: Principal): Promise<string> {
  const lead = (await run(
    owner,
    createLead,
    {
      entityId: ENTITY,
      pipelineKey: 'farmer_pumps',
      contact: { name: 'Calls customer', phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Phulera', pin: '303338' },
    },
    new Date(),
  )) as { id: string };
  return lead.id;
}

function log(
  who: Principal,
  opportunityId: string,
  outcome: keyof typeof OUTCOMES,
  extra: object = {},
  now: Date = MONDAY,
): Promise<LogCallResultDto> {
  return run(
    who,
    logCall,
    { entityId: ENTITY, opportunityId, dispositionId: OUTCOMES[outcome], ...extra },
    now,
  ) as Promise<LogCallResultDto>;
}

interface TaskRow {
  kind: string;
  state: string;
  due_at: Date;
  assignee_id: string;
}

function tasksOf(opportunityId: string): Promise<TaskRow[]> {
  return asMigrator(
    (m) => m<TaskRow[]>`select kind, state, due_at, assignee_id from tasks
                         where opportunity_id = ${opportunityId} order by due_at, id`,
  );
}

async function leadState(opportunityId: string): Promise<{ state: string; stage: string }> {
  const [row] = await asMigrator(
    (m) => m<{ state: string; stage: string }[]>`
      select o.state, ps.key as stage from opportunities o
        join pipeline_stages ps on ps.id = o.stage_id where o.id = ${opportunityId}`,
  );
  if (!row) throw new Error('lead missing');
  return row;
}

const reason = (r: string) => ({ details: { reason: r } });

describe('calls.log: who may log a call', () => {
  it('is refused to a role that does not log calls', async () => {
    const lead = await leadOf(caller);
    const accounts = await createTestPrincipal('accounts', [ENTITY]);
    await expect(log(accounts, lead, 'retry')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('is refused to an agent, whatever it holds', async () => {
    const lead = await leadOf(caller);
    const agent = principalFor('agent:copilot', [ENTITY], {
      permissions: [
        { key: 'crm.lead.read', scope: 'entity' },
        { key: 'crm.lead.write', scope: 'entity' },
        { key: 'calls.log', scope: 'entity' },
      ],
    });
    await expect(log(agent, lead, 'retry')).rejects.toMatchObject(reason('people_only'));
  });

  it('is refused for another company, and for a lead of another company', async () => {
    const lead = await leadOf(caller);
    await expect(
      run(caller, logCall, { entityId: 1, opportunityId: lead, dispositionId: OUTCOMES.retry }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const everywhere = await createTestPrincipal('general_manager', [1, ENTITY]);
    await expect(
      run(everywhere, logCall, {
        entityId: 1,
        opportunityId: lead,
        dispositionId: OUTCOMES.retry,
      }),
    ).rejects.toMatchObject(reason('lead_missing'));
  });

  it('is refused on a colleague’s lead the caller cannot see', async () => {
    const lead = await leadOf(colleague);
    await expect(log(caller, lead, 'retry')).rejects.toMatchObject(reason('lead_missing'));
  });

  it('a team lead logs a call on a lead of the team, and the next call is the owner’s', async () => {
    const lead = await leadOf(caller);
    const result = await log(teamLead, lead, 'retry');
    expect(result.call.callerId).toBe(teamLead.id);
    const [retry] = (await tasksOf(lead)).filter((t) => t.state === 'open');
    expect(retry).toMatchObject({ kind: 'callback', assignee_id: caller.id });
  });
});

describe('calls.log: what every call records', () => {
  it('writes the call, its timeline row and its audit row', async () => {
    const lead = await leadOf(caller);
    const result = await log(caller, lead, 'retry', { durationSeconds: 42 });
    expect(result.call).toMatchObject({
      opportunityId: lead,
      callerId: caller.id,
      direction: 'outbound',
      numberSeries: 'manual',
      dispositionId: OUTCOMES.retry,
      attemptNo: 1,
      durationS: 42,
      startedAt: new Date(MONDAY.getTime() - 42_000).toISOString(),
    });
    const [activity] = await asMigrator(
      (m) => m<{ payload_json: Record<string, unknown> }[]>`
        select payload_json from activities where opportunity_id = ${lead} and type = 'call_logged'`,
    );
    expect(activity?.payload_json).toMatchObject({
      callId: result.call.id,
      code: 'suite_retry',
      nextAction: 'retry',
      attemptNo: 1,
    });
    const [row] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs where aggregate_id = ${result.call.id} and command = 'calls.log'`,
    );
    expect(row?.after_json).toMatchObject({
      outcome: 'suite_retry',
      nextAction: 'retry',
      attemptNo: 1,
      durationSeconds: 42,
    });
  });

  it('is refused outside calling hours, before 9 AM and from 9 PM', async () => {
    const lead = await leadOf(caller);
    for (const at of [ist('2030-03-04T08:59:00'), ist('2030-03-04T21:00:00')]) {
      await expect(log(caller, lead, 'retry', {}, at)).rejects.toMatchObject(
        reason('outside_calling_hours'),
      );
    }
  });

  it('is refused for a customer who withdrew consent to calls, until a new consent', async () => {
    const lead = await leadOf(caller);
    const [contact] = await asMigrator(
      (m) => m<{ id: string }[]>`
        select ac.contact_id as id from opportunities o
          join account_contacts ac on ac.account_id = o.account_id where o.id = ${lead}`,
    );
    if (!contact) throw new Error('contact missing');
    await asMigrator(
      (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version,
                                     given_at, withdrawn_at, created_by)
               values (${newId()}, ${contact.id}, 'call', 'service', 'verbal', 'v1',
                       now() - interval '2 days', now() - interval '1 day', ${caller.id})`,
    );
    await expect(log(caller, lead, 'retry')).rejects.toMatchObject(reason('call_consent_withdrawn'));
    await asMigrator(
      (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version,
                                     given_at, created_by)
               values (${newId()}, ${contact.id}, 'call', 'service', 'verbal', 'v1', now(),
                       ${caller.id})`,
    );
    await expect(log(caller, lead, 'retry')).resolves.toMatchObject({ nextAction: 'retry' });
  });

  it('refuses an outcome that is not on the lead’s list', async () => {
    const lead = await leadOf(caller);
    const [group] = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id from call_dispositions
         where entity_id is null and segment is null and archived_at is null limit 1`,
    );
    await expect(
      run(caller, logCall, { entityId: ENTITY, opportunityId: lead, dispositionId: group?.id }),
    ).rejects.toMatchObject(reason('disposition_not_offered'));
  });

  it('refuses a closed lead', async () => {
    const lead = await leadOf(caller);
    await log(caller, lead, 'not_interested', { lostReason: 'not_interested' });
    await expect(log(caller, lead, 'retry')).rejects.toMatchObject(reason('call_lead_closed'));
  });
});

describe('calls.log: a callback', () => {
  it('sets a callback at the time the caller picks', async () => {
    const lead = await leadOf(caller);
    const at = ist('2030-03-05T16:30:00');
    const result = await log(caller, lead, 'callback', { callbackAt: at.toISOString() });
    expect(result.nextCall).toEqual({ kind: 'callback', dueAt: at.toISOString() });
    expect(await tasksOf(lead)).toEqual([
      expect.objectContaining({ kind: 'callback', state: 'open', due_at: at }),
    ]);
  });

  it('needs a time in the future, inside calling hours and within 90 days', async () => {
    const lead = await leadOf(caller);
    const cases = [
      [undefined, 'callback_time_missing'],
      [ist('2030-03-04T10:00:00'), 'callback_in_past'],
      [ist('2030-03-05T22:00:00'), 'callback_outside_calling_hours'],
      [ist('2030-07-01T10:00:00'), 'callback_too_far'],
    ] as const;
    for (const [at, why] of cases) {
      await expect(
        log(caller, lead, 'callback', at === undefined ? {} : { callbackAt: at.toISOString() }),
      ).rejects.toMatchObject(reason(why));
    }
    expect(await tasksOf(lead)).toEqual([]);
  });

  it('a later call settles the callback: done when due, cancelled when not', async () => {
    const lead = await leadOf(caller);
    await log(caller, lead, 'callback', {
      callbackAt: ist('2030-03-04T15:00:00').toISOString(),
    });
    // Called again at 16:00 the same day, after the callback fell due.
    await log(caller, lead, 'callback', { callbackAt: ist('2030-03-06T10:00:00').toISOString() }, ist('2030-03-04T16:00:00'));
    // Called again before that one falls due.
    await log(caller, lead, 'retry', {}, ist('2030-03-05T10:00:00'));
    const states = (await tasksOf(lead)).map((t) => [t.due_at.toISOString(), t.state]);
    expect(states).toEqual([
      [ist('2030-03-04T15:00:00').toISOString(), 'done'],
      [ist('2030-03-06T09:00:00').toISOString(), 'open'],
      [ist('2030-03-06T10:00:00').toISOString(), 'cancelled'],
    ]);
  });
});

describe('calls.log: the retry rule and nurture (owner’s defaults of 05-10-2026)', () => {
  it('three unanswered attempts on day 1, 2 and 3, then nurture with calls on day 7, 30 and 90', async () => {
    const lead = await leadOf(caller);
    const first = await log(caller, lead, 'retry');
    expect(first).toMatchObject({
      leadState: 'open',
      attemptsUsedUp: false,
      call: { attemptNo: 1 },
      nextCall: { kind: 'callback', dueAt: ist('2030-03-05T09:00:00').toISOString() },
    });

    const second = await log(caller, lead, 'retry', {}, ist('2030-03-05T09:20:00'));
    expect(second).toMatchObject({
      call: { attemptNo: 2 },
      nextCall: { kind: 'callback', dueAt: ist('2030-03-06T09:00:00').toISOString() },
    });

    const third = await log(caller, lead, 'retry', {}, ist('2030-03-06T12:00:00'));
    expect(third).toMatchObject({
      call: { attemptNo: 3 },
      leadState: 'nurture',
      attemptsUsedUp: true,
      nextCall: { kind: 'nurture', dueAt: ist('2030-03-13T09:00:00').toISOString() },
    });
    expect((await leadState(lead)).state).toBe('nurture');
    const tasks = await tasksOf(lead);
    expect(tasks.map((t) => [t.kind, t.state, t.due_at.toISOString()])).toEqual([
      ['callback', 'done', ist('2030-03-05T09:00:00').toISOString()],
      ['callback', 'done', ist('2030-03-06T09:00:00').toISOString()],
      ['nurture', 'open', ist('2030-03-13T09:00:00').toISOString()],
      ['nurture', 'open', ist('2030-04-05T09:00:00').toISOString()],
      ['nurture', 'open', ist('2030-06-04T09:00:00').toISOString()],
    ]);
    const [nurtured] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs
         where aggregate_id = ${lead} and command = 'crm.opportunity.nurture'`,
    );
    expect(nurtured?.after_json).toMatchObject({ nurtureReason: 'not_reachable' });
  });

  it('an answered call starts the count again', async () => {
    const lead = await leadOf(caller);
    await log(caller, lead, 'retry');
    await log(caller, lead, 'callback', { callbackAt: ist('2030-03-05T11:00:00').toISOString() });
    const again = await log(caller, lead, 'retry', {}, ist('2030-03-05T11:05:00'));
    expect(again.call.attemptNo).toBe(1);
  });

  it('a nurture call that is not answered keeps the lead in nurture with its later calls', async () => {
    const lead = await leadOf(caller);
    await run(caller, nurtureOpportunity, {
      entityId: ENTITY,
      opportunityId: lead,
      reasonCode: 'waiting_for_funds',
    });
    // Day 7's call, made on day 7.
    const result = await log(caller, lead, 'retry', {}, ist('2030-03-11T10:00:00'));
    expect(result).toMatchObject({ leadState: 'nurture', nextCall: null, attemptsUsedUp: false });
    expect((await tasksOf(lead)).map((t) => t.state)).toEqual(['done', 'open', 'open']);
  });

  it('a nurture call that is answered opens the lead again for its callback', async () => {
    const lead = await leadOf(caller);
    await run(caller, nurtureOpportunity, {
      entityId: ENTITY,
      opportunityId: lead,
      reasonCode: 'waiting_for_season',
    });
    const at = ist('2030-03-12T10:00:00');
    const result = await log(
      caller,
      lead,
      'callback',
      { callbackAt: ist('2030-03-13T10:00:00').toISOString() },
      at,
    );
    expect(result.leadState).toBe('open');
    expect((await leadState(lead)).stage).toBe('new');
    expect((await tasksOf(lead)).map((t) => [t.kind, t.state])).toEqual([
      ['nurture', 'done'],
      ['callback', 'open'],
      ['nurture', 'cancelled'],
      ['nurture', 'cancelled'],
    ]);
  });

  it('an outcome that parks the lead needs its reason and sets the nurture calls', async () => {
    const lead = await leadOf(caller);
    await expect(log(caller, lead, 'nurture')).rejects.toMatchObject(
      reason('nurture_reason_missing'),
    );
    const result = await log(caller, lead, 'nurture', { nurtureReason: 'not_ready_yet' });
    expect(result).toMatchObject({ leadState: 'nurture', nextCall: { kind: 'nurture' } });
    expect((await tasksOf(lead)).filter((t) => t.kind === 'nurture')).toHaveLength(3);
  });
});

describe('calls.log: qualified and lost', () => {
  it('a qualified lead moves to Qualified, which asks for the handover', async () => {
    const lead = await leadOf(caller);
    const result = await log(caller, lead, 'qualified');
    expect(result.leadState).toBe('open');
    expect((await leadState(lead)).stage).toBe('qualified');
    const [moved] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs
         where aggregate_id = ${lead} and command = 'crm.opportunity.stage.move'`,
    );
    expect(moved?.after_json).toMatchObject({ handover: true });
  });

  it('a lost lead needs its reason and keeps it', async () => {
    const lead = await leadOf(caller);
    await expect(log(caller, lead, 'wrong_number')).rejects.toMatchObject(
      reason('lost_reason_missing'),
    );
    const result = await log(caller, lead, 'wrong_number', { lostReason: 'not_reachable' });
    expect(result.leadState).toBe('lost');
    expect((await leadState(lead)).stage).toBe('lost');
    const [lost] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs
         where aggregate_id = ${lead} and command = 'crm.opportunity.lose'`,
    );
    expect(lost?.after_json).toMatchObject({ lostReason: 'not_reachable' });
  });
});
