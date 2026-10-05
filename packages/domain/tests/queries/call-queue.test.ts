import { newId, type CallQueueItemDto, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { logCall } from '../../src/commands/calls/log-call';
import { createLead } from '../../src/commands/crm/create-lead';
import { nurtureOpportunity } from '../../src/commands/crm/nurture-opportunity';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  dialNumber,
  listCallQueue,
  listTeamQueues,
  loadCallLead,
} from '../../src/queries/calls/call-queue';

// The caller's queue, the workspace's lead, the number to dial and the team lead's view
// (docs/design/phase1.md §7.2, PRD TEL-01), read as of fixed moments. The suite works in company 4
// with people of its own, so the queues hold only its leads, and an outcome list of its own.

const ENTITY = 4;
const ist = (local: string): Date => new Date(`${local}+05:30`);
/** The moment the queue is read: a Tuesday afternoon, inside calling hours. */
const AS_OF = ist('2030-03-05T15:00:00');
const SLA_PIPELINE = 'farmer_pumps';

const OUTCOMES = { callback: newId(), retry: newId(), qualified: newId() } as const;

let caller: Principal;
let colleague: Principal;
let teamLead: Principal;
let slaBefore: number | null = null;
const leads: Record<string, string> = {};

function run(principal: Principal, command: AnyCommand, input: unknown, now: Date): Promise<unknown> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox, now }, input),
  );
}

