import {
  AGENT_PRINCIPAL_IDS,
  CONCIERGE_ACTION_TYPES,
  COPILOT_ACTION_TYPES,
  newId,
  type AgentProposalFiguresDto,
  type ConciergeReportDto,
  type Principal,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  whatsappChannel,
  whatsappCustomer,
  type WhatsAppCustomerFixture,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConciergeReport } from '../../src/queries/agents/concierge';
import { loadCopilotReport } from '../../src/queries/agents/copilot';
import { loadConciergeSample, loadCopilotSample } from '../../src/queries/agents/shadow-pack';

// The G2 shadow review pack on Postgres (docs/03-roadmap-appendix/phase2.md §8.1): the Concierge's
// and the Co-pilot's figures per action type, the hand-offs, the spend per lead and the review
// sample, on rows seeded straight into one period of the past that no other suite writes (a random
// month between 2001 and 2020), in company 3, with company 1's rows of the same period beside them
// that must never be counted.

const ENTITY = 3;
const OTHER = 1;
const REPLY = CONCIERGE_ACTION_TYPES.reply;
const QUALIFICATION = CONCIERGE_ACTION_TYPES.qualification;
const TASK = CONCIERGE_ACTION_TYPES.callback;
const TEMPLATE = COPILOT_ACTION_TYPES.template;

// A period of 30 IST days starting on a random day of 2001 to 2020.
const START = new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 7300) * 86_400_000);
const FROM = START.toISOString().slice(0, 10);
const TO = new Date(START.getTime() + 29 * 86_400_000).toISOString().slice(0, 10);
const T0 = Date.parse(`${FROM}T00:00:00+05:30`);
/** A time `minutes` into the period. */
const at = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();

let executive: Principal;
let gm: Principal;
let caller: Principal;
let person: Principal;
let channelId: string;
let otherChannelId: string;

type Agent = 'agent:concierge' | 'agent:copilot';

/** One agent run, and its action when `action` is given. */
async function seedRun(row: {
  entityId?: number;
  agent: Agent;
  actionType: string;
  at: string;
  costPaise?: number;
  filtered?: string;
  action?: {
    input: Record<string, unknown>;
    state: 'shadowed' | 'proposed' | 'approved' | 'rejected' | 'dismissed';
    edited?: boolean;
  };
}): Promise<string | null> {
  const entityId = row.entityId ?? ENTITY;
  const runId = newId();
  const action = row.action;
  const outcome =
    row.filtered !== undefined ? 'filtered' : action === undefined ? 'nothing_to_do' : 'shadowed';
  await asMigrator(async (m) => {
    await m`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type,
                                    cost_paise, outcome, filter_reason, request_id, created_at)
             values (${runId}, ${entityId}, ${row.agent}, ${AGENT_PRINCIPAL_IDS[row.agent]},
                     'shadow_pack_test', ${row.actionType}, ${row.costPaise ?? 0}, ${outcome},
                     ${row.filtered ?? null}, ${newId()}, ${row.at})`;
  });
  if (action === undefined) return null;
  const id = newId();
  const autonomy = action.state === 'shadowed' ? 'shadow' : 'needs_approval';
  const decided = ['approved', 'rejected'].includes(action.state);
  await asMigrator(
    (m) => m`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json,
                                        autonomy, state, edited, decided_by, decided_at,
                                        created_at, created_by)
             values (${id}, ${entityId}, ${runId}, ${row.agent}, ${row.actionType},
                     ${m.json(action.input as never)}, ${autonomy}, ${action.state},
                     ${action.edited ?? false}, ${decided ? person.id : null},
                     ${decided ? row.at : null}, ${row.at}, ${AGENT_PRINCIPAL_IDS[row.agent]})`,
  );
  return id;
}

interface Lead extends WhatsAppCustomerFixture {
  threadId: string;
}

/** A customer with an open lead and a chat with the company's number. */
async function lead(entityId = ENTITY): Promise<Lead> {
  const c = await whatsappCustomer(entityId);
  const threadId = newId();
  await asMigrator(
    (m) => m`insert into whatsapp_threads (id, entity_id, channel_id, wa_id, account_id,
                                           opportunity_id, created_by)
             values (${threadId}, ${entityId}, ${entityId === ENTITY ? channelId : otherChannelId},
                     ${c.waId}, ${c.accountId}, ${c.opportunityId}, ${c.owner.id})`,
  );
  return { ...c, threadId };
}

