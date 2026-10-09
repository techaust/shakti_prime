import {
  AGENT_PRINCIPAL_IDS,
  IdSchema,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { assignOpportunity } from '../../src/commands/crm/assign-opportunity';
import { setCallerProfile, setPresence } from '../../src/commands/crm/caller-profiles';
import { createLead } from '../../src/commands/crm/create-lead';
import { handOverLead } from '../../src/commands/crm/hand-over-lead';
import { nurtureOpportunity } from '../../src/commands/crm/nurture-opportunity';
import { reassignAllLeads } from '../../src/commands/crm/reassign-all';
import { createTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listCallerProfiles, loadOwnPresence } from '../../src/queries/crm/caller-profiles';
import { executeQuery } from '../../src/command/execute';

// The handover of qualified leads (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2) on real Postgres:
// profiles, the worker's command with its callbacks, lock, customer relationship and routing to
// the Sales Team Lead, and the move of a leaving caller's leads. The suites never clean the CRM
// tables, so this one works in company 3 with a team of its own and clears the company's
// profiles first, so a converter left by an earlier run never takes a lead.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const CO = 3;
const RUN = newId().slice(-6);
let numbers = 0;
function phone(): string {
  numbers += 1;
  return `93${RUN.replace(/[^0-9]/g, '7')
    .padEnd(6, '7')
    .slice(0, 6)}${String(numbers).padStart(2, '0')}`;
}

let team: string;
let otherTeam: string;
let caller: Principal;
let converterX: Principal;
let converterY: Principal;
let teamLead: Principal;
let otherTeamLead: Principal;
let gm: Principal;
let gmOther: Principal;
const workers = principalFor('system:workers', [CO], { id: SYSTEM_WORKERS_PRINCIPAL_ID });

beforeAll(async () => {
  await asMigrator((m) => m`delete from caller_profiles where entity_id = ${CO}`);
  team = await createTestTeam(CO, 'handover team');
  otherTeam = await createTestTeam(CO, 'handover other team');
  const a = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_cc', teamId: team }], {
    name: 'Asha Caller',
  });
  const x = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }], {
    name: 'Xavier Converter',
  });
  const y = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }], {
    name: 'Yash Converter',
  });
  const t = await createTestUser([{ entityId: CO, roleKey: 'sales_team_lead', teamId: team }], {
    name: 'Tara Lead',
  });
  const t2 = await createTestUser(
    [{ entityId: CO, roleKey: 'sales_team_lead', teamId: otherTeam }],
    { name: 'Uma Other Lead' },
  );
  const g = await createTestUser([{ entityId: CO, roleKey: 'general_manager' }]);
  const g2 = await createTestUser([{ entityId: 2, roleKey: 'general_manager' }]);
  caller = principalFor('tele_caller_cc', [CO], { id: a.id, teamId: team });
  converterX = principalFor('tele_caller_lc', [CO], { id: x.id, teamId: team });
  converterY = principalFor('tele_caller_lc', [CO], { id: y.id, teamId: team });
  teamLead = principalFor('sales_team_lead', [CO], { id: t.id, teamId: team });
  otherTeamLead = principalFor('sales_team_lead', [CO], { id: t2.id, teamId: otherTeam });
  gm = principalFor('general_manager', [CO], { id: g.id });
  gmOther = principalFor('general_manager', [2], { id: g2.id });
});

function run<T = unknown>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

/** The one lead a list holds. */
function only(list: Lead[]): Lead {
  const first = list[0];
  if (!first) throw new Error('no lead');
  return first;
}

function refusal(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (e: unknown) => e,
  );
}
const code = (e: unknown): string | undefined => (e as { code?: string } | undefined)?.code;
const reason = (e: unknown): string | undefined =>
  (e as { details?: { reason?: string } } | undefined)?.details?.reason;

interface Lead {
  id: string;
  account: { id: string };
}

