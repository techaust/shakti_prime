import { newId, type DeliveredEvent, type Principal } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestUser,
  principalFor,
} from '@shakti/db/testing';
import {
  createAiProvider,
  createLead,
  executeCommand,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Triage agent's event worker end to end (docs/03-roadmap-appendix/phase1.md §9, A1): a lead
// made through its command sends `crm.lead.created`; delivered to the worker registered for it,
// the agent records its proposals in Shadow through the fake transport: no inbox item, no change
// to the lead, and a repeated delivery records nothing new. Company 4; the setting it writes is
// removed afterwards.
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

const { deliverEvent } = await import('../src/workers/events/deliver');
const { workerFor } = await import('../src/workers/events/registry');
const { handleTriageEvent } = await import('../src/workers/triage/triage-event');

const CO = 4;
const cap = newId();
let caller: Principal;

afterAll(async () => {
  await asMigrator((m) => m`delete from agent_configs where id = ${cap}`);
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
vi.setConfig({ testTimeout: 60_000 });

beforeAll(async () => {
  const user = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_cc' }]);
  caller = principalFor('tele_caller_cc', [CO], { id: user.id });
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:triage' and action_type is null and entity_id = ${CO}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, daily_spend_cap_paise, created_by)
             values (${cap}, 'agent:triage', null, ${CO}, 100000, ${user.id})`;
  });
});

async function leadEvent(): Promise<DeliveredEvent> {
  const lead = await executeCommand(caller, { entityIds: [CO] }, createLead, {
    entityId: CO,
    pipelineKey: 'residential_rooftop',
    contact: {
      name: 'Worker triage customer',
      phone: `91${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'household' },
  });
  const [event] = await asOutboxPublisher(
    (p) => p<
      { id: string; sequence: string; payload: Record<string, unknown>; created_at: Date }[]
    >`select id, sequence::text as sequence, payload_json as payload, created_at from outbox_events
       where aggregate_id = ${lead.id} and type = 'crm.lead.created'`,
  );
  if (event === undefined) throw new Error('no crm.lead.created event');
  return {
    id: event.id,
    sequence: event.sequence,
    type: 'crm.lead.created',
    entityId: CO,
    aggregateType: 'opportunity',
    aggregateId: lead.id,
    payload: event.payload,
    createdAt: event.created_at.toISOString(),
  } as unknown as DeliveredEvent;
}

describe('the Triage agent’s event worker', () => {
  it('is the worker of crm.lead.created', () => {
    expect(workerFor('crm.lead.created')?.ordering).toBe('every');
  });

  it('records the proposals in Shadow, files nothing and changes nothing', async () => {
    const event = await leadEvent();
    const [before] = await asMigrator(
      (m) => m`select owner_id, score, pipeline_id, stage_id, updated_at from opportunities
                where id = ${event.aggregateId}`,
    );
    const transport = fakeModelTransport([
      fakeReply(
        JSON.stringify({
          pipeline: { key: 'residential_rooftop' },
          score: { change: -2 },
          assignee: { person: 'P1' },
        }),
      ),
    ]);
    const deps = {
      provider: createAiProvider({
        claude: transport,
        voyage: undefined,
        keyValue: memoryKeyValue(),
        logger: memoryLogger(),
      }),
      logger: memoryLogger(),
    };
    const keyValue = memoryKeyValue();
    const worker = {
      ordering: 'every' as const,
      handle: async (e: DeliveredEvent, ctx: Parameters<typeof handleTriageEvent>[1]) => {
        await handleTriageEvent(e, ctx, deps);
      },
    };
    expect((await deliverEvent(event, { keyValue, requestId: newId(), worker })).outcome).toBe(
      'done',
    );
    expect((await deliverEvent(event, { keyValue, requestId: newId(), worker })).outcome).toBe(
      'duplicate',
    );
    expect(transport.requests).toHaveLength(1);

    const actions = await asMigrator(
      (m) => m<{ action_type: string; state: string; inbox: number }[]>`
        select a.action_type, a.state,
               (select count(*)::int from inbox_items i where i.agent_action_id = a.id) as inbox
          from agent_actions a
         where a.agent = 'agent:triage' and a.input_json ->> 'opportunityId' = ${event.aggregateId}
         order by a.action_type`,
    );
    expect(actions).toEqual([
      { action_type: 'crm.opportunity.assign', state: 'shadowed', inbox: 0 },
      { action_type: 'triage.pipeline.choose', state: 'shadowed', inbox: 0 },
      { action_type: 'triage.score.adjust', state: 'shadowed', inbox: 0 },
    ]);
    const [after] = await asMigrator(
      (m) => m`select owner_id, score, pipeline_id, stage_id, updated_at from opportunities
                where id = ${event.aggregateId}`,
    );
    expect(after).toEqual(before);
  });
});
