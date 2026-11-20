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
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { handOffWhatsAppThread } from '../../src/commands/messaging/threads';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { loadConciergeReport } from '../../src/queries/agents/concierge';
import { loadCopilotReport } from '../../src/queries/agents/copilot';
import { loadConciergeSample, loadCopilotSample } from '../../src/queries/agents/shadow-pack';

// The G2 shadow review pack on Postgres (docs/03-roadmap-appendix/phase2.md §8.1): the Concierge's
// and the Co-pilot's figures per action type, the hand-offs, the spend per lead and the review
// sample, on rows seeded straight into one period of the past that no other suite writes (a random
// month between 2011 and 2017), in company 3, with company 1's rows of the same period beside them
// that must never be counted.

const ENTITY = 3;
const OTHER = 1;
const REPLY = CONCIERGE_ACTION_TYPES.reply;
const QUALIFICATION = CONCIERGE_ACTION_TYPES.qualification;
const TASK = CONCIERGE_ACTION_TYPES.callback;
const TEMPLATE = COPILOT_ACTION_TYPES.template;

// A period of 30 IST days starting on a random day of 2011 to mid-2017. Its hand-offs go to the
// audit trail's default partition, so the period stays clear of the months the retention suite
// makes partitions for (1971 to 2010, and seven years and ten months ago) and of query-audit's.
const START = new Date(Date.UTC(2011, 0, 1) + Math.floor(Math.random() * 2300) * 86_400_000);
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
    state: 'shadowed' | 'proposed' | 'approved' | 'rejected' | 'dismissed' | 'executed';
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
  const autonomy = {
    shadowed: 'shadow',
    dismissed: 'suggest',
    executed: 'automatic',
    proposed: 'needs_approval',
    approved: 'needs_approval',
    rejected: 'needs_approval',
  }[action.state];
  const decided = ['approved', 'rejected', 'dismissed'].includes(action.state);
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

/**
 * A task on the lead and its audit row, as `crm.task.create` writes it: alone in its request when a
 * person set it (`via` left out), or inside another command's request (`calls.call.log` filing a
 * retry or callback, a nurture or a reassignment), whose own audit row shares the request.
 */
