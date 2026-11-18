import {
  CONCIERGE_ACTION_TYPES,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type InboundWhatsAppRecorded,
  type InboxDecisionDto,
  type Principal,
  type WhatsAppHandoffReason,
} from '@shakti/contracts';
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
import { AGENT_DEFAULTS } from '../../src/ai/agent-defaults';
import {
  CONCIERGE_PURPOSE,
  conciergeCeilings,
  conciergeModelEstimatePaise,
  conciergeRefusalsKey,
  conciergeRunsKey,
  runConcierge,
  type ConciergeDeps,
} from '../../src/ai/concierge/run-concierge';
import { createAiProvider } from '../../src/ai/provider';
import { runAgentStep } from '../../src/ai/runtime';
import { fakeModelTransport, fakeReply, type FakeModelTransport } from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { approveInboxItem, editInboxItem, rejectInboxItem } from '../../src/commands/agents/inbox';
import {
  recordInboundWhatsApp,
  recordWhatsAppHandOff,
} from '../../src/commands/messaging/platform';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue, type KeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';
import { loadConciergeDraft, loadConciergeReport } from '../../src/queries/agents/concierge';

// The WhatsApp Concierge's runs end to end on Postgres (A3, docs/03-roadmap-appendix/phase2.md
// §7.2): one run per customer message, bound to the message's chat and read as the agent, asked of
// the fake transport and held to the output filter; the switches and caps that stop a run before
// anything is read; the rules and answers that hand a chat to people; and, under Needs approval,
// the draft line and the shadow report as people read them. Company 2 only, so no other suite's
// Concierge settings meet these; the settings rows are removed after.

const ENTITY = 2;
const REPLY = CONCIERGE_ACTION_TYPES.reply;
const madeConfigs: string[] = [];
let channel: WhatsAppChannelFixture;
let executive: Principal;

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

