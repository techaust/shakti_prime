import { newId, type DeliveredEvent, type Principal } from '@shakti/contracts';
import { closeAuthDb } from '@shakti/db/auth';
import { closeOutboxDb } from '@shakti/db/outbox';
import {
  asMigrator,
  asOutboxPublisher,
  closeDb,
  createTestUser,
  principalFor,
  testPhone,
} from '@shakti/db/testing';
import {
  createAiProvider,
  createLead,
  executeCommand,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
  memoryFileStore,
  requestCopilotBrief,
} from '@shakti/domain';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// The Caller Co-pilot's event workers end to end (docs/03-roadmap-appendix/phase2.md §7.3): a brief
// asked for through its command is written from `agents.brief.requested` by the worker registered
// for it; an assigned lead's worker sends the notices and then writes the brief; a recorded call's
// worker leaves a call outside the coverage alone. The fake transport answers; nothing reaches a
// vendor. Company 4; the settings it writes are removed afterwards.
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers()),
  cookies: () => Promise.resolve({ get: () => undefined, set: () => undefined }),
}));

const { deliverEvent } = await import('../src/workers/events/deliver');
const { workerFor } = await import('../src/workers/events/registry');
const { handleBriefEvent, handleCallSummaryEvent } =
  await import('../src/workers/copilot/copilot-event');
const { callTranscribeOn, callTranscriber } =
  await import('../src/workers/copilot/call-transcriber');
const { systemWorkersPrincipal } = await import('../src/workers/events/system-principal');

const CO = 4;
const configs: string[] = [];
let caller: Principal;

afterAll(async () => {
  await asMigrator((m) => m`delete from agent_configs where id = any(${configs})`);
  await closeAuthDb();
  await closeOutboxDb();
  await closeDb();
});
vi.setConfig({ testTimeout: 60_000 });

