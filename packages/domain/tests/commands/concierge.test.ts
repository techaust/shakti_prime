import {
  CONCIERGE_ACTION_TYPES,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type InboundWhatsAppRecorded,
  type Principal,
} from '@shakti/contracts';
import { withRequestContext } from '@shakti/db';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  principalFor,
  whatsappChannel,
  whatsappCustomer,
  type WhatsAppChannelFixture,
  type WhatsAppCustomerFixture,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentPrincipal } from '../../src/ai/runtime';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { approveInboxItem, editInboxItem, rejectInboxItem } from '../../src/commands/agents/inbox';
import { recordAgentRun } from '../../src/commands/agents/record-run';
import { recordInboundWhatsApp } from '../../src/commands/messaging/platform';
import { sendWhatsAppReply } from '../../src/commands/messaging/reply';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// A3 WhatsApp Concierge, its proposals (docs/03-roadmap-appendix/phase2.md §7.2): the Concierge
// records an in-window reply (`messaging.reply.send`), the lead's qualification facts
// (`crm.lead.qualification.set`) and a callback (`crm.task.create`) as itself, in a run bound to
// the customer's thread; it starts in Shadow, where nothing is sent and no inbox is filled; under
// Needs approval the lead's owner sends the reply as written or edited, and the message is marked
// as the assistant's draft. Nothing it proposes reaches a customer without a person. Each test's
// customer is new; the agent settings this suite writes are removed after it.

const REPLY = CONCIERGE_ACTION_TYPES.reply;
const QUALIFY = CONCIERGE_ACTION_TYPES.qualification;
const CALLBACK = CONCIERGE_ACTION_TYPES.callback;

const workers = (entityIds: number[]): Principal => ({
  ...principalFor('system:workers', entityIds),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
  kind: 'system',
});

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

/** Runs a command as the Concierge in a run bound to `threadId` (none: unbound). */
function asConcierge<T>(
  entityId: number,
  threadId: string | undefined,
  command: AnyCommand,
  input: unknown,
): Promise<T> {
  return withRequestContext(
    agentPrincipal('agent:concierge', entityId),
    threadId === undefined ? {} : { agentThreadId: threadId },
    (context) => runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

async function refusal(
  promise: Promise<unknown>,
): Promise<{ code: string | undefined; reason: string | undefined }> {
  try {
    await promise;
  } catch (e) {
    const err = e as { code?: string; details?: { reason?: string } };
    return { code: err.code, reason: err.details?.reason };
  }
  throw new Error('expected a refusal');
}

interface RunAnswer {
  runId: string;
  outcome: string;
  actionId: string | null;
  inboxItemId: string | null;
}

let channel: WhatsAppChannelFixture;
let accounts: Principal;
let executive: Principal;
const madeConfigs: string[] = [];

/** A customer of company 1 whose lead and customer an active caller owns, who has written once. */
interface Chat extends WhatsAppCustomerFixture {
  threadId: string;
  caller: Principal;
}

async function chat(): Promise<Chat> {
  const customer = await whatsappCustomer(1);
  // The owner is a person with a role in the company, so a suggestion may be for them.
  const teamId = await createTestTeam(1, 'concierge team');
  const user = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
  const caller = await createTestPrincipal('tele_caller_cc', [1], { id: user.id, teamId });
  await asMigrator(async (m) => {
    await m`update account_entities set owner_id = ${caller.id}, team_id = ${teamId}
             where account_id = ${customer.accountId} and entity_id = 1`;
    await m`update opportunities set owner_id = ${caller.id}, team_id = ${teamId}
             where id = ${customer.opportunityId}`;
  });
  const recorded = await run<InboundWhatsAppRecorded>(workers([1]), recordInboundWhatsApp, {
    phoneNumberId: channel.phoneNumberId,
    waId: customer.waId,
    providerMessageId: `wamid.${newId()}`,
    kind: 'text',
    body: 'My bore is 180 ft deep. Please call me.',
    buttonPayload: null,
    sentAt: new Date().toISOString(),
    handledBy: 'assistant',
  });
  return { ...customer, threadId: recorded.threadId, caller };
}

/** One of the Concierge's runs in company 1, with its proposal for `actionType`. */
function runInput(actionType: string, proposal: Record<string, unknown>) {
  return {
    entityId: 1,
    agent: 'agent:concierge',
    purpose: 'whatsapp_reply',
    actionType,
    model: 'claude-sonnet-5-5',
    tokensIn: 3000,
    tokensOut: 120,
    costPaise: 9,
    durationMs: 1400,
    ended: 'completed',
    proposal,
  };
}

const replyProposal = (c: Chat, body = 'Thank you. Our team will call you soon.') => ({
  input: { entityId: 1, threadId: c.threadId, accountId: c.accountId, body },
  subjectType: 'account',
  subjectId: c.accountId,
  assigneeId: c.caller.id,
});

const qualificationProposal = (c: Chat) => ({
  input: { entityId: 1, opportunityId: c.opportunityId, facts: { pumpDepthFt: 180 } },
  subjectType: 'opportunity',
  subjectId: c.opportunityId,
  assigneeId: c.caller.id,
});

const callbackProposal = (c: Chat) => ({
  input: {
    entityId: 1,
    opportunityId: c.opportunityId,
    kind: 'callback',
    dueAt: new Date(Date.now() + 26 * 3_600_000).toISOString(),
    assigneeId: c.caller.id,
  },
  subjectType: 'opportunity',
  subjectId: c.opportunityId,
  assigneeId: c.caller.id,
});

/** The Concierge's action type set to `autonomy` in company 1, replacing any such row. */
async function autonomy(actionType: string, level: string): Promise<void> {
  const id = newId();
  madeConfigs.push(id);
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:concierge'
             and action_type = ${actionType} and entity_id = 1`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, created_by)
             values (${id}, 'agent:concierge', ${actionType}, 1, ${level}, ${executive.id})`;
  });
}