function newLead(owner: Principal = caller, pipelineKey = 'farmer_pumps'): Promise<Lead> {
  return run<Lead>(owner, createLead, {
    entityId: CO,
    pipelineKey,
    // Each customer has a name and a village of its own, so the duplicate search finds no pair.
    contact: { name: `Handover customer ${RUN} ${String(numbers + 1)}`, phone: phone() },
    account: { type: 'farm' },
    site: {
      type: 'borewell',
      village: `Handover village ${RUN} ${String(numbers)}`,
      pin: '422001',
    },
  });
}

function profile(
  userId: string,
  settings: Partial<{
    isConverter: boolean;
    maxOpen: number | null;
    languages: string[];
    segments: string[];
  }> = {},
) {
  return run(gm, setCallerProfile, {
    entityId: CO,
    userId,
    isConverter: true,
    maxOpen: null,
    languages: [],
    segments: [],
    ...settings,
  });
}

/** The database's own clock, so the event times in these tests never differ from the rows' by a skew. */
async function dbNow(): Promise<string> {
  const [row] = await asMigrator((m) => m<{ now: Date }[]>`select clock_timestamp() as now`);
  if (!row) throw new Error('no clock');
  return row.now.toISOString();
}

/** The worker's handover for an event: at the lead's stage now, and at the time given or now. */
async function handOver(
  lead: Lead,
  eventId: string = newId(),
  cursor: string | null = null,
  event: { eventAt?: string; stageId?: string } = {},
) {
  return run<{ outcome: string; ownerId: string | null; cursor: string | null }>(
    workers,
    handOverLead,
    {
      entityId: CO,
      opportunityId: lead.id,
      eventId,
      stageId: event.stageId ?? (await leadState(lead)).stage_id,
      eventAt: event.eventAt ?? (await dbNow()),
      cursor,
    },
  );
}

interface LeadState {
  stage_id: string;
  owner_id: string | null;
  team_id: string | null;
  locked_until: Date | null;
  state: string;
}
async function leadState(lead: Lead): Promise<LeadState> {
  const [row] = await asMigrator(
    (m) =>
      m<
        LeadState[]
      >`select stage_id, owner_id, team_id, locked_until, state from opportunities where id = ${lead.id}`,
  );
  if (!row) throw new Error('lead missing');
  return row;
}
function openTasks(lead: Lead) {
  return asMigrator(
    (m) =>
      m<{ assignee_id: string; kind: string; due_at: Date }[]>`
        select assignee_id, kind, due_at from tasks
         where opportunity_id = ${lead.id} and state = 'open' order by due_at`,
  );
}
async function relationshipOwner(lead: Lead): Promise<string | null> {
  const [row] = await asMigrator(
    (m) =>
      m<{ owner_id: string | null }[]>`
        select owner_id from account_entities where account_id = ${lead.account.id} and entity_id = ${CO}`,
  );
  return row?.owner_id ?? null;
}