/** One setting of the Concierge in the company, replacing any row with the same key. */
async function setting(row: {
  actionType?: string | null;
  autonomy?: string | null;
  cap?: number | null;
  enabled?: boolean;
}): Promise<void> {
  const id = newId();
  madeConfigs.push(id);
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:concierge'
             and action_type is not distinct from ${row.actionType ?? null} and entity_id = ${ENTITY}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, daily_spend_cap_paise, enabled, created_by)
             values (${id}, 'agent:concierge', ${row.actionType ?? null}, ${ENTITY}, ${row.autonomy ?? null},
                     ${row.cap ?? null}, ${row.enabled ?? true}, ${executive.id})`;
  });
}

/** A customer of the company whose lead an active caller owns, with an open chat. */
interface Chat extends WhatsAppCustomerFixture {
  threadId: string;
  caller: Principal;
}

async function chat(handledBy: 'assistant' | 'people' = 'assistant'): Promise<Chat> {
  const customer = await whatsappCustomer(ENTITY);
  const teamId = await createTestTeam(ENTITY, 'concierge runs');
  const user = await createTestUser([{ entityId: ENTITY, roleKey: 'tele_caller_cc', teamId }]);
  const caller = await createTestPrincipal('tele_caller_cc', [ENTITY], { id: user.id, teamId });
  await asMigrator(async (m) => {
    await m`update account_entities set owner_id = ${caller.id}, team_id = ${teamId}
             where account_id = ${customer.accountId} and entity_id = ${ENTITY}`;
    await m`update opportunities set owner_id = ${caller.id}, team_id = ${teamId}
             where id = ${customer.opportunityId}`;
  });
  const first = await say(customer, 'Namaste', handledBy);
  return { ...customer, threadId: first.threadId, caller };
}

/** A customer message on the chat, as the webhook records it. */
function say(
  c: Pick<WhatsAppCustomerFixture, 'waId'>,
  body: string,
  handledBy: 'assistant' | 'people' = 'assistant',
): Promise<InboundWhatsAppRecorded> {
  return run<InboundWhatsAppRecorded>(workers([ENTITY]), recordInboundWhatsApp, {
    phoneNumberId: channel.phoneNumberId,
    waId: c.waId,
    providerMessageId: `wamid.${newId()}`,
    kind: 'text',
    body,
    buttonPayload: null,
    sentAt: new Date().toISOString(),
    handledBy,
  });
}

/** A run's dependencies on chat `c`: the fake model answering `answers` in turn, the store. */
function deps(
  c: Pick<Chat, 'threadId'>,
  answers: string[],
  keyValue: KeyValue = memoryKeyValue(),
): ConciergeDeps & { transport: FakeModelTransport; handedOff: WhatsAppHandoffReason[] } {
  const transport = fakeModelTransport(answers.map((a) => fakeReply(a)));
  const handedOff: WhatsAppHandoffReason[] = [];
  return {
    transport,
    handedOff,
    keyValue,
    provider: createAiProvider({
      claude: transport,
      voyage: undefined,
      keyValue,
      logger: memoryLogger(),
    }),
    logger: memoryLogger(),
    handOff: async (reason) => {
      handedOff.push(reason);
      await run(workers([ENTITY]), recordWhatsAppHandOff, {
        entityId: ENTITY,
        threadId: c.threadId,
        reason,
      });
    },
  };
}

/** One run on the chat's newest message, as the worker starts it. */
async function runOn(
  c: Chat,
  message: InboundWhatsAppRecorded,
  d: ReturnType<typeof deps>,
  eventId = newId(),
) {
  return runConcierge(
    { eventId, entityId: ENTITY, threadId: c.threadId, messageId: message.messageId },
    d,
  );
}

const reply = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    reply: { text, form: 'qualification_question', directives: [] },
    qualification: null,
    callback: null,
    handoff: null,
    confidence: 'high',
    ...extra,
  });

async function threadOf(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ handled_by: string; handoff_reason: string | null }[]>`
      select handled_by, handoff_reason from whatsapp_threads where id = ${id}`,
  );
  return row;
}

async function actionsOf(id: string) {
  return asMigrator(
    (m) => m<{ action_type: string; state: string; body: string | null }[]>`
      select action_type, state, input_json ->> 'body' as body from agent_actions
       where agent = 'agent:concierge' and entity_id = ${ENTITY}
         and (input_json ->> 'threadId' = ${id}
              or input_json ->> 'opportunityId' in (select opportunity_id::text from whatsapp_threads where id = ${id}))
       order by created_at, action_type`,
  );
}

async function outboundOf(id: string) {
  return asMigrator(
    (m) => m<{ body_masked: string; drafted_by_agent_action_id: string | null }[]>`
      select body_masked, drafted_by_agent_action_id from whatsapp_messages
       where thread_id = ${id} and direction = 'outbound' and kind = 'text'`,
  );
}

beforeAll(async () => {
  channel = await whatsappChannel(ENTITY);
  executive = await createTestPrincipal('executive', [ENTITY]);
  // Switched on with a spending limit for the company; each action type starts in Shadow.
  await setting({ cap: 10_000 });
  for (const actionType of Object.values(CONCIERGE_ACTION_TYPES)) {
    await asMigrator(
      (m) => m`delete from agent_configs where agent = 'agent:concierge'
                and action_type = ${actionType} and entity_id = ${ENTITY}`,
    );
  }
});

afterAll(async () => {
  await asMigrator((m) => m`delete from agent_configs where id = any(${madeConfigs})`);
  await closeDb();
});

describe('a Concierge run on a customer message', () => {
  it('starts in Shadow: the reply and the facts are recorded, nothing is sent, no inbox is filled', async () => {
    const c = await chat();
    const msg = await say(c, 'Bore 180 ft hai');
    const d = deps(c, [
      reply('Thank you. What power do you need, in HP?', {
        qualification: { pumpDepthFt: 180 },
      }),
    ]);
    const result = await runOn(c, msg, d);
    expect(result.outcome).toBe('ran');
    expect(result.runs.reply?.outcome).toBe('shadowed');
    expect(result.runs.qualification?.outcome).toBe('shadowed');
    expect(result.runs.callback?.outcome).toBe('nothing_to_do');
    expect(result.runs.reply?.inboxItemId).toBeNull();
    expect(await outboundOf(c.threadId)).toEqual([]);
    const actions = await actionsOf(c.threadId);
    expect(actions).toHaveLength(2);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action_type: 'crm.lead.qualification.set', state: 'shadowed' }),
        expect.objectContaining({
          action_type: REPLY,
          state: 'shadowed',
          body: 'Thank you. What power do you need, in HP?',
        }),
      ]),
    );
    // The model read this chat alone, its customer's words labelled as data.
    const [request] = d.transport.requests;
    expect(request?.user).toContain('<untrusted_data source="customer_message">');
    expect(request?.user).toContain('Bore 180 ft hai');
  });

  it('reads nothing of another customer’s chat', async () => {
    const other = await chat();
    await say(other, 'Mera bill 9100 aata hai');
    const c = await chat();
    const msg = await say(c, 'I have a farm near the river');
    const d = deps(c, [reply('Thank you. How deep is your bore, in feet?')]);
    await runOn(c, msg, d);
    expect(d.transport.requests[0]?.user).not.toContain('9100');
  });

  it('records nothing twice for a repeated delivery, and asks the model once', async () => {
    const c = await chat();
    const msg = await say(c, 'I want a pump for my field');
    const kv = memoryKeyValue();
    const eventId = newId();
    const answer = reply('Thank you. How deep is your bore, in feet?');
    const first = await runOn(c, msg, deps(c, [answer], kv), eventId);
    const again = deps(c, [answer], kv);
    const second = await runOn(c, msg, again, eventId);
    expect(second.runs.reply?.runId).toBe(first.runs.reply?.runId);
    expect(again.transport.requests).toHaveLength(0);
    expect((await actionsOf(c.threadId)).filter((a) => a.action_type === REPLY)).toHaveLength(1);
  });

  it('is skipped on a chat people answer, and on an older message than the newest', async () => {
    const people = await chat('people');
    const msg = await say(people, 'Hello');
    const d = deps(people, []);
    expect((await runOn(people, msg, d)).skip).toBe('with_people');
    const c = await chat();
    const older = await say(c, 'One');
    await say(c, 'Two');
    const later = deps(c, []);
    expect((await runOn(c, older, later)).skip).toBe('superseded');
    expect([...d.transport.requests, ...later.transport.requests]).toHaveLength(0);
  });

  it('hands the chat to people at once on a complaint or a price question, asking nothing', async () => {
    for (const [words, reason] of [
      ['The controller is not working', 'complaint'],
      ['3 HP ka kitna lagega?', 'question'],
    ] as const) {
      const c = await chat();
      const msg = await say(c, words);
      const d = deps(c, []);
      const result = await runOn(c, msg, d);
      expect(result.outcome).toBe('handed_off');
      expect(d.transport.requests).toHaveLength(0);
      expect(await threadOf(c.threadId)).toEqual({ handled_by: 'people', handoff_reason: reason });
    }
  });

  it('hands the chat to people when the answer asks to, or is unsure', async () => {
    const c = await chat();
    const msg = await say(c, 'Do you sell tractors?');
    const d = deps(c, [
      reply('Thank you. A member of our team will reply soon.', {
        reply: {
          text: 'Thank you. A member of our team will reply soon.',
          form: 'handoff',
          directives: [],
        },
        handoff: { reason: 'out_of_scope' },
      }),
    ]);
    const result = await runOn(c, msg, d);
    expect(result.handoff).toBe('out_of_scope');
    expect(await threadOf(c.threadId)).toEqual({
      handled_by: 'people',
      handoff_reason: 'question',
    });
  });

  it('hands the chat to people after three answers in a row the filter refused', async () => {
    const c = await chat();
    const kv = memoryKeyValue();
    const refused = reply('Your pump is free.', {
      reply: { text: 'Your pump is free.', form: 'greeting', directives: [] },
    });
    for (const n of [1, 2, 3]) {
      const msg = await say(c, `Message ${String(n)}`);
      const result = await runOn(c, msg, deps(c, [refused], kv));
      expect(result.runs.reply?.outcome).toBe('filtered');
      expect(result.handoff).toBe(n === 3 ? 'refusals' : undefined);
    }
    expect(await threadOf(c.threadId)).toEqual({
      handled_by: 'people',
      handoff_reason: 'filter_refusals',
    });
    expect(await kv.get(conciergeRefusalsKey(ENTITY, c.threadId))).toBeNull();
  });

  it('stops before reading when switched off, without a limit or past the spend, and hands the chat to people', async () => {
    const stops: { outcome: string; run: string | undefined; facts: boolean }[] = [];
    const stopOn = async (prepare: () => Promise<void>) => {
      const c = await chat();
      const msg = await say(c, 'Hello there');
      await prepare();
      const d = deps(c, []);
      const logger = memoryLogger();
      const result = await runOn(c, msg, { ...d, logger });
      expect(d.transport.requests).toHaveLength(0);
      expect(d.handedOff).toEqual(['no_assistant']);
      expect(await threadOf(c.threadId)).toEqual({
        handled_by: 'people',
        handoff_reason: 'no_assistant',
      });
      stops.push({
        outcome: result.outcome,
        run: result.runs.reply?.outcome,
        // Nothing of the chat's messages, lead or rules was read.
        facts: logger.entries.some((e) => e.fields.name === 'agents.concierge.facts'),
      });
    };
    // Switched off for the company.
    await stopOn(() => setting({ cap: 10_000, enabled: false }));
    // No spending limit set yet.
    await stopOn(() => setting({ cap: null }));
    // A cap below one run's estimate.
    await stopOn(() => setting({ cap: Math.max(1, conciergeModelEstimatePaise() - 1) }));
    expect(stops).toEqual([
      { outcome: 'stopped', run: 'switched_off', facts: false },
      { outcome: 'stopped', run: 'cap_reached', facts: false },
      { outcome: 'stopped', run: 'cap_reached', facts: false },
    ]);
    await setting({ cap: 10_000 });
  });

  it('stops before reading past the chat’s runs today, and hands the chat to people', async () => {
    await setting({ cap: 10_000 });
    const c = await chat();
    const msg = await say(c, 'Hello there');
    const kv = memoryKeyValue();
    await kv.set(
      conciergeRunsKey(ENTITY, c.threadId, istCalendarDate(new Date())),
      String(AGENT_DEFAULTS.concierge.runsPerThreadDay),
      600,
    );
    const d = deps(c, [], kv);
    const logger = memoryLogger();
    const result = await runOn(c, msg, { ...d, logger });
    expect({ outcome: result.outcome, run: result.runs.reply?.outcome }).toEqual({
      outcome: 'stopped',
      run: 'cap_reached',
    });
    expect(d.transport.requests).toHaveLength(0);
    expect(logger.entries.some((e) => e.fields.name === 'agents.concierge.facts')).toBe(false);
    expect(await threadOf(c.threadId)).toEqual({
      handled_by: 'people',
      handoff_reason: 'no_assistant',
    });
  });

  it('hands off on the hand-off words before any stop, and records nothing on a chat people answer', async () => {
    await setting({ cap: 10_000, enabled: false });
    try {
      const c = await chat();
      const msg = await say(c, 'consumer forum me complaint karunga');
      const d = deps(c, []);
      const result = await runOn(c, msg, d);
      expect({ outcome: result.outcome, handoff: result.handoff, runs: result.runs }).toEqual({
        outcome: 'handed_off',
        handoff: 'legal',
        runs: {},
      });
      expect(await threadOf(c.threadId)).toEqual({
        handled_by: 'people',
        handoff_reason: 'complaint',
      });

      const people = await chat('people');
      const later = await say(people, 'Hello again', 'people');
      const skipped = await runOn(people, later, deps(people, []));
      expect({ outcome: skipped.outcome, skip: skipped.skip, runs: skipped.runs }).toEqual({
        outcome: 'skipped',
        skip: 'with_people',
        runs: {},
      });
    } finally {
      await setting({ cap: 10_000 });
    }
  });

  it('counts a refused answer once when a redelivery completes a partial run', async () => {
    const c = await chat();
    const msg = await say(c, 'Hello');
    const kv = memoryKeyValue();
    const eventId = newId();
    const refusals = conciergeRefusalsKey(ENTITY, c.threadId);
    const refused = reply('Your pump is free.', {
      reply: { text: 'Your pump is free.', form: 'greeting', directives: [] },
    });
    // The first delivery recorded the refused reply and counted it, then stopped before its next
    // step.
    await runAgentStep(
      {
        agent: 'agent:concierge',
        entityId: ENTITY,
        eventId,
        purpose: CONCIERGE_PURPOSE,
        actionType: REPLY,
        threadId: c.threadId,
        decide: () => Promise.resolve({ filtered: 'text_has_promise' }),
        ceilings: conciergeCeilings(ENTITY),
      },
      deps(c, [], kv),
    );
    await kv.incr(refusals, 600);
    // The redelivery records the other steps from the same answer and counts nothing again.
    const again = deps(c, [refused], kv);
    const result = await runOn(c, msg, again, eventId);
    expect(result.runs.reply?.outcome).toBe('filtered');
    expect(result.runs.qualification?.outcome).toBe('nothing_to_do');
    expect(await kv.get(refusals)).toBe('1');
  });
});

describe('under Needs approval', () => {
  it('shows the draft to its owner, who sends, edits or discards it; the report lists each beside what was sent', async () => {
    await setting({ actionType: REPLY, autonomy: 'needs_approval' });
    try {
      const sent: string[] = [];
      for (const decision of ['approve', 'edit', 'reject'] as const) {
        const c = await chat();
        const msg = await say(c, `Need a pump, decision ${decision}`);
        const text = 'Thank you. How deep is your bore, in feet?';
        const result = await runOn(c, msg, deps(c, [reply(text)]));
        expect(result.runs.reply?.outcome).toBe('proposed');

        // The owner sees it on the chat; nobody else does.
        const shown = await asPrincipal(c.caller, (ctx) =>
          loadConciergeDraft(ctx, { entityId: ENTITY, threadId: c.threadId }),
        );
        expect(shown.draft?.body).toBe(text);
        const stranger = await createTestPrincipal('tele_caller_cc', [ENTITY]);
        expect(
          (
            await asPrincipal(stranger, (ctx) =>
              loadConciergeDraft(ctx, { entityId: ENTITY, threadId: c.threadId }),
            )
          ).draft,
        ).toBeNull();

        const itemId = shown.draft?.itemId ?? '';
        if (decision === 'approve') {
          await run<InboxDecisionDto>(c.caller, approveInboxItem, { entityId: ENTITY, itemId });
          sent.push(text);
        } else if (decision === 'edit') {
          await run<InboxDecisionDto>(c.caller, editInboxItem, {
            entityId: ENTITY,
            itemId,
            changes: { body: 'How deep is the bore on your farm?' },
          });
          sent.push('How deep is the bore on your farm?');
        } else {
          await run<InboxDecisionDto>(c.caller, rejectInboxItem, { entityId: ENTITY, itemId });
        }
        const out = await outboundOf(c.threadId);
        expect(out.map((o) => o.body_masked)).toEqual(decision === 'reject' ? [] : [sent.at(-1)]);
        expect(
          (
            await asPrincipal(c.caller, (ctx) =>
              loadConciergeDraft(ctx, { entityId: ENTITY, threadId: c.threadId }),
            )
          ).draft,
        ).toBeNull();
      }

      const today = istCalendarDate(new Date());
      const report = await asPrincipal(executive, (ctx) =>
        loadConciergeReport(ctx, { entityId: ENTITY, from: today, to: today, limit: 100 }),
      );
      const states = report.items.map((i) => i.state);
      expect(states).toEqual(expect.arrayContaining(['sent', 'edited', 'discarded', 'shadowed']));
      const edited = report.items.find((i) => i.state === 'edited');
      expect(edited?.sent).toEqual(
        expect.objectContaining({ body: 'How deep is the bore on your farm?', fromDraft: true }),
      );
      expect(edited?.asked).toBe('Need a pump, decision edit');
      expect(report.items.find((i) => i.state === 'discarded')?.sent).toBeNull();
      expect(report.drafts.total).toBe(report.items.length);
      expect(report.filtered.map((f) => f.reason)).toContain('text_has_promise');
    } finally {
      await asMigrator(
        (m) => m`delete from agent_configs where agent = 'agent:concierge'
                  and action_type = ${REPLY} and entity_id = ${ENTITY}`,
      );
    }
  });

  it('shows a draft under Suggest as one to decide in the Agent Inbox, not to send from the chat', async () => {
    const shownUnder = async (autonomy: 'suggest' | 'needs_approval') => {
      await setting({ actionType: REPLY, autonomy });
      const c = await chat();
      const msg = await say(c, `Need a pump, ${autonomy}`);
      const text = 'Thank you. How deep is your bore, in feet?';
      await runOn(c, msg, deps(c, [reply(text)]));
      const shown = await asPrincipal(c.caller, (ctx) =>
        loadConciergeDraft(ctx, { entityId: ENTITY, threadId: c.threadId }),
      );
      return { body: shown.draft?.body, decidable: shown.draft?.decidable };
    };
    try {
      const text = 'Thank you. How deep is your bore, in feet?';
      expect(await shownUnder('suggest')).toEqual({ body: text, decidable: false });
      expect(await shownUnder('needs_approval')).toEqual({ body: text, decidable: true });
    } finally {
      await asMigrator(
        (m) => m`delete from agent_configs where agent = 'agent:concierge'
                  and action_type = ${REPLY} and entity_id = ${ENTITY}`,
      );
    }
  });

  it('keeps the report from a caller and the draft line from an agent', async () => {
    const caller = await createTestPrincipal('tele_caller_cc', [ENTITY]);
    const today = istCalendarDate(new Date());
    await expect(
      asPrincipal(caller, (ctx) =>
        loadConciergeReport(ctx, { entityId: ENTITY, from: today, to: today, limit: 10 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