const phone = (): string => `94${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function leadOf(owner: Principal, pipelineKey: string, name: string): Promise<string> {
  const lead = (await run(
    owner,
    createLead,
    {
      entityId: ENTITY,
      pipelineKey,
      contact: { name, phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Sambhar', pin: '303604' },
    },
    new Date(),
  )) as { id: string };
  return lead.id;
}

const log = (opportunityId: string, outcome: keyof typeof OUTCOMES, now: Date, extra = {}) =>
  run(
    caller,
    logCall,
    { entityId: ENTITY, opportunityId, dispositionId: OUTCOMES[outcome], ...extra },
    now,
  );

beforeAll(async () => {
  await asMigrator(async (m) => {
    await m`update call_dispositions set archived_at = now()
             where entity_id = ${ENTITY} and archived_at is null
               and segment in ('farmer_pumps', 'residential_rooftop')`;
    let key = 1;
    for (const segment of ['farmer_pumps', 'residential_rooftop']) {
      for (const [nextAction, id] of Object.entries(OUTCOMES)) {
        const rowId = segment === 'farmer_pumps' ? id : newId();
        await m`insert into call_dispositions (id, entity_id, segment, key, code, label, next_action, position)
                 values (${rowId}, ${ENTITY}, ${segment}, ${key}, ${`queue_${nextAction}`},
                         ${`Queue ${nextAction}`}, ${nextAction}, ${key})`;
        key = (key % 3) + 1;
      }
    }
    const [pipeline] = await m<{ sla: number | null }[]>`
      select first_contact_sla_minutes as sla from pipelines where key = ${SLA_PIPELINE}`;
    slaBefore = pipeline?.sla ?? null;
    await m`update pipelines set first_contact_sla_minutes = 60 where key = ${SLA_PIPELINE}`;
  });
  const teamId = await createTestTeam(ENTITY, 'queue team');
  const make = async (roleKey: 'tele_caller_cc' | 'sales_team_lead', name: string) => {
    const user = await createTestUser([{ entityId: ENTITY, roleKey, teamId }], { name });
    return createTestPrincipal(roleKey, [ENTITY], { id: user.id, teamId });
  };
  caller = await make('tele_caller_cc', 'Queue caller');
  colleague = await make('tele_caller_cc', 'Queue colleague');
  teamLead = await make('sales_team_lead', 'Queue team lead');

  // Never called, on a pipeline with a first-contact limit of an hour: late.
  leads.late = await leadOf(caller, 'farmer_pumps', 'Late lead');
  // Never called, no limit: by score, then age.
  leads.low = await leadOf(caller, 'residential_rooftop', 'Low score lead');
  leads.high = await leadOf(caller, 'residential_rooftop', 'High score lead');
  await asMigrator((m) => m`update opportunities set score = 80 where id = ${leads.high ?? ''}`);
  // A callback due at noon on the day the queue is read.
  leads.due = await leadOf(caller, 'farmer_pumps', 'Due lead');
  await log(leads.due, 'callback', ist('2030-03-05T10:00:00'), {
    callbackAt: ist('2030-03-05T12:00:00').toISOString(),
  });
  // A retry set for tomorrow: out of the queue until then.
  leads.later = await leadOf(caller, 'farmer_pumps', 'Later lead');
  await log(leads.later, 'retry', ist('2030-03-05T11:00:00'));
  // Nurtured eight days ago: its day-7 call fell due yesterday, before the noon callback.
  leads.nurtured = await leadOf(caller, 'residential_rooftop', 'Nurtured lead');
  await run(
    caller,
    nurtureOpportunity,
    { entityId: ENTITY, opportunityId: leads.nurtured, reasonCode: 'waiting_for_funds' },
    ist('2030-02-25T10:00:00'),
  );
  // Nurtured today: nothing due, out of the queue.
  leads.parked = await leadOf(caller, 'residential_rooftop', 'Parked lead');
  await run(
    caller,
    nurtureOpportunity,
    { entityId: ENTITY, opportunityId: leads.parked, reasonCode: 'waiting_for_funds' },
    ist('2030-03-05T10:00:00'),
  );
  // Qualified: past the first stages, out of the queue.
  leads.qualified = await leadOf(caller, 'farmer_pumps', 'Qualified lead');
  await log(leads.qualified, 'qualified', ist('2030-03-05T10:30:00'));
  // A colleague's lead never shows in the caller's queue.
  leads.colleague = await leadOf(colleague, 'farmer_pumps', 'Colleague lead');
  // The late lead's customer withdrew consent to calls.
  await asMigrator(
    (m) => m`insert into consents (id, contact_id, channel, purpose, source, text_version,
                                   given_at, withdrawn_at, created_by)
             select ${newId()}, ac.contact_id, 'call', 'promotional', 'verbal', 'v1',
                    now() - interval '1 day', now(), ${caller.id}
               from opportunities o join account_contacts ac on ac.account_id = o.account_id
              where o.id = ${leads.late ?? ''}`,
  );
});

afterAll(async () => {
  await asMigrator(async (m) => {
    await m`update pipelines set first_contact_sla_minutes = ${slaBefore} where key = ${SLA_PIPELINE}`;
    await m`update call_dispositions set archived_at = now()
             where entity_id = ${ENTITY} and archived_at is null
               and segment in ('farmer_pumps', 'residential_rooftop')`;
  });
  await closeDb();
});

const queue = (who: Principal, input: object = {}, now = AS_OF) =>
  asPrincipal(who, (context) => listCallQueue(context, input, now));

const names = (items: readonly CallQueueItemDto[]) => items.map((i) => i.customerName);

describe('listCallQueue', () => {
  it('orders due calls, then late first calls, then by score and age, and leaves out the rest', async () => {
    const page = await queue(caller);
    expect(names(page.items)).toEqual([
      'Nurtured lead',
      'Due lead',
      'Late lead',
      'High score lead',
      'Low score lead',
    ]);
    expect(page.items.map((i) => i.reason)).toEqual([
      'nurture_due',
      'call_due',
      'first_call_late',
      'not_called',
      'not_called',
    ]);
    expect(page.items[1]).toMatchObject({
      dueAt: ist('2030-03-05T12:00:00').toISOString(),
      state: 'open',
      lastCallAt: ist('2030-03-05T10:00:00').toISOString(),
      village: 'Sambhar',
    });
    expect(page.items[0]?.dueAt).toBe(ist('2030-03-04T09:00:00').toISOString());
    expect(page.items.find((i) => i.customerName === 'Late lead')?.consentWithdrawn).toBe(true);
    expect(page.items.find((i) => i.customerName === 'Due lead')?.consentWithdrawn).toBe(false);
    expect(page.items.every((i) => /^\d{4}$/.test(i.phoneLast4 ?? ''))).toBe(true);
    expect(page.asOf).toBe(AS_OF.toISOString());
  });

  it('brings a retry back on its day', async () => {
    const tomorrow = await queue(caller, {}, ist('2030-03-06T09:30:00'));
    const later = tomorrow.items.find((i) => i.customerName === 'Later lead');
    expect(later).toMatchObject({ reason: 'call_due', attempts: 1 });
  });

  it('pages by keyset as of one moment, the pages adding up to the whole queue', async () => {
    const whole = await queue(caller);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 10; i += 1) {
      const page = await queue(caller, { limit: 2, ...(cursor ? { cursor } : {}) });
      expect(page.asOf).toBe(AS_OF.toISOString());
      seen.push(...names(page.items));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(names(whole.items));
  });

  it('a team lead reads a caller’s queue; a caller may not read a colleague’s', async () => {
    const read = await queue(teamLead, { callerId: caller.id });
    expect(names(read.items)).toEqual(names((await queue(caller)).items));
    await expect(queue(colleague, { callerId: caller.id })).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('is refused to a role that does not log calls', async () => {
    const accounts = await createTestPrincipal('accounts', [ENTITY]);
    await expect(queue(accounts)).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('listTeamQueues', () => {
  it('lists the team’s callers with their waiting, due and late leads and today’s calls', async () => {
    const team = await asPrincipal(teamLead, (context) =>
      listTeamQueues(context, {}, ist('2030-03-05T15:00:00')),
    );
    const mine = team.find((t) => t.callerId === caller.id);
    expect(mine).toMatchObject({ waiting: 5, due: 2, late: 1, callsToday: 3 });
    expect(team.find((t) => t.callerId === colleague.id)).toMatchObject({ waiting: 1, late: 1 });
  });

  it('is refused to a caller with own scope', async () => {
    await expect(
      asPrincipal(caller, (context) => listTeamQueues(context, {}, AS_OF)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('loadCallLead', () => {
  it('shows the lead, its outcomes, its next call and its recent calls', async () => {
    const lead = await asPrincipal(caller, (context) =>
      loadCallLead(context, { entityId: ENTITY, opportunityId: leads.later }),
    );
    expect(lead).toMatchObject({
      customerName: 'Later lead',
      contactName: 'Later lead',
      language: 'hinglish',
      segment: 'farmer_pumps',
      stageName: 'New',
      village: 'Sambhar',
      canLog: true,
      consentWithdrawn: false,
      attempts: 1,
      maxAttempts: 3,
      nextCall: { kind: 'callback', dueAt: ist('2030-03-06T09:00:00').toISOString() },
    });
    expect(lead.dispositions.map((d) => d.id)).toEqual(Object.values(OUTCOMES));
    expect(lead.recentActivity.find((a) => a.type === 'call_logged')?.payload).toMatchObject({
      outcomeName: 'Queue retry',
      attemptNo: 1,
    });
  });

  it('a team lead reads it and may log; a colleague cannot see it', async () => {
    const read = await asPrincipal(teamLead, (context) =>
      loadCallLead(context, { entityId: ENTITY, opportunityId: leads.later }),
    );
    expect(read.canLog).toBe(true);
    await expect(
      asPrincipal(colleague, (context) =>
        loadCallLead(context, { entityId: ENTITY, opportunityId: leads.later }),
      ),
    ).rejects.toMatchObject({ details: { reason: 'lead_missing' } });
  });
});

describe('dialNumber', () => {
  const dial = (who: Principal, opportunityId: string | undefined, now: Date) =>
    asPrincipal(who, (context) =>
      dialNumber(context, { entityId: ENTITY, opportunityId }, now),
    );

  it('shows the full number inside calling hours', async () => {
    const shown = await dial(caller, leads.due, AS_OF);
    expect(shown.e164).toMatch(/^\+9194\d{8}$/);
  });

  it('is refused outside calling hours and for a customer who withdrew consent', async () => {
    await expect(dial(caller, leads.due, ist('2030-03-05T21:30:00'))).rejects.toMatchObject({
      details: { reason: 'outside_calling_hours' },
    });
    await expect(dial(caller, leads.late, AS_OF)).rejects.toMatchObject({
      details: { reason: 'call_consent_withdrawn' },
    });
  });
});