describe('caller profiles', () => {
  it('lets a manager set a profile and a person set only their own presence', async () => {
    const saved = await run<{ isConverter: boolean; presence: string; languages: string[] }>(
      teamLead,
      setCallerProfile,
      {
        entityId: CO,
        userId: converterX.id,
        isConverter: true,
        maxOpen: 5,
        languages: ['en', 'hinglish'],
        segments: ['farmer_pumps'],
      },
    );
    expect(saved).toMatchObject({
      isConverter: true,
      presence: 'away',
      maxOpen: 5,
      languages: ['en', 'hinglish'],
    });
    const present = await run<{ presence: string; isConverter: boolean }>(converterX, setPresence, {
      entityId: CO,
      presence: 'present',
    });
    expect(present).toMatchObject({ presence: 'present', isConverter: true });
    expect(
      await asPrincipal(converterX, (context) => loadOwnPresence(context, { entityId: CO })),
    ).toBe('present');
    // A manager's save never changes the person's presence.
    const again = await profile(converterX.id, { maxOpen: 7 });
    expect(again).toMatchObject({ presence: 'present', maxOpen: 7 });
  });

  it('refuses a tele-caller who sets a profile, a person outside the manager team and a wrong company', async () => {
    const input = {
      entityId: CO,
      userId: converterX.id,
      isConverter: true,
      maxOpen: null,
      languages: [],
      segments: [],
    };
    expect(code(await refusal(run(caller, setCallerProfile, input)))).toBe('forbidden');
    expect(code(await refusal(run(gmOther, setCallerProfile, input)))).toBe('forbidden');
    const outside = await refusal(run(otherTeamLead, setCallerProfile, input));
    expect(code(outside)).toBe('not_found');
    expect(reason(outside)).toBe('profile_person_missing');
  });

  it('keeps a person from changing their own converter switch in the table', async () => {
    await run(converterY, setPresence, { entityId: CO, presence: 'away' });
    const error = await refusal(
      asPrincipal(converterY, (context) =>
        context.tx.execute(
          // A person's own row may change presence only; the trigger refuses the rest.
          sql`update caller_profiles set is_converter = true where user_id = ${converterY.id}::uuid`,
        ),
      ),
    );
    expect(error).toBeDefined();
  });

  it('lists the people a manager sets up under their scope', async () => {
    const mine = await executeQuery(
      teamLead,
      { entityIds: [CO], requestId: newId() },
      (context) => listCallerProfiles(context, { entityId: CO }),
      { name: 'caller_profiles.list' },
    );
    const names = mine.map((p) => p.name);
    expect(names).toContain('Xavier Converter');
    expect(names).not.toContain('Uma Other Lead');
    const all = await executeQuery(
      gm,
      { entityIds: [CO], requestId: newId() },
      (context) => listCallerProfiles(context, { entityId: CO }),
      { name: 'caller_profiles.list' },
    );
    expect(all.map((p) => p.name)).toEqual(
      expect.arrayContaining(['Uma Other Lead', 'Xavier Converter']),
    );
    const refused = await refusal(
      executeQuery(
        caller,
        { entityIds: [CO], requestId: newId() },
        (context) => listCallerProfiles(context, { entityId: CO }),
        { name: 'caller_profiles.list' },
      ),
    );
    expect(refused).toBeDefined();
  });
});