async function clearAutonomy(actionType: string): Promise<void> {
  await asMigrator(
    (m) => m`delete from agent_configs where agent = 'agent:concierge'
              and action_type = ${actionType} and entity_id = 1`,
  );
}

/** A reply filed for the owner under Needs approval. */
async function draft(c: Chat, body?: string): Promise<RunAnswer> {
  await autonomy(REPLY, 'needs_approval');
  try {
    return await asConcierge<RunAnswer>(
      1,
      c.threadId,
      recordAgentRun,
      runInput(REPLY, replyProposal(c, body)),
    );
  } finally {
    await clearAutonomy(REPLY);
  }
}

async function outboundOf(threadId: string) {
  return asMigrator(
    (m) => m<
      { body_masked: string; sent_by: string; drafted_by_agent_action_id: string | null }[]
    >`select body_masked, sent_by, drafted_by_agent_action_id from whatsapp_messages
       where thread_id = ${threadId} and direction = 'outbound' and kind = 'text'`,
  );
}

beforeAll(async () => {
  channel = await whatsappChannel(1);
  accounts = await createTestPrincipal('accounts', [1]);
  executive = await createTestPrincipal('executive', [1]);
});

afterAll(async () => {
  await asMigrator((m) => m`delete from agent_configs where id = any(${madeConfigs})`);
  await closeDb();
});