async function setting(enabled: boolean): Promise<void> {
  const id = newId();
  configs.push(id);
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:copilot' and action_type is null and entity_id = ${CO}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, daily_spend_cap_paise, enabled, created_by)
             values (${id}, 'agent:copilot', null, ${CO}, 100000, ${enabled}, ${caller.id})`;
  });
}

beforeAll(async () => {
  const user = await createTestUser([{ entityId: CO, roleKey: 'tele_caller_lc' }]);
  caller = principalFor('tele_caller_lc', [CO], { id: user.id });
  await setting(true);
});

async function newLead(): Promise<string> {
  const lead = await executeCommand(caller, { entityIds: [CO] }, createLead, {
    entityId: CO,
    pipelineKey: 'farmer_pumps',
    contact: { name: 'Co-pilot worker customer', phone: testPhone() },
    account: { type: 'farm' },
  });
  return lead.id;
}

async function outboxEvent(aggregateId: string, type: string): Promise<DeliveredEvent> {
  const [event] = await asOutboxPublisher(
    (p) => p<{ id: string; sequence: string; payload: Record<string, unknown> }[]>`
      select id, sequence::text as sequence, payload_json as payload from outbox_events
       where aggregate_id = ${aggregateId} and type = ${type}`,
  );
  if (event === undefined) throw new Error(`no ${type} event`);
  return {
    id: event.id,
    sequence: event.sequence,
    type,
    entityId: CO,
    aggregateType: 'opportunity',
    aggregateId,
    payload: event.payload,
  } as unknown as DeliveredEvent;
}

const BRIEF = JSON.stringify({
  note: 'New pump enquiry from a farm. Ask the bore depth and the water level first.',
  followUp: null,
  template: null,
});

function deps() {
  const transport = fakeModelTransport([fakeReply(BRIEF)]);
  return {
    transport,
    deps: {
      provider: createAiProvider({
        claude: transport,
        voyage: undefined,
        keyValue: memoryKeyValue(),
        logger: memoryLogger(),
      }),
      keyValue: memoryKeyValue(),
      logger: memoryLogger(),
    },
  };
}

async function briefs(opportunityId: string): Promise<string[]> {
  const rows = await asMigrator(
    (m) => m<{ body: string }[]>`select body from copilot_notes
                                  where opportunity_id = ${opportunityId} and kind = 'brief'`,
  );
  return rows.map((r) => r.body);
}

describe('the Caller Co-pilot’s event workers', () => {
  it('are the workers of an assigned lead, a brief asked for and an ended dial', () => {
    for (const type of [
      'crm.opportunity.assigned',
      'agents.brief.requested',
      'calls.dial.completed',
    ]) {
      expect(workerFor(type)?.ordering).toBe('every');
    }
  });

  it('write the brief a person asked for, once for a repeated delivery', async () => {
    const lead = await newLead();
    await executeCommand(caller, { entityIds: [CO] }, requestCopilotBrief, {
      entityId: CO,
      opportunityId: lead,
    });
    const event = await outboxEvent(lead, 'agents.brief.requested');
    const ctx = {
      principal: systemWorkersPrincipal(CO),
      keyValue: memoryKeyValue(),
      requestId: newId(),
      now: new Date(),
      startedAt: performance.now(),
    };
    const { transport, deps: d } = deps();
    expect((await handleBriefEvent(event, ctx, d)).outcome).toBe('ran');
    await handleBriefEvent(event, ctx, d);
    expect(transport.requests).toHaveLength(1);
    expect(await briefs(lead)).toEqual([
      'New pump enquiry from a farm. Ask the bore depth and the water level first.',
    ]);
  });

  it('record the brief as unavailable through the registry when no model key is set', async () => {
    const lead = await newLead();
    await executeCommand(caller, { entityIds: [CO] }, requestCopilotBrief, {
      entityId: CO,
      opportunityId: lead,
    });
    const event = await outboxEvent(lead, 'agents.brief.requested');
    const result = await deliverEvent(event, { keyValue: memoryKeyValue(), requestId: newId() });
    expect(result.outcome).toBe('done');
    const runs = await asMigrator(
      (m) => m<{ outcome: string }[]>`
        select r.outcome from agent_runs r
         where r.agent = 'agent:copilot' and r.entity_id = ${CO} and r.purpose = 'copilot_brief'
           and r.created_at > now() - interval '1 minute'
         order by r.created_at desc limit 1`,
    );
    expect(runs).toEqual([{ outcome: 'unavailable' }]);
    expect(await briefs(lead)).toEqual([]);
  });

  it('send an assigned lead’s notices once, though its brief fails and the event comes again', async () => {
    const lead = await newLead();
    const assigner = await createTestUser([{ entityId: CO, roleKey: 'sales_team_lead' }]);
    const event = {
      id: newId(),
      sequence: '1',
      type: 'crm.opportunity.assigned',
      entityId: CO,
      aggregateType: 'opportunity',
      aggregateId: lead,
      payload: { ownerId: caller.id, teamId: null, lockHours: 48, assignedById: assigner.id, v: 1 },
    } as unknown as DeliveredEvent;
    const notices = () =>
      asMigrator(
        (m) => m<{ created_at: Date }[]>`
          select created_at from notifications
           where user_id = ${caller.id} and subject_id = ${lead} and type = 'lead_assigned'`,
      );
    const keyValue = memoryKeyValue();
    // The first delivery starts with its time used up: the notices go, then the brief stops.
    await expect(
      deliverEvent(event, {
        keyValue,
        requestId: newId(),
        startedAt: performance.now() - 60_000,
      }),
    ).rejects.toMatchObject({
      code: 'integration_unavailable',
      details: { reason: 'copilot_out_of_time' },
    });
    const first = await notices();
    expect(first).toHaveLength(1);
    const between = new Date();
    // The retry runs the brief (recorded as unavailable without a model key) and repeats no notice.
    const again = await deliverEvent(event, { keyValue, requestId: newId() });
    expect(again.outcome).toBe('done');
    const after = await notices();
    expect(after).toHaveLength(1);
    expect(new Date(after[0]?.created_at ?? 0).getTime()).toBeLessThan(between.getTime());
  });

  it('stop at the switch: a run recorded as switched off, nothing asked', async () => {
    await setting(false);
    const lead = await newLead();
    const { transport, deps: d } = deps();
    const event: DeliveredEvent = {
      id: newId(),
      sequence: '1',
      type: 'crm.opportunity.assigned',
      entityId: CO,
      aggregateType: 'opportunity',
      aggregateId: lead,
      payload: { ownerId: caller.id, teamId: null, lockHours: 48, assignedById: caller.id, v: 1 },
    } as unknown as DeliveredEvent;
    const ctx = {
      principal: systemWorkersPrincipal(CO),
      keyValue: memoryKeyValue(),
      requestId: newId(),
      now: new Date(),
      startedAt: performance.now(),
    };
    const result = await handleBriefEvent(event, ctx, d);
    expect(result.outcome).toBe('stopped');
    expect(result.runs.followUp?.outcome).toBe('switched_off');
    expect(transport.requests).toHaveLength(0);
    await setting(true);
  });

  it('leave a dial that is no call of the company alone', async () => {
    const ctx = {
      principal: systemWorkersPrincipal(CO),
      keyValue: memoryKeyValue(),
      requestId: newId(),
      now: new Date(),
      startedAt: performance.now(),
    };
    const event = {
      id: newId(),
      sequence: '1',
      type: 'calls.dial.completed',
      entityId: CO,
      aggregateType: 'provider_call',
      aggregateId: newId(),
      payload: {
        opportunityId: newId(),
        callerId: null,
        status: 'completed',
        durationSeconds: 60,
        v: 1,
      },
    } as unknown as DeliveredEvent;
    const { deps: d } = deps();
    expect(
      await handleCallSummaryEvent(event, ctx, {
        ...d,
        platform: ctx.principal,
        store: memoryFileStore(),
        transcriber: undefined,
        hosted: false,
      }),
    ).toEqual({ outcome: 'skipped', why: 'not_a_dial' });
  });
});

describe('the speech switch for call recordings', () => {
  it('is off unless CALL_TRANSCRIBE is on, and needs the speech key as well', () => {
    expect(callTranscribeOn({})).toBe(false);
    expect(callTranscribeOn({ CALL_TRANSCRIBE: 'yes' })).toBe(false);
    expect(callTranscribeOn({ CALL_TRANSCRIBE: 'on' })).toBe(true);
    expect(callTranscriber({ CALL_TRANSCRIBE: 'on' })).toBeUndefined();
    expect(callTranscriber({ SARVAM_API_KEY: 'stand-in-key-for-tests' })).toBeUndefined();
  });
});