async function message(
  l: Lead,
  row: { at: string; inbound?: boolean; body?: string; template?: string },
): Promise<void> {
  const inbound = row.inbound ?? false;
  await asMigrator(
    (m) => m`insert into whatsapp_messages (id, entity_id, thread_id, direction, kind,
                                            provider_message_id, template_name, body_masked,
                                            status, sent_by, created_at)
             values (${newId()}, ${l.entityId}, ${l.threadId}, ${inbound ? 'inbound' : 'outbound'},
                     ${row.template === undefined ? 'text' : 'template'},
                     ${inbound ? `wamid.${newId()}` : null}, ${row.template ?? null},
                     ${row.body ?? null}, ${inbound ? null : 'queued'},
                     ${inbound ? null : person.id}, ${row.at})`,
  );
}

async function personTask(l: Lead, row: { at: string; due: string }): Promise<void> {
  await asMigrator(
    (m) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind,
                                title, due_at, created_at, created_by)
             values (${newId()}, ${l.entityId}, ${l.opportunityId}, ${l.accountId}, ${person.id},
                     'callback', 'Call back about the pump', ${row.due}, ${row.at}, ${person.id})`,
  );
}

async function facts(l: Lead, row: { pumpDepthFt?: number; requiredHp?: number }): Promise<void> {
  await asMigrator(
    (m) => m`insert into lead_qualifications (opportunity_id, entity_id, pump_depth_ft, required_hp,
                                              updated_by)
             values (${l.opportunityId}, ${l.entityId}, ${row.pumpDepthFt ?? null},
                     ${row.requiredHp ?? null}, ${person.id})`,
  );
}

/** A hand-off of a chat in the audit trail, as the commands write it. */
async function handOff(row: {
  entityId?: number;
  at: string;
  reason: string;
  byPerson?: boolean;
  before?: 'assistant' | 'people';
}): Promise<void> {
  const byPerson = row.byPerson ?? false;
  await asMigrator(
    (m) => m`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command,
                                     aggregate_type, aggregate_id, outcome, before_json, after_json,
                                     created_at)
             values (${newId()}, ${row.entityId ?? ENTITY}, ${person.id},
                     ${byPerson ? 'user' : 'system'},
                     ${byPerson ? 'messaging.thread.hand_off' : 'messaging.thread.record_hand_off'},
                     'whatsapp_thread', ${newId()}, 'ok',
                     ${m.json({ handledBy: row.before ?? 'assistant', handoffReason: null })},
                     ${m.json({ handledBy: 'people', handoffReason: row.reason })}, ${row.at})`,
  );
}

const ask = <T>(
  who: Principal,
  query: (ctx: RequestContext, input: unknown) => Promise<T>,
  input: Record<string, unknown> = {},
  entityIds = [ENTITY],
): Promise<T> =>
  asPrincipal({ ...who, entityIds }, (ctx) =>
    query(ctx, { entityId: ENTITY, from: FROM, to: TO, ...input }),
  );

const conciergeReport = (who: Principal, entityIds?: number[]) =>
  ask<ConciergeReportDto>(who, loadConciergeReport, { limit: 100 }, entityIds);

const figuresOf = (report: { proposals: AgentProposalFiguresDto[] }, actionType: string) =>
  report.proposals.find((p) => p.actionType === actionType);

let leadA: Lead;
let leadB: Lead;
let leadC: Lead;
const conciergeReplies: string[] = [];
const copilotTasks: string[] = [];

beforeAll(async () => {
  executive = await createTestPrincipal('executive', [ENTITY]);
  gm = await createTestPrincipal('general_manager', [ENTITY]);
  caller = await createTestPrincipal('tele_caller_cc', [ENTITY]);
  person = await createTestPrincipal('tele_caller_cc', [ENTITY, OTHER]);
  channelId = (await whatsappChannel(ENTITY)).channelId;
  otherChannelId = (await whatsappChannel(OTHER)).channelId;
  leadA = await lead();
  leadB = await lead();
  leadC = await lead();
  await asMigrator(
    (m) => m`update opportunities set state = 'lost' where id = ${leadB.opportunityId}`,
  );

  // The Concierge. Replies on chat A: two in Shadow (a person answered the first), one waiting,
  // one sent as written, one sent after an edit, one discarded.
  await message(leadA, { at: at(10), inbound: true, body: 'Need a pump for 120 ft' });
  const reply = (
    minute: number,
    state: 'shadowed' | 'proposed' | 'approved' | 'rejected',
    edited = false,
  ) =>
    seedRun({
      agent: 'agent:concierge',
      actionType: REPLY,
      at: at(minute),
      costPaise: 400,
      action: {
        input: {
          entityId: ENTITY,
          threadId: leadA.threadId,
          accountId: leadA.accountId,
          body: `Draft at ${String(minute)}`,
        },
        state,
        edited,
      },
    });
  for (const [minute, state, edited] of [
    [11, 'shadowed', false],
    [21, 'shadowed', false],
    [31, 'proposed', false],
    [41, 'approved', false],
    [51, 'approved', true],
    [61, 'rejected', false],
  ] as const) {
    const id = await reply(minute, state, edited);
    if (id !== null) conciergeReplies.push(id);
  }
  await message(leadA, { at: at(12), body: 'We will call you about the 120 ft pump' });

  // Facts: chat A's lead records the depth proposed (agrees), B's another power (disagrees), C's
  // none (open).
  await facts(leadA, { pumpDepthFt: 120 });
  await facts(leadB, { requiredHp: 7.5 });
  for (const [l, proposed] of [
    [leadA, { pumpDepthFt: 120, discomConsumerNo: 'AB-1234' }],
    [leadB, { requiredHp: 5 }],
    [leadC, { roofAreaSqFt: 400 }],
  ] as const) {
    await seedRun({
      agent: 'agent:concierge',
      actionType: QUALIFICATION,
      at: at(100),
      costPaise: 200,
      action: {
        input: { entityId: ENTITY, opportunityId: l.opportunityId, facts: proposed },
        state: 'shadowed',
      },
    });
  }
  // Callbacks: a person made a task on lead A after it (agrees); lead B was lost without one
  // (disagrees); lead C is open with none (open). A task made before the proposal does not count.
  await personTask(leadC, { at: at(150), due: at(3000) });
  for (const l of [leadA, leadB, leadC]) {
    await seedRun({
      agent: 'agent:concierge',
      actionType: TASK,
      at: at(200),
      costPaise: 100,
      action: {
        input: {
          entityId: ENTITY,
          opportunityId: l.opportunityId,
          kind: 'callback',
          dueAt: at(2000),
          assigneeId: l.owner.id,
        },
        state: 'shadowed',
      },
    });
  }
  await personTask(leadA, { at: at(300), due: at(2500) });

  // Refused runs and a run with nothing to do, which cost too.
  for (const [actionType, reason] of [
    [REPLY, 'reply_too_long'],
    [REPLY, 'reply_too_long'],
    [QUALIFICATION, 'fact_not_grounded'],
  ] as const) {
    await seedRun({
      agent: 'agent:concierge',
      actionType,
      at: at(400),
      costPaise: 300,
      filtered: reason,
    });
  }
  await seedRun({ agent: 'agent:concierge', actionType: TASK, at: at(410), costPaise: 0 });

  // Hand-offs: two by the assistant's rules, one by a person, one that found the chat with people
  // already (not counted).
  await handOff({ at: at(500), reason: 'keyword' });
  await handOff({ at: at(510), reason: 'keyword' });
  await handOff({ at: at(520), reason: 'complaint', byPerson: true });
  await handOff({ at: at(530), reason: 'question', before: 'people' });

  // The Co-pilot on lead A: a template a person then sent (agrees), facts in Shadow (agree), and
  // 120 follow-ups spread over the period for the sample.
  await seedRun({
    agent: 'agent:copilot',
    actionType: TEMPLATE,
    at: at(600),
    costPaise: 1000,
    action: {
      input: {
        entityId: ENTITY,
        opportunityId: leadA.opportunityId,
        occasion: 'nurture',
        templateName: 'nurture_day_7',
      },
      state: 'shadowed',
    },
  });
  await message(leadA, { at: at(700), template: 'nurture_day_7' });
  for (let i = 0; i < 120; i += 1) {
    const id = await seedRun({
      agent: 'agent:copilot',
      actionType: TASK,
      at: at(1000 + i * 300),
      costPaise: 10,
      action: {
        input: {
          entityId: ENTITY,
          opportunityId: leadC.opportunityId,
          kind: 'follow_up',
          dueAt: at(1000 + i * 300 + 1440),
          assigneeId: leadC.owner.id,
          title: `Follow up ${String(i)}`,
        },
        state: 'shadowed',
      },
    });
    if (id !== null) copilotTasks.push(id);
  }
  await asMigrator(
    (
      m,
    ) => m`insert into copilot_notes (id, entity_id, opportunity_id, kind, body, created_at, created_by)
             values (${newId()}, ${ENTITY}, ${leadB.opportunityId}, 'brief', 'Wants a 5 HP pump.',
                     ${at(800)}, ${AGENT_PRINCIPAL_IDS['agent:copilot']})`,
  );

  // Company 1's rows of the same period: never counted in company 3's report.
  const other = await lead(OTHER);
  for (const agent of ['agent:concierge', 'agent:copilot'] as const) {
    await seedRun({
      entityId: OTHER,
      agent,
      actionType: TASK,
      at: at(250),
      costPaise: 99_999,
      action: {
        input: {
          entityId: OTHER,
          opportunityId: other.opportunityId,
          kind: 'callback',
          dueAt: at(2000),
          assigneeId: other.owner.id,
        },
        state: 'shadowed',
      },
    });
    await seedRun({
      entityId: OTHER,
      agent,
      actionType: REPLY,
      at: at(260),
      costPaise: 5,
      filtered: 'reply_too_long',
    });
  }
  await handOff({ entityId: OTHER, at: at(540), reason: 'keyword' });
});

afterAll(async () => {
  await closeDb();
});

describe('the Concierge report’s figures (§8.1)', () => {
  it('counts each action type’s proposals, decisions and agreement with what people did', async () => {
    const report = await conciergeReport(executive);
    expect(figuresOf(report, REPLY)).toEqual({
      actionType: REPLY,
      proposals: 6,
      shadowed: 2,
      waiting: 1,
      approved: 2,
      rejected: 1,
      decided: 3,
      agreed: 1,
      edited: 1,
      disagreed: 1,
      // A reply in Shadow stays open: only a reader of the sample can judge it.
      open: 3,
      filtered: [{ reason: 'reply_too_long', runs: 2 }],
    });
    expect(figuresOf(report, QUALIFICATION)).toMatchObject({
      proposals: 3,
      shadowed: 3,
      decided: 0,
      agreed: 1,
      disagreed: 1,
      open: 1,
      filtered: [{ reason: 'fact_not_grounded', runs: 1 }],
    });
    expect(figuresOf(report, TASK)).toMatchObject({
      proposals: 3,
      agreed: 1,
      disagreed: 1,
      open: 1,
      filtered: [],
    });
    expect(report.filtered).toEqual([
      { reason: 'fact_not_grounded', runs: 1 },
      { reason: 'reply_too_long', runs: 2 },
    ]);
  });

  it('counts the hand-offs by reason and by whom, and only those that moved a chat', async () => {
    const report = await conciergeReport(executive);
    expect(report.handoffs).toEqual([
      { reason: 'keyword', by: 'assistant', count: 2 },
      { reason: 'complaint', by: 'person', count: 1 },
    ]);
    // A General Manager reads the company's audit trail too.
    expect((await conciergeReport(gm)).handoffs).toEqual(report.handoffs);
  });

  it('gives no hand-offs to a viewer who does not read the audit trail', async () => {
    const noAudit = {
      ...executive,
      permissions: executive.permissions.filter((p) => p.key !== 'audit.read'),
    };
    const report = await conciergeReport(noAudit);
    expect(report.handoffs).toBeNull();
    expect(figuresOf(report, REPLY)?.proposals).toBe(6);
  });

  it('gives the AI spend over the distinct leads it worked on', async () => {
    const report = await conciergeReport(executive);
    // 6 replies at ₹4, 3 facts at ₹2, 3 callbacks at ₹1, 3 refused at ₹3 and one run for nothing:
    // ₹42 over leads A, B and C.
    expect(report.spend).toEqual({ total: '42.00', runs: 16, leads: 3, perLead: '14.00' });
  });
});

describe('the Co-pilot report’s figures (§8.1)', () => {
  it('counts its proposals per action type and its spend per lead', async () => {
    const report = await ask(executive, loadCopilotReport, { limit: 10 });
    expect(figuresOf(report, TEMPLATE)).toMatchObject({ proposals: 1, agreed: 1, open: 0 });
    // The follow-ups on lead C: none had a person's task after it but the one before them.
    expect(figuresOf(report, TASK)).toMatchObject({ proposals: 120, agreed: 0, open: 120 });
    expect(figuresOf(report, QUALIFICATION)?.proposals).toBe(0);
    // ₹10 and 120 runs at ₹0.10 over lead A (the template), C (the follow-ups) and B (a brief).
    expect(report.spend).toEqual({ total: '22.00', runs: 121, leads: 3, perLead: '7.33' });
    // The other company's refused reply is not this company's.
    expect(report.filtered).toEqual([]);
  });
});

describe('the review sample (§8.1)', () => {
  it('lists every proposal of a short period, oldest first, beside what people did', async () => {
    const sample = await ask(executive, loadConciergeSample);
    expect(sample.proposals).toBe(12);
    expect(sample.items).toHaveLength(12);
    const times = sample.items.map((i) => i.createdAt);
    expect([...times].sort()).toEqual(times);
    const first = sample.items[0];
    expect(first).toMatchObject({
      actionId: conciergeReplies[0],
      actionType: REPLY,
      asked: 'Need a pump for 120 ft',
      draft: { kind: 'reply', text: 'Draft at 11' },
      did: { kind: 'message', body: 'We will call you about the 120 ft pump', fromDraft: false },
      state: 'shadowed',
      agreement: 'open',
    });
    const facts = sample.items.find(
      (i) => i.actionType === QUALIFICATION && i.opportunityId === leadA.opportunityId,
    );
    // The consumer number is never shown; the lead's own depth is.
    expect(facts).toMatchObject({
      draft: { kind: 'facts', facts: { pumpDepthFt: 120 } },
      did: { kind: 'facts', facts: { pumpDepthFt: 120 } },
      agreement: 'agree',
    });
    const task = sample.items.find(
      (i) => i.actionType === TASK && i.opportunityId === leadA.opportunityId,
    );
    expect(task).toMatchObject({
      draft: { kind: 'task', taskKind: 'callback', dueAt: at(2000) },
      did: { kind: 'task', taskKind: 'callback', at: at(300) },
      agreement: 'agree',
    });
    expect(sample.filtered).toEqual([
      { actionType: QUALIFICATION, reason: 'fact_not_grounded', runs: 1 },
      { actionType: REPLY, reason: 'reply_too_long', runs: 2 },
    ]);
  });

  it('takes 50 of a long period, spread evenly, and the same 50 every time', async () => {
    const sample = await ask(executive, loadCopilotSample);
    expect(sample.proposals).toBe(121);
    expect(sample.items).toHaveLength(50);
    expect(await ask(executive, loadCopilotSample)).toEqual(sample);
    // 121 proposals in 50 runs of equal length (21 of three, 29 of two), the first of each.
    const all = [sample.items[0]?.actionId ?? '', ...copilotTasks];
    const picked: string[] = [];
    let i = 0;
    for (let b = 0; b < 50; b += 1) {
      picked.push(all[i] ?? '');
      i += b < 121 % 50 ? 3 : 2;
    }
    expect(sample.items.map((x) => x.actionId)).toEqual(picked);
    expect(sample.items[0]).toMatchObject({
      actionType: TEMPLATE,
      draft: { kind: 'template', templateName: 'nurture_day_7', occasion: 'nurture' },
      did: { kind: 'template', at: at(700) },
      agreement: 'agree',
    });
    expect(sample.items.at(-1)?.actionId).toBe(copilotTasks[118]);
  });
});

describe('who reads the pack', () => {
  it('refuses a person without either agent control, and an agent', async () => {
    await expect(conciergeReport(caller)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ask(caller, loadConciergeSample)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ask(caller, loadCopilotSample)).rejects.toMatchObject({ code: 'forbidden' });
    // The seeded agent principal: a new agent row would be a principal every company reads.
    const agent = principalFor('agent:concierge', [ENTITY], {
      id: AGENT_PRINCIPAL_IDS['agent:concierge'],
    });
    await expect(ask(agent, loadConciergeSample)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a company outside the request', async () => {
    await expect(conciergeReport(executive, [OTHER])).rejects.toMatchObject({ code: 'forbidden' });
    await expect(ask(executive, loadCopilotSample, {}, [OTHER])).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('refuses a period longer than the report’s', async () => {
    await expect(
      ask(executive, loadConciergeSample, { from: '2020-01-01', to: '2020-06-30' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
