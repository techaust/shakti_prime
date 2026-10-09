import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type DeliveredEvent,
  type Principal,
} from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestTeam,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import {
  createLead,
  createTask,
  executeCommand,
  memoryKeyValue,
  moveOpportunityStage,
  setCallerProfile,
  setPresence,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The handover worker end to end (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): a lead moved to
// Qualified is given to a present converter within ten seconds of the event through the outbox
// nudge, with the lock set, its callback moved and its customer moved; with no converter present
// it reaches the Sales Team Lead, and a repeated delivery changes nothing. The stand-ins are the
// request headers and the signed-in caller; the commands, the publisher and the database are
// real. Company 2 has no other converter, since only these suites make profiles.
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

const { nudgeOutbox } = await import('../src/workers/outbox');
const { deliverEvent } = await import('../src/workers/events/deliver');
const { handleHandoverEvent, handoverCursorKey } =
  await import('../src/workers/handover/handover-event');

afterAll(async () => {
  await asMigrator((m) => m`update caller_profiles set presence = 'away' where entity_id = ${CO}`);
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
vi.setConfig({ testTimeout: 60_000 });

const CO = 2;
const RUN = newId().slice(-6);
let numbers = 0;
function phone(): string {
  numbers += 1;
  return `92${RUN.replace(/[^0-9]/g, '5')
    .padEnd(6, '5')
    .slice(0, 6)}${String(numbers).padStart(2, '0')}`;
}

let team: string;
let caller: Principal;
let converter: Principal;
let teamLead: Principal;

beforeAll(async () => {
  await asMigrator((m) => m`delete from caller_profiles where entity_id = ${CO}`);
  team = await createTestTeam(CO, 'handover worker team');
  const a = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_cc', teamId: team }]);
  const c = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc', teamId: team }], {
    name: 'Worker Converter',
  });
  const t = await createTestUser([{ entityId: CO, roleKey: 'sales_team_lead', teamId: team }], {
    name: 'Worker Lead',
  });
  caller = principalFor('tele_caller_cc', [CO], { id: a.id, teamId: team });
  converter = principalFor('tele_caller_lc', [CO], { id: c.id, teamId: team });
  teamLead = principalFor('sales_team_lead', [CO], { id: t.id, teamId: team });
});

const run = <T>(principal: Principal, command: never, input: unknown, nudge = false) =>
  executeCommand(
    principal,
    { entityIds: [CO], requestId: newId() },
    command,
    input,
    nudge ? { onCommitted: nudgeOutbox } : {},
  ) as Promise<T>;

interface Lead {
  id: string;
  account: { id: string };
}
const newLead = () =>
  run<Lead>(caller, createLead as never, {
    entityId: CO,
    pipelineKey: 'farmer_pumps',
    contact: { name: `Worker customer ${RUN} ${String(numbers + 1)}`, phone: phone() },
    account: { type: 'farm' },
    site: { type: 'borewell', village: `Worker village ${RUN} ${String(numbers)}`, pin: '422001' },
  });

async function stageId(lead: Lead, key: string): Promise<string> {
  const [row] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select s.id from pipeline_stages s join opportunities o on o.pipeline_id = s.pipeline_id
       where o.id = ${lead.id} and s.key = ${key}`,
  );
  if (!row) throw new Error(`no stage ${key}`);
  return row.id;
}

async function state(lead: Lead) {
  const [row] = await asMigrator(
    (m) => m<{ owner_id: string | null; locked_until: Date | null }[]>`
      select owner_id, locked_until from opportunities where id = ${lead.id}`,
  );
  const [rel] = await asMigrator(
    (m) => m<{ owner_id: string | null }[]>`
      select owner_id from account_entities where account_id = ${lead.account.id} and entity_id = ${CO}`,
  );
  return {
    owner: row?.owner_id ?? null,
    lockedUntil: row?.locked_until ?? null,
    relationship: rel?.owner_id ?? null,
  };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() - started > ms) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('the handover worker', () => {
  it('gives a lead that reached Qualified to a present converter within ten seconds of the event', async () => {
    await run(teamLead, setCallerProfile as never, {
      entityId: CO,
      userId: converter.id,
      isConverter: true,
      maxOpen: null,
      languages: [],
      segments: [],
    });
    await run(converter, setPresence as never, { entityId: CO, presence: 'present' });
    const lead = await newLead();
    const due = new Date(Date.now() + 6 * 3_600_000).toISOString();
    await run(caller, createTask as never, {
      entityId: CO,
      opportunityId: lead.id,
      kind: 'callback',
      dueAt: due,
    });

    const started = Date.now();
    await run(
      caller,
      moveOpportunityStage as never,
      { entityId: CO, opportunityId: lead.id, stageId: await stageId(lead, 'qualified') },
      true,
    );
    const after = await until(
      () => state(lead),
      (s) => s.owner === converter.id,
      10_000,
    );
    const took = Date.now() - started;
    expect(after.owner).toBe(converter.id);
    expect(took).toBeLessThan(10_000);
    // Locked for the 48-hour workshop default, with the customer and the callback moved.
    const hours = ((after.lockedUntil?.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47);
    expect(after.relationship).toBe(converter.id);
    const tasks = await asMigrator(
      (m) => m<{ assignee_id: string; due_at: Date }[]>`
        select assignee_id, due_at from tasks
         where opportunity_id = ${lead.id} and state = 'open' and kind = 'callback'`,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.assignee_id).toBe(converter.id);
    expect(tasks[0]?.due_at.toISOString()).toBe(due);
    const events = await asOutboxPublisher(
      (p) => p<{ payload: { ownerId: string } }[]>`
        select payload_json as payload from outbox_events
         where aggregate_id = ${lead.id} and type = 'crm.opportunity.assigned'`,
    );
    expect(events.map((e) => e.payload.ownerId)).toEqual([converter.id]);
  });

  it('reaches the Sales Team Lead when no converter is present', async () => {
    await run(converter, setPresence as never, { entityId: CO, presence: 'away' });
    const lead = await newLead();
    await run(
      caller,
      moveOpportunityStage as never,
      { entityId: CO, opportunityId: lead.id, stageId: await stageId(lead, 'qualified') },
      true,
    );
    const after = await until(
      () => state(lead),
      (s) => s.owner !== caller.id,
      10_000,
    );
    expect(after.owner).toBe(teamLead.id);
    const items = await asMigrator(
      (m) => m<{ kind: string; assignee_id: string }[]>`
        select kind, assignee_id from inbox_items
         where subject_id = ${lead.id} and entity_id = ${CO}`,
    );
    expect(items).toEqual([{ kind: 'routed_work', assignee_id: teamLead.id }]);
  });

  it('leaves alone a move that is not to Qualified, and a lead moved twice is handed over once per event', async () => {
    await run(converter, setPresence as never, { entityId: CO, presence: 'present' });
    const lead = await newLead();
    const keyValue = memoryKeyValue();
    const event = (handover: boolean): DeliveredEvent =>
      ({
        id: newId(),
        type: 'crm.opportunity.stage_moved',
        entityId: CO,
        aggregateType: 'opportunity',
        aggregateId: lead.id,
        payload: { fromStageId: newId(), toStageId: newId(), toStageKey: 'x', handover },
        sequence: '1',
        createdAt: new Date().toISOString(),
      }) as unknown as DeliveredEvent;

    const plain = event(false);
    await deliverEvent(plain, { keyValue, requestId: newId() });
    expect((await state(lead)).owner).toBe(caller.id);

    const qualified = event(true);
    expect((await deliverEvent(qualified, { keyValue, requestId: newId() })).outcome).toBe('done');
    expect((await state(lead)).owner).toBe(converter.id);
    // The round-robin keeps who it chose last, per company.
    expect(await keyValue.get(handoverCursorKey(CO))).toBe(converter.id);
    // The same event again: the id is claimed, nothing runs a second time.
    expect((await deliverEvent(qualified, { keyValue, requestId: newId() })).outcome).toBe(
      'duplicate',
    );
    // A second delivery of it by another process (no shared store) still changes nothing.
    const direct = await handleHandoverEvent(qualified, {
      principal: principalFor('system:workers', [CO], { id: SYSTEM_WORKERS_PRINCIPAL_ID }),
      keyValue: memoryKeyValue(),
      requestId: newId(),
      now: new Date(),
    });
    expect(direct?.outcome).toBe('already');
    const assigned = await asOutboxPublisher(
      (p) => p<{ id: string }[]>`
        select id from outbox_events where aggregate_id = ${lead.id} and type = 'crm.opportunity.assigned'`,
    );
    expect(assigned).toHaveLength(1);
  });
});