async function task(
  l: Lead,
  row: { at: string; due: string; kind?: string; via?: string },
): Promise<void> {
  const id = newId();
  const request = `shadow-pack-${newId()}`;
  await asMigrator(async (m) => {
    await m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind,
                               title, due_at, created_at, created_by)
            values (${id}, ${l.entityId}, ${l.opportunityId}, ${l.accountId}, ${person.id},
                    ${row.kind ?? 'callback'}, 'Call back about the pump', ${row.due}, ${row.at},
                    ${person.id})`;
    await m`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command,
                                    aggregate_type, aggregate_id, outcome, request_id, created_at)
            values (${newId()}, ${l.entityId}, ${person.id}, 'user', 'crm.task.create', 'task',
                    ${id}, 'ok', ${request}, ${row.at})`;
    if (row.via !== undefined) {
      await m`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command,
                                      aggregate_type, aggregate_id, outcome, request_id, created_at)
              values (${newId()}, ${l.entityId}, ${person.id}, 'user', ${row.via}, 'opportunity',
                      ${l.opportunityId}, 'ok', ${request}, ${row.at})`;
    }
  });
}

/** The lead's facts as they stand now. */
async function facts(
  l: Lead,
  row: { pumpDepthFt?: number; requiredHp?: number; roofAreaSqFt?: number },
): Promise<void> {
  await asMigrator(
    (m) => m`insert into lead_qualifications (opportunity_id, entity_id, pump_depth_ft, required_hp,
                                              roof_area_sq_ft, updated_by)
             values (${l.opportunityId}, ${l.entityId}, ${row.pumpDepthFt ?? null},
                     ${row.requiredHp ?? null}, ${row.roofAreaSqFt ?? null}, ${person.id})`,
  );
}

/** A person's change of the lead's facts in the audit trail, as `crm.lead.qualification.set` writes it. */
async function factChange(
  l: Lead,
  row: { at: string; before: Record<string, number | null>; after: Record<string, number | null> },
): Promise<void> {
  await asMigrator(
    (m) => m`insert into audit_logs (id, entity_id, actor_principal_id, actor_kind, command,
                                     aggregate_type, aggregate_id, outcome, before_json, after_json,
                                     request_id, created_at)
             values (${newId()}, ${l.entityId}, ${person.id}, 'user', 'crm.lead.qualification.set',
                     'opportunity', ${l.opportunityId}, 'ok', ${m.json(row.before)},
                     ${m.json(row.after)}, ${`shadow-pack-${newId()}`}, ${row.at})`,
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
let copilotFacts = '';
let copilotTemplate = '';

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
  // one sent as written, one sent after an edit, one discarded, one the agent sent itself.
  await message(leadA, { at: at(10), inbound: true, body: 'Need a pump for 120 ft' });
  const reply = (
    minute: number,
    state: 'shadowed' | 'proposed' | 'approved' | 'rejected' | 'executed',
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
    // Carried out by the agent itself (Automatic, Phase 6): never read as people agreeing.
    [71, 'executed', false],
  ] as const) {
    const id = await reply(minute, state, edited);
    if (id !== null) conciergeReplies.push(id);
  }
  await message(leadA, { at: at(12), body: 'We will call you about the 120 ft pump' });

  // Facts. Lead A held the depth proposed before the proposal: a repeat, open. Lead B: a person
  // recorded the power proposed after it (agrees), then corrected it, which changes nothing of the
  // verdict. Lead C: a person recorded another roof area after it (disagrees).
  await facts(leadA, { pumpDepthFt: 120 });
  await facts(leadB, { requiredHp: 7.5 });
  await facts(leadC, { roofAreaSqFt: 450 });
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
  await factChange(leadB, { at: at(150), before: { requiredHp: null }, after: { requiredHp: 5 } });
  await factChange(leadB, { at: at(900), before: { requiredHp: 5 }, after: { requiredHp: 7.5 } });
  await factChange(leadC, {
    at: at(160),
    before: { roofAreaSqFt: null },
    after: { roofAreaSqFt: 450 },
  });
  // Callbacks, proposed at minute 200 due at minute 2000. Lead A: a person set a callback of their
  // own after it, due an hour from the time proposed (agrees), and the same proposal under Suggest
  // was dismissed (compared as Shadow is: agrees). Lead B was lost without one (disagrees). Lead C:
  // only a callback made before the proposal, one the call log filed as a retry, one of another
  // kind and one set too late (open).
  await task(leadC, { at: at(150), due: at(2000) });
  const callback = (l: Lead, minute: number, state: 'shadowed' | 'dismissed') =>
    seedRun({
      agent: 'agent:concierge',
      actionType: TASK,
      at: at(minute),
      costPaise: 100,
      action: {
        input: {
          entityId: ENTITY,
          opportunityId: l.opportunityId,
          kind: 'callback',
          dueAt: at(2000),
          assigneeId: l.owner.id,
        },
        state,
      },
    });
  for (const l of [leadA, leadB, leadC]) await callback(l, 200, 'shadowed');
  await callback(leadA, 210, 'dismissed');
  await task(leadA, { at: at(300), due: at(2060) });
  await task(leadC, { at: at(250), due: at(2000), via: 'calls.call.log' });
  await task(leadC, { at: at(260), due: at(2000), kind: 'follow_up' });
  await task(leadC, { at: at(200 + 49 * 60), due: at(2000) });

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

  // The Co-pilot: facts on lead B a person then recorded (agree), at no cost; a template on lead A
  // a person then sent (agrees); and 120 follow-ups spread over the period for the review set.
  copilotFacts =
    (await seedRun({
      agent: 'agent:copilot',
      actionType: QUALIFICATION,
      at: at(120),
      action: {
        input: { entityId: ENTITY, opportunityId: leadB.opportunityId, facts: { requiredHp: 5 } },
        state: 'shadowed',
      },
    })) ?? '';
  copilotTemplate =
    (await seedRun({
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
    })) ?? '';
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
    expect(report.compared).toBe(true);
    expect(figuresOf(report, REPLY)).toEqual({
      actionType: REPLY,
      proposals: 7,
      shadowed: 2,
      waiting: 1,
      approved: 2,
      rejected: 1,
      executed: 1,
      decided: 3,
      agreed: 1,
      edited: 1,
      disagreed: 1,
      // A reply in Shadow stays open (only a reader of the review set can judge it), and so does
      // one the agent sent itself.
      open: 4,
      filtered: [{ reason: 'reply_too_long', runs: 2 }],
    });
    expect(report.filtered).toEqual([
      { reason: 'fact_not_grounded', runs: 1 },
      { reason: 'reply_too_long', runs: 2 },
    ]);
  });

  it('holds facts to the first change a person recorded after them, and a repeat stays open', async () => {
    const report = await conciergeReport(executive);
    // A: the depth it held already (open); B: the power recorded after, then corrected (agrees
    // still); C: another roof area recorded after (disagrees).
    expect(figuresOf(report, QUALIFICATION)).toMatchObject({
      proposals: 3,
      shadowed: 3,
      decided: 0,
      agreed: 1,
      disagreed: 1,
      open: 1,
      filtered: [{ reason: 'fact_not_grounded', runs: 1 }],
    });
  });

  it('counts only a person’s own task of the kind, soon after and due near the time proposed', async () => {
    const report = await conciergeReport(executive);
    // A: a person's own callback an hour from the time, for the proposal in Shadow and the one
    // dismissed under Suggest (both agree); B: lost without one (disagrees); C: a callback made
    // before, a retry the call log filed, another kind and one too late (open).
    expect(figuresOf(report, TASK)).toMatchObject({
      proposals: 4,
      shadowed: 3,
      rejected: 1,
      decided: 1,
      agreed: 2,
      disagreed: 1,
      open: 1,
      filtered: [],
    });
  });

  it('compares nothing in Shadow for a viewer who does not read the audit trail', async () => {
    const noAudit = {
      ...executive,
      permissions: executive.permissions.filter((p) => p.key !== 'audit.read'),
    };
    const report = await conciergeReport(noAudit);
    expect(report.compared).toBe(false);
    expect(report.handoffs).toBeNull();
    expect(figuresOf(report, QUALIFICATION)).toMatchObject({ agreed: 0, disagreed: 0, open: 3 });
    expect(figuresOf(report, TASK)).toMatchObject({ agreed: 0, disagreed: 0, open: 4 });
    // A person's own decisions read the same.
    expect(figuresOf(report, REPLY)).toMatchObject({ proposals: 7, agreed: 1, disagreed: 1 });
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

  it('counts a person’s hand-off through the command itself', async () => {
    const chat = await lead();
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const handoffsToday = async () =>
      (
        await ask<ConciergeReportDto>(executive, loadConciergeReport, {
          from: today,
          to: today,
          limit: 1,
        })
      ).handoffs?.find((h) => h.by === 'person' && h.reason === 'request')?.count ?? 0;
    const before = await handoffsToday();
    await asPrincipal({ ...chat.owner, entityIds: [ENTITY] }, (context) =>
      runCommand(
        handOffWhatsAppThread,
        { context, audit, outbox },
        { entityId: ENTITY, threadId: chat.threadId, reason: 'request' },
      ),
    );
    expect(await handoffsToday()).toBe(before + 1);
  });

  it('gives the AI spend over the distinct leads it worked on', async () => {
    const report = await conciergeReport(executive);
    // 7 replies at ₹4, 3 facts at ₹2, 4 callbacks at ₹1, 3 refused at ₹3 and one run for nothing:
    // ₹47 over leads A, B and C, ₹15.666… a lead.
    expect(report.spend).toEqual({ total: '47.00', runs: 18, leads: 3, perLead: '15.67' });
  });

  it('rounds the spend per lead half up to the paisa', async () => {
    // One paisa over two leads, on a day of the 1990s of its own (no audit rows are written):
    // half a paisa a lead, shown as one.
    const day = (offset: number) =>
      new Date(Date.UTC(1990, 0, 1) + offset * 86_400_000).toISOString();
    const base = Math.floor(Math.random() * 3650);
    const runAt = (minutes: number) =>
      new Date(Date.parse(day(base)) + minutes * 60_000).toISOString();
    await seedRun({ agent: 'agent:concierge', actionType: REPLY, at: runAt(1), costPaise: 1 });
    for (const l of [leadA, leadB]) {
      await seedRun({
        agent: 'agent:concierge',
        actionType: TASK,
        at: runAt(2),
        action: {
          input: {
            entityId: ENTITY,
            opportunityId: l.opportunityId,
            kind: 'callback',
            dueAt: runAt(600),
            assigneeId: l.owner.id,
          },
          state: 'shadowed',
        },
      });
    }
    const first = day(base).slice(0, 10);
    const report = await ask<ConciergeReportDto>(executive, loadConciergeReport, {
      from: first,
      to: first,
      limit: 1,
    });
    expect(report.spend).toEqual({ total: '0.01', runs: 3, leads: 2, perLead: '0.01' });
  });
});

describe('the Co-pilot report’s figures (§8.1)', () => {
  it('counts its proposals per action type and its spend per lead', async () => {
    const report = await ask(executive, loadCopilotReport, { limit: 10 });
    expect(figuresOf(report, TEMPLATE)).toMatchObject({ proposals: 1, agreed: 1, open: 0 });
    // The follow-ups on lead C: no follow-up of a person's own after any of them.
    expect(figuresOf(report, TASK)).toMatchObject({ proposals: 120, agreed: 0, open: 120 });
    expect(figuresOf(report, QUALIFICATION)).toMatchObject({ proposals: 1, agreed: 1 });
    // ₹10 and 120 runs at ₹0.10 (the facts' run cost nothing) over lead A (the template), C (the
    // follow-ups) and B (the facts and a brief).
    expect(report.spend).toEqual({ total: '22.00', runs: 122, leads: 3, perLead: '7.33' });
    // The other company's refused reply is not this company's.
    expect(report.filtered).toEqual([]);
  });
});

describe('the review sample (§8.1)', () => {
  it('is the WhatsApp assistant’s drafted replies alone, oldest first, beside what people did', async () => {
    const sample = await ask(executive, loadConciergeSample);
    // Its 7 replies; its facts and callbacks stay in the report's figures.
    expect(sample.proposals).toBe(7);
    expect(sample.compared).toBe(true);
    expect(sample.items.map((i) => i.actionId)).toEqual(conciergeReplies);
    expect(new Set(sample.items.map((i) => i.actionType))).toEqual(new Set([REPLY]));
    expect(sample.items[0]).toMatchObject({
      actionType: REPLY,
      asked: 'Need a pump for 120 ft',
      draft: { kind: 'reply', text: 'Draft at 11' },
      did: { kind: 'message', body: 'We will call you about the 120 ft pump', fromDraft: false },
      state: 'shadowed',
      agreement: 'open',
    });
    expect(sample.items.at(-1)).toMatchObject({ state: 'executed', agreement: 'open' });
    expect(sample.filtered).toEqual([{ actionType: REPLY, reason: 'reply_too_long', runs: 2 }]);
  });

  it('takes 50 of a long period, spread evenly, and the same 50 every time', async () => {
    const sample = await ask(executive, loadCopilotSample);
    expect(sample.proposals).toBe(122);
    expect(sample.items).toHaveLength(50);
    expect(await ask(executive, loadCopilotSample)).toEqual(sample);
    // 122 proposals in 50 runs of equal length (22 of three, 28 of two), the first of each.
    const all = [copilotFacts, copilotTemplate, ...copilotTasks];
    const picked: string[] = [];
    let i = 0;
    for (let b = 0; b < 50; b += 1) {
      picked.push(all[i] ?? '');
      i += b < 122 % 50 ? 3 : 2;
    }
    expect(sample.items.map((x) => x.actionId)).toEqual(picked);
    // The facts beside the first value a person recorded after them, not its later correction.
    expect(sample.items[0]).toMatchObject({
      actionType: QUALIFICATION,
      draft: { kind: 'facts', facts: { requiredHp: 5 } },
      did: { kind: 'facts', facts: { requiredHp: 5 } },
      agreement: 'agree',
    });
    // The template beside the one a person sent, on the period's first day, whose four proposals
    // the set holds all of.
    const firstDay = await ask(executive, loadCopilotSample, { to: FROM });
    expect(firstDay.items).toHaveLength(4);
    expect(firstDay.items.find((x) => x.actionId === copilotTemplate)).toMatchObject({
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