describe('the handover', () => {
  it('gives a qualified lead to a present converter with the lock, callbacks and customer moved', async () => {
    await profile(converterX.id);
    await profile(converterY.id);
    await run(converterX, setPresence, { entityId: CO, presence: 'present' });
    await run(converterY, setPresence, { entityId: CO, presence: 'away' });
    const lead = await newLead();
    const due = new Date(Date.now() + 3 * 3_600_000).toISOString();
    await run(caller, createTask, {
      entityId: CO,
      opportunityId: lead.id,
      kind: 'callback',
      dueAt: due,
    });
    expect(await relationshipOwner(lead)).toBe(caller.id);

    const before = Date.now();
    const result = await handOver(lead, newId(), null);
    expect(result).toMatchObject({ outcome: 'converter', ownerId: converterX.id });

    const state = await leadState(lead);
    expect(state.owner_id).toBe(converterX.id);
    expect(state.team_id).toBe(team);
    // 48 hours, the workshop default, as the pipeline sets none of its own.
    const hours = ((state.locked_until?.getTime() ?? 0) - before) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
    const tasks = await openTasks(lead);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ assignee_id: converterX.id, kind: 'callback' });
    expect(tasks[0]?.due_at.toISOString()).toBe(due);
    // The owner's decision of 09-10-2026: the round-robin handover moves the relationship.
    expect(await relationshipOwner(lead)).toBe(converterX.id);

    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload: { ownerId: string; assignedById: string } }[]>`
        select type, payload_json as payload from outbox_events
         where aggregate_id = ${lead.id} and type = 'crm.opportunity.assigned'`,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      ownerId: converterX.id,
      assignedById: SYSTEM_WORKERS_PRINCIPAL_ID,
    });
    const timeline = await asMigrator(
      (m) =>
        m<
          { type: string }[]
        >`select type from activities where opportunity_id = ${lead.id} order by created_at`,
    );
    expect(timeline.map((r) => r.type)).toEqual(
      expect.arrayContaining(['assigned', 'task_created', 'task_cancelled']),
    );
    // The contracts read only version 7 ids, so the rows a definer writes carry them.
    const written = await asMigrator(
      (m) => m<{ id: string }[]>`
        select id::text from activities where opportunity_id = ${lead.id}
        union all select id::text from tasks where opportunity_id = ${lead.id}`,
    );
    expect(written.length).toBeGreaterThan(3);
    for (const row of written) expect(IdSchema.safeParse(row.id).success).toBe(true);
    const audited = await asMigrator(
      (m) =>
        m<{ aggregate_type: string }[]>`
          select aggregate_type from audit_logs
           where actor_principal_id = ${SYSTEM_WORKERS_PRINCIPAL_ID}
             and command = 'crm.opportunity.hand_over'
             and aggregate_id in (${lead.id}, ${lead.account.id})`,
    );
    expect(audited.length).toBeGreaterThan(0);
  });

  it('holds the lock against another caller and still lets the team lead reassign', async () => {
    const lead = await newLead();
    await handOver(lead);
    const owner = (await leadState(lead)).owner_id;
    expect(owner).toBe(converterX.id);
    // A caller with no assign right cannot take it; the Sales Team Lead can, in the lock.
    expect(
      code(
        await refusal(
          run(caller, assignOpportunity, {
            entityId: CO,
            opportunityId: lead.id,
            ownerId: converterY.id,
          }),
        ),
      ),
    ).toBe('forbidden');
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      ownerId: converterY.id,
    });
    expect((await leadState(lead)).owner_id).toBe(converterY.id);
  });

  it('is made once for an event: a repeat changes nothing', async () => {
    const lead = await newLead();
    await run(caller, createTask, {
      entityId: CO,
      opportunityId: lead.id,
      kind: 'callback',
      dueAt: new Date(Date.now() + 5 * 3_600_000).toISOString(),
    });
    const eventId = newId();
    const first = await handOver(lead, eventId);
    expect(first.outcome).toBe('converter');
    const again = await handOver(lead, eventId);
    expect(again.outcome).toBe('already');
    expect(await openTasks(lead)).toHaveLength(1);
    const assigned = await asOutboxPublisher(
      (p) => p<{ id: string }[]>`
        select id from outbox_events where aggregate_id = ${lead.id} and type = 'crm.opportunity.assigned'`,
    );
    expect(assigned).toHaveLength(1);
  });

  it('answers not_open for a lead that is no longer open and changes nothing', async () => {
    const lead = await newLead();
    await run(caller, nurtureOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      reasonCode: 'not_ready_yet',
    });
    const result = await handOver(lead);
    expect(result.outcome).toBe('not_open');
    expect((await leadState(lead)).owner_id).toBe(caller.id);
  });

  it('weighs the fewest open leads and goes round on ties, with the cursor', async () => {
    await run(converterY, setPresence, { entityId: CO, presence: 'present' });
    // Both present and tied only if they hold the same number of open leads; give X two more.
    const [a, b] = [await newLead(), await newLead()];
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: a.id,
      ownerId: converterX.id,
    });
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: b.id,
      ownerId: converterX.id,
    });
    const lead = await newLead();
    const result = await handOver(lead);
    expect(result).toMatchObject({ outcome: 'converter', ownerId: converterY.id });
    expect(result.cursor).toBe(converterY.id);
  });

  it('respects the cap, the language and the business line, and falls to the team lead otherwise', async () => {
    // X takes English leads of the farmer pumps line only, Y takes none (a cap of one it has used).
    await profile(converterX.id, { languages: ['en'], segments: ['farmer_pumps'] });
    await profile(converterY.id, { maxOpen: 1 });
    await run(converterX, setPresence, { entityId: CO, presence: 'present' });
    await run(converterY, setPresence, { entityId: CO, presence: 'present' });
    const held = await newLead();
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: held.id,
      ownerId: converterY.id,
    });
    const lead = await newLead();
    // The customer speaks Hinglish: X does not take it; Y is at its cap.
    const result = await handOver(lead);
    expect(result.outcome).toBe('team_lead');
    expect(result.ownerId).toBe(teamLead.id);
    const state = await leadState(lead);
    expect(state.owner_id).toBe(teamLead.id);
    expect(state.locked_until).not.toBeNull();
    const [item] = await asMigrator(
      (m) =>
        m<
          {
            kind: string;
            assignee_id: string;
            subject_type: string;
            segment: string;
            state: string;
          }[]
        >`
          select kind, assignee_id, subject_type, segment, state from inbox_items
           where subject_id = ${lead.id} and entity_id = ${CO}`,
    );
    expect(item).toMatchObject({
      kind: 'routed_work',
      assignee_id: teamLead.id,
      subject_type: 'opportunity',
      segment: 'farmer_pumps',
      state: 'open',
    });
    // The new owner is told through the assigned event.
    const events = await asOutboxPublisher(
      (p) => p<{ payload: { ownerId: string } }[]>`
        select payload_json as payload from outbox_events
         where aggregate_id = ${lead.id} and type = 'crm.opportunity.assigned'`,
    );
    expect(events[0]?.payload.ownerId).toBe(teamLead.id);
  });

  it('sends the lead to the team lead of the lead team, not of another team', async () => {
    await asMigrator(
      (m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`,
    );
    const lead = await newLead();
    const result = await handOver(lead);
    expect(result).toMatchObject({ outcome: 'team_lead', ownerId: teamLead.id });
  });

  it('refuses anyone but the worker and a company outside the request', async () => {
    const lead = await newLead();
    const input = {
      entityId: CO,
      opportunityId: lead.id,
      eventId: newId(),
      stageId: (await leadState(lead)).stage_id,
      eventAt: new Date().toISOString(),
      cursor: null,
    };
    expect(code(await refusal(run(gm, handOverLead, input)))).toBe('forbidden');
    expect(code(await refusal(run(teamLead, handOverLead, input)))).toBe('forbidden');
    expect(
      code(
        await refusal(
          run(
            principalFor('system:workers', [2], { id: SYSTEM_WORKERS_PRINCIPAL_ID }),
            handOverLead,
            input,
          ),
        ),
      ),
    ).toBe('forbidden');
  });

  it('never moves the customer relationship when an agent hands the lead over', async () => {
    const lead = await newLead();
    const agent = principalFor('agent:triage', [CO], { id: AGENT_PRINCIPAL_IDS['agent:triage'] });
    await run(agent, assignOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      ownerId: converterX.id,
    });
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
    expect(await relationshipOwner(lead)).toBe(caller.id);
  });
});

describe('the handover leaves a lead that has moved on', () => {
  /** Only these converters are present: the rest are away. */
  async function onlyPresent(...people: Principal[]) {
    await asMigrator(
      (m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`,
    );
    for (const person of people) {
      await profile(person.id);
      await run(person, setPresence, { entityId: CO, presence: 'present' });
    }
  }

  it('does not hand a lead again that was qualified again during its lock', async () => {
    await onlyPresent(converterX);
    const lead = await newLead();
    expect((await handOver(lead)).outcome).toBe('converter');
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
    // The lead is qualified again (a new event) while X holds it and Y is the one present.
    await onlyPresent(converterY);
    const again = await handOver(lead, newId());
    expect(again.outcome).toBe('kept');
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
    // Once the lock has run out, a new event hands it on.
    await asMigrator(
      (m) =>
        m`update opportunities set locked_until = now() - interval '1 hour' where id = ${lead.id}`,
    );
    expect(await handOver(lead, newId())).toMatchObject({
      outcome: 'converter',
      ownerId: converterY.id,
    });
  });

  it('does not overwrite a manual assignment made before a delayed delivery', async () => {
    await onlyPresent(converterX);
    const lead = await newLead();
    const eventAt = await dbNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      ownerId: teamLead.id,
    });
    // The assignment's lock runs, but the owner is no converter: only the assignment after the
    // event stops this handover.
    const late = await handOver(lead, newId(), null, { eventAt });
    expect(late.outcome).toBe('kept');
    expect((await leadState(lead)).owner_id).toBe(teamLead.id);
    // For an event made after the assignment the lead is handed over, lock or not.
    expect((await handOver(lead, newId())).outcome).toBe('converter');
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
  });

  it('hands a qualified lead over though a person locked it to a caller who is no converter', async () => {
    await onlyPresent(converterX);
    const lead = await newLead();
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      ownerId: caller.id,
    });
    expect((await leadState(lead)).locked_until?.getTime() ?? 0).toBeGreaterThan(Date.now());
    const result = await handOver(lead);
    expect(result).toMatchObject({ outcome: 'converter', ownerId: converterX.id });
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
  });

  it('leaves a lead that is no longer at the stage of the event', async () => {
    await onlyPresent(converterX);
    const lead = await newLead();
    const stageId = (await leadState(lead)).stage_id;
    await asMigrator(
      (m) => m`update opportunities set stage_id = (
                 select s.id from pipeline_stages s join opportunities o on o.pipeline_id = s.pipeline_id
                  where o.id = ${lead.id} and s.id <> ${stageId} order by s.position limit 1)
               where id = ${lead.id}`,
    );
    const result = await handOver(lead, newId(), null, { stageId });
    expect(result.outcome).toBe('kept');
    expect((await leadState(lead)).owner_id).toBe(caller.id);
  });

  it('lets a converter who qualifies for their own lead keep it', async () => {
    await onlyPresent(converterX, converterY);
    const lead = await newLead();
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: lead.id,
      ownerId: converterX.id,
    });
    // Y may hold fewer leads, yet X keeps the lead they qualify for.
    const result = await handOver(lead);
    expect(result).toMatchObject({ outcome: 'kept', ownerId: converterX.id });
    expect((await leadState(lead)).owner_id).toBe(converterX.id);
    expect(await relationshipOwner(lead)).toBe(converterX.id);
  });

  it('locks a handover for the pipeline hours, which the workshop default only stands in for', async () => {
    // The pipeline's column is not null (its own default is 48), so the lock follows the pipeline
    // and no hours are written into the command or the definer.
    await onlyPresent(converterX);
    const lead = await newLead();
    const before = Date.now();
    await handOver(lead);
    const [pipeline] = await asMigrator(
      (m) => m<{ lock_hours: number }[]>`
        select p.lock_hours from pipelines p join opportunities o on o.pipeline_id = p.id
         where o.id = ${lead.id}`,
    );
    const hours = (((await leadState(lead)).locked_until?.getTime() ?? 0) - before) / 3_600_000;
    expect(hours).toBeGreaterThan((pipeline?.lock_hours ?? 0) - 0.1);
    expect(hours).toBeLessThan((pipeline?.lock_hours ?? 0) + 0.1);
  });

  it('queues two handovers of one company, so a converter with one place left takes one', async () => {
    const solo = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }], {
      name: 'Zara Solo Converter',
    });
    const soloPrincipal = principalFor('tele_caller_lc', [CO], { id: solo.id, teamId: team });
    await onlyPresent();
    await profile(solo.id, { maxOpen: 1 });
    await run(soloPrincipal, setPresence, { entityId: CO, presence: 'present' });
    const [first, second] = [await newLead(), await newLead()];
    const outcomes = await Promise.all([handOver(first), handOver(second)]);
    expect(outcomes.map((o) => o.outcome).sort()).toEqual(['converter', 'team_lead']);
    expect(outcomes.find((o) => o.outcome === 'converter')?.ownerId).toBe(solo.id);
  });
});