describe('the Concierge records its proposals in a run bound to the thread', () => {
  it('starts in Shadow: each proposal is recorded shadowed, with no inbox item and no message', async () => {
    const c = await chat();
    for (const [type, proposal] of [
      [REPLY, replyProposal(c)],
      [QUALIFY, qualificationProposal(c)],
      [CALLBACK, callbackProposal(c)],
    ] as const) {
      const answer = await asConcierge<RunAnswer>(
        1,
        c.threadId,
        recordAgentRun,
        runInput(type, proposal),
      );
      expect({ type, outcome: answer.outcome, item: answer.inboxItemId }).toEqual({
        type,
        outcome: 'shadowed',
        item: null,
      });
    }
    expect(await outboundOf(c.threadId)).toEqual([]);
  });

  it('proposes nothing about a customer its run is not bound to, or unbound', async () => {
    const c = await chat();
    const other = await chat();
    for (const threadId of [undefined, other.threadId]) {
      for (const [type, proposal] of [
        [REPLY, replyProposal(c)],
        [QUALIFY, qualificationProposal(c)],
        [CALLBACK, callbackProposal(c)],
      ] as const) {
        expect(
          await refusal(asConcierge(1, threadId, recordAgentRun, runInput(type, proposal))),
        ).toEqual({ code: 'validation_failed', reason: 'agent_proposal_invalid' });
      }
    }
  });

  it('refuses a reply that names its own draft, and one in another company', async () => {
    const c = await chat();
    const named = replyProposal(c);
    expect(
      await refusal(
        asConcierge(
          1,
          c.threadId,
          recordAgentRun,
          runInput(REPLY, {
            ...named,
            input: { ...named.input, draftedByAgentActionId: newId() },
          }),
        ),
      ),
    ).toEqual({ code: 'validation_failed', reason: 'agent_proposal_invalid' });
    // The Concierge of company 2 cannot record a run in company 1.
    expect(
      await refusal(
        withRequestContext(agentPrincipal('agent:concierge', 2), {}, (context) =>
          runCommand(recordAgentRun, { context, audit, outbox }, runInput(REPLY, named)),
        ),
      ),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('messaging.reply.send', () => {
  it('under Needs approval, the owner sends the draft and the message is marked as the assistant’s', async () => {
    const c = await chat();
    const filed = await draft(c);
    expect(filed.outcome).toBe('proposed');
    const decided = await run<{ state: string; edited: boolean }>(c.caller, approveInboxItem, {
      entityId: 1,
      itemId: filed.inboxItemId,
    });
    expect(decided).toMatchObject({ state: 'approved', edited: false });
    expect(await outboundOf(c.threadId)).toEqual([
      {
        body_masked: 'Thank you. Our team will call you soon.',
        sent_by: c.caller.id,
        drafted_by_agent_action_id: filed.actionId,
      },
    ]);
    const [row] = await asMigrator(
      (m) => m<{ after_json: Record<string, unknown> }[]>`
        select after_json from audit_logs
         where command = ${REPLY} and actor_principal_id = ${c.caller.id} and outcome = 'ok'`,
    );
    expect(row?.after_json).toMatchObject({ draftedByAssistant: true, messageKind: 'text' });
  });

  it('sends the words as the owner edited them, counted as edited', async () => {
    const c = await chat();
    const filed = await draft(c);
    const decided = await run<{ edited: boolean }>(c.caller, editInboxItem, {
      entityId: 1,
      itemId: filed.inboxItemId,
      changes: { body: 'Thank you. I will call you at 11 tomorrow.' },
    });
    expect(decided.edited).toBe(true);
    expect((await outboundOf(c.threadId)).map((m) => m.body_masked)).toEqual([
      'Thank you. I will call you at 11 tomorrow.',
    ]);
  });

  it('sends nothing when the owner discards the draft, and a discarded draft cannot be sent', async () => {
    const c = await chat();
    const filed = await draft(c);
    await run(c.caller, rejectInboxItem, { entityId: 1, itemId: filed.inboxItemId });
    expect(await outboundOf(c.threadId)).toEqual([]);
    expect(
      await refusal(
        run(c.caller, sendWhatsAppReply, {
          ...replyProposal(c).input,
          draftedByAgentActionId: filed.actionId,
        }),
      ),
    ).toEqual({ code: 'not_found', reason: 'agent_draft_missing' });
  });

  it('is forbidden without messaging.send, and to the Concierge itself', async () => {
    const c = await chat();
    const filed = await draft(c);
    const input = { ...replyProposal(c).input, draftedByAgentActionId: filed.actionId };
    expect(await refusal(run(accounts, sendWhatsAppReply, input))).toMatchObject({
      code: 'forbidden',
    });
    // The agent reads no draft (agent_actions) and its own scope writes no message.
    const agent = await refusal(asConcierge(1, c.threadId, sendWhatsAppReply, input));
    expect(agent.code === 'not_found' || agent.code === 'forbidden').toBe(true);
    expect(await outboundOf(c.threadId)).toEqual([]);
  });

  it('refuses a company outside the request, and another thread’s draft', async () => {
    const c = await chat();
    const other = await chat();
    const filed = await draft(c);
    const input = { ...replyProposal(c).input, draftedByAgentActionId: filed.actionId };
    const elsewhere = await createTestPrincipal('executive', [2]);
    expect(await refusal(run(elsewhere, sendWhatsAppReply, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(
        run(executive, sendWhatsAppReply, {
          ...replyProposal(other).input,
          draftedByAgentActionId: filed.actionId,
        }),
      ),
    ).toEqual({ code: 'not_found', reason: 'agent_draft_missing' });
    expect(
      await refusal(
        run(executive, sendWhatsAppReply, { ...input, draftedByAgentActionId: newId() }),
      ),
    ).toEqual({ code: 'not_found', reason: 'agent_draft_missing' });
    expect(await outboundOf(c.threadId)).toEqual([]);
    expect(await outboundOf(other.threadId)).toEqual([]);
  });
});

describe('the qualification and the callback, approved', () => {
  it('run as the owner who approves them', async () => {
    const c = await chat();
    await autonomy(QUALIFY, 'needs_approval');
    await autonomy(CALLBACK, 'needs_approval');
    try {
      for (const [type, proposal] of [
        [QUALIFY, qualificationProposal(c)],
        [CALLBACK, callbackProposal(c)],
      ] as const) {
        const filed = await asConcierge<RunAnswer>(
          1,
          c.threadId,
          recordAgentRun,
          runInput(type, proposal),
        );
        expect(filed.outcome).toBe('proposed');
        await run(c.caller, approveInboxItem, { entityId: 1, itemId: filed.inboxItemId });
      }
    } finally {
      await clearAutonomy(QUALIFY);
      await clearAutonomy(CALLBACK);
    }
    const [facts] = await asMigrator(
      (m) => m<{ pump_depth_ft: number; updated_by: string }[]>`
        select pump_depth_ft, updated_by from lead_qualifications
         where opportunity_id = ${c.opportunityId}`,
    );
    expect(facts).toEqual({ pump_depth_ft: 180, updated_by: c.caller.id });
    const tasks = await asMigrator(
      (m) => m<{ kind: string; assignee_id: string; created_by: string }[]>`
        select kind, assignee_id, created_by from tasks where opportunity_id = ${c.opportunityId}`,
    );
    expect(tasks).toEqual([
      { kind: 'callback', assignee_id: c.caller.id, created_by: c.caller.id },
    ]);
  });
});