describe('crm.lead.reassign_all', () => {
  async function leaverWith(open: number, nurtured: number) {
    const mine: Lead[] = [];
    const leaver = await createTestUser(
      [{ entityId: CO, roleKey: 'tele_caller_cc', teamId: team }],
      {
        name: 'Leaving Caller',
      },
    );
    const p = principalFor('tele_caller_cc', [CO], { id: leaver.id, teamId: team });
    for (let i = 0; i < open + nurtured; i += 1) {
      const lead = await newLead(p);
      if (i < nurtured) {
        await run(p, nurtureOpportunity, {
          entityId: CO,
          opportunityId: lead.id,
          reasonCode: 'not_ready_yet',
        });
      } else {
        await run(p, createTask, {
          entityId: CO,
          opportunityId: lead.id,
          kind: 'callback',
          dueAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
        });
      }
      mine.push(lead);
    }
    return { leaver, p, mine };
  }

  it('moves every open and nurtured lead of a leaving caller to a named person at once', async () => {
    const { leaver, mine } = await leaverWith(2, 1);
    const result = await run<{ moved: number }>(teamLead, reassignAllLeads, {
      entityId: CO,
      fromUserId: leaver.id,
      toUserId: converterX.id,
    });
    expect(result.moved).toBe(3);
    for (const lead of mine) {
      const state = await leadState(lead);
      expect(state.owner_id).toBe(converterX.id);
      for (const task of await openTasks(lead)) expect(task.assignee_id).toBe(converterX.id);
      expect(await relationshipOwner(lead)).toBe(converterX.id);
    }
    // A nurtured lead stays in nurture, with its nurture calls now the new owner's.
    const nurtured = mine[0];
    if (!nurtured) throw new Error('no lead');
    expect((await leadState(nurtured)).state).toBe('nurture');
    const calls = await openTasks(nurtured);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.kind === 'nurture' && c.assignee_id === converterX.id)).toBe(true);
    // Nothing is left with the leaver.
    expect(
      await asMigrator(
        (m) =>
          m`select 1 from opportunities where owner_id = ${leaver.id} and state in ('open', 'nurture')`,
      ),
    ).toHaveLength(0);
    const again = await run<{ moved: number }>(teamLead, reassignAllLeads, {
      entityId: CO,
      fromUserId: leaver.id,
      toUserId: converterX.id,
    });
    expect(again.moved).toBe(0);
  });

  it('gives the leads out in turn to the converters who qualify', async () => {
    // Two fresh converters with no leads, the only ones present.
    await asMigrator(
      (m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`,
    );
    const [p, q] = await Promise.all(
      ['Priya Converter', 'Qadir Converter'].map((name) =>
        createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }], { name }),
      ),
    );
    if (!p || !q) throw new Error('no converters');
    for (const person of [p, q]) {
      await profile(person.id);
      await run(
        principalFor('tele_caller_lc', [CO], { id: person.id, teamId: team }),
        setPresence,
        {
          entityId: CO,
          presence: 'present',
        },
      );
    }
    const { leaver, mine } = await leaverWith(4, 0);
    const result = await run<{ moved: number }>(gm, reassignAllLeads, {
      entityId: CO,
      fromUserId: leaver.id,
      toUserId: null,
    });
    expect(result.moved).toBe(4);
    const owners = await Promise.all(mine.map(async (l) => (await leadState(l)).owner_id));
    expect(owners.filter((o) => o === p.id)).toHaveLength(2);
    expect(owners.filter((o) => o === q.id)).toHaveLength(2);
  });

  it('refuses a round with no converter present, a person who is not active here, and no caller right', async () => {
    await asMigrator(
      (m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`,
    );
    const { leaver, mine } = await leaverWith(1, 0);
    const none = await refusal(
      run(gm, reassignAllLeads, { entityId: CO, fromUserId: leaver.id, toUserId: null }),
    );
    expect(reason(none)).toBe('reassign_no_converter');
    expect((await leadState(only(mine))).owner_id).toBe(leaver.id);

    const suspended = await createTestUser(
      [{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }],
      {
        status: 'suspended',
      },
    );
    const inactive = await refusal(
      run(gm, reassignAllLeads, { entityId: CO, fromUserId: leaver.id, toUserId: suspended.id }),
    );
    expect(reason(inactive)).toBe('assignee_not_eligible');
    const elsewhere = await createTestUser([{ entityId: 2, roleKey: 'tele_caller_lc' }]);
    const wrongCompany = await refusal(
      run(gm, reassignAllLeads, { entityId: CO, fromUserId: leaver.id, toUserId: elsewhere.id }),
    );
    expect(reason(wrongCompany)).toBe('assignee_not_eligible');
    const same = await refusal(
      run(gm, reassignAllLeads, { entityId: CO, fromUserId: leaver.id, toUserId: leaver.id }),
    );
    expect(reason(same)).toBe('reassign_same_person');

    const input = { entityId: CO, fromUserId: leaver.id, toUserId: converterX.id };
    expect(code(await refusal(run(caller, reassignAllLeads, input)))).toBe('forbidden');
    expect(code(await refusal(run(converterX, reassignAllLeads, input)))).toBe('forbidden');
    expect(code(await refusal(run(gmOther, reassignAllLeads, input)))).toBe('forbidden');
    expect(
      code(await refusal(run(principalFor('agent:triage', [CO]), reassignAllLeads, input))),
    ).toBe('forbidden');
  });

  it('moves only the leads of the team a Sales Team Lead covers', async () => {
    const { leaver, mine } = await leaverWith(1, 0);
    // A named target outside the team is refused plainly, not with a permission error.
    const outside = await refusal(
      run(otherTeamLead, reassignAllLeads, {
        entityId: CO,
        fromUserId: leaver.id,
        toUserId: converterX.id,
      }),
    );
    expect(code(outside)).toBe('validation_failed');
    expect(reason(outside)).toBe('assignee_not_eligible');
    // A target of their own team is allowed, but the leaver's leads are in another team: none move.
    const neighbour = await createTestUser(
      [{ entityId: CO, roleKey: 'tele_caller_lc', teamId: otherTeam }],
      { name: 'Olga Other Team' },
    );
    const result = await run<{ moved: number; remaining: number; teamOnly: boolean }>(
      otherTeamLead,
      reassignAllLeads,
      { entityId: CO, fromUserId: leaver.id, toUserId: neighbour.id },
    );
    expect(result).toMatchObject({ moved: 0, remaining: 0, teamOnly: true });
    expect((await leadState(only(mine))).owner_id).toBe(leaver.id);
  });

  it('gives a Sales Team Lead only the converters of their team, in turn', async () => {
    await asMigrator(
      (m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`,
    );
    // An in-team converter, and one of another team with no leads at all, both present.
    const inTeam = await createTestUser(
      [{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }],
      { name: 'Ira In Team' },
    );
    const outTeam = await createTestUser(
      [{ entityId: CO, roleKey: 'tele_caller_lc', teamId: otherTeam }],
      { name: 'Oren Out Of Team' },
    );
    for (const [person, teamId] of [
      [inTeam, team],
      [outTeam, otherTeam],
    ] as const) {
      await profile(person.id);
      await run(principalFor('tele_caller_lc', [CO], { id: person.id, teamId }), setPresence, {
        entityId: CO,
        presence: 'present',
      });
    }
    const held = await newLead();
    await run(teamLead, assignOpportunity, {
      entityId: CO,
      opportunityId: held.id,
      ownerId: inTeam.id,
    });
    const { leaver, mine } = await leaverWith(2, 0);
    const result = await run<{ moved: number; remaining: number; teamOnly: boolean }>(
      teamLead,
      reassignAllLeads,
      { entityId: CO, fromUserId: leaver.id, toUserId: null },
    );
    expect(result).toMatchObject({ moved: 2, remaining: 0, teamOnly: true });
    for (const lead of mine) expect((await leadState(lead)).owner_id).toBe(inTeam.id);
    const named = await refusal(
      run(teamLead, reassignAllLeads, {
        entityId: CO,
        fromUserId: leaver.id,
        toUserId: outTeam.id,
      }),
    );
    expect(reason(named)).toBe('assignee_not_eligible');
    const company = await run<{ teamOnly: boolean }>(gm, reassignAllLeads, {
      entityId: CO,
      fromUserId: leaver.id,
      toUserId: null,
    });
    expect(company.teamOnly).toBe(false);
  });
});
