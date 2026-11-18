// The WhatsApp Concierge journey's fixtures (`e2e/concierge.spec.ts`), written by the seed on the
// host. Per project and decision, a customer of the tele-caller in company 1 made afresh with a new
// number, who writes on WhatsApp in a chat the assistant answers, and the assistant's reply to it
// filed through the real runtime under Needs approval for the tele-caller, its owner (the settings
// that allow it are set while it is filed and removed after, so no other journey meets them). In
// the snapshot company, on the messages journey's chat, one draft the assistant recorded in Shadow
// with fixed ids, written once and kept (a run and its action are append-only), which the report
// pictures; the journeys run on a fresh database, where it is the company's one draft. Nothing
// reaches a vendor.
import {
  AGENT_PRINCIPAL_IDS,
  CONCIERGE_ACTION_TYPES,
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
} from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  createAiProvider,
  createLead,
  executeCommand,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
  recordInboundWhatsApp,
  runAgentStep,
} from '@shakti/domain';
import { CONCIERGE_CUSTOMERS, CONCIERGE_DECISIONS, CONCIERGE_JOURNEY } from '../concierge-fixtures';
import { PROJECTS, SNAPSHOT_COMPANY, SNAPSHOT_LEADS, WHATSAPP } from '../support/users';

const ENTITY = 1;
const CONCIERGE = AGENT_PRINCIPAL_IDS['agent:concierge'];
const REPLY = CONCIERGE_ACTION_TYPES.reply;
/** The settings that let the drafts be filed, set while they are. */
const SETTINGS = ['01a3c0de-0000-7000-8000-000000000011', '01a3c0de-0000-7000-8000-000000000012'];
/** The snapshot company's shadow draft: its run and its action. */
const SHADOW_RUN = '01a3c0de-0000-7000-8000-000000000001';
const SHADOW_ACTION = '01a3c0de-0000-7000-8000-000000000002';

/** A mobile number no earlier run used. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** Files the assistant's draft on one chat through the runtime, under Needs approval. */
async function draft(threadId: string, accountId: string, ownerId: string): Promise<void> {
  const provider = createAiProvider({
    claude: fakeModelTransport([fakeReply('{}')]),
    voyage: undefined,
    keyValue: memoryKeyValue(),
    logger: memoryLogger(),
  });
  const run = await runAgentStep(
    {
      agent: 'agent:concierge',
      entityId: ENTITY,
      eventId: newId(),
      purpose: 'whatsapp_reply',
      actionType: REPLY,
      threadId,
      async decide(model) {
        await model.complete({ system: 'Seed', question: 'Seed', maxTokens: 10 });
        return {
          input: { entityId: ENTITY, threadId, accountId, body: CONCIERGE_JOURNEY.draft },
          subjectType: 'account',
          subjectId: accountId,
          assigneeId: ownerId,
        };
      },
    },
    { provider, logger: memoryLogger() },
  );
  if (run.outcome !== 'proposed') {
    throw new Error(`the Concierge's draft ended ${run.outcome}, not waiting for its owner`);
  }
}

/** Makes each project's chats for the tele-caller `callerId`, and the snapshot company's draft. */
export async function ensureConciergeJourneys(callerId: string): Promise<void> {
  const caller = principalFor('tele_caller_cc', [ENTITY], { id: callerId });
  const workers = principalFor('system:workers', [ENTITY], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
  const [agentRow, replyRow] = SETTINGS;
  await asMigrator(async (m) => {
    // Earlier runs' drafts left waiting are taken away, so the inbox starts from this run's.
    await m`delete from inbox_items
             where state = 'open' and created_by = ${CONCIERGE} and entity_id = ${ENTITY}`;
    await m`delete from agent_configs where id = any(${SETTINGS})`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, daily_spend_cap_paise, enabled, created_by)
             values (${agentRow ?? ''}, 'agent:concierge', null, ${ENTITY}, 10000, true, ${callerId})`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy, created_by)
             values (${replyRow ?? ''}, 'agent:concierge', ${REPLY}, ${ENTITY}, 'needs_approval', ${callerId})`;
  });
  try {
    for (const project of PROJECTS) {
      for (const decision of CONCIERGE_DECISIONS) {
        const name = CONCIERGE_CUSTOMERS[project][decision];
        const number = phone();
        const lead = await executeCommand(caller, { entityIds: [ENTITY] }, createLead, {
          entityId: ENTITY,
          pipelineKey: 'farmer_pumps',
          contact: { name, phone: number },
          account: { type: 'farm' },
          site: { type: 'borewell', village: 'Chomu' },
        });
        const recorded = await executeCommand(
          workers,
          { entityIds: [ENTITY] },
          recordInboundWhatsApp,
          {
            phoneNumberId: WHATSAPP.numbers[ENTITY].phoneNumberId,
            waId: `91${number}`,
            providerMessageId: `wamid.e2e.${newId()}`,
            kind: 'text',
            body: CONCIERGE_JOURNEY.message,
            buttonPayload: null,
            sentAt: new Date().toISOString(),
            handledBy: 'assistant',
          },
        );
        await draft(recorded.threadId, lead.account.id, callerId);
      }
    }
  } finally {
    await asMigrator((m) => m`delete from agent_configs where id = any(${SETTINGS})`);
  }

  // The snapshot company's chat: one draft in Shadow, after its customer's message, written once.
  const waId = `91${SNAPSHOT_LEADS[1].phone.replace(/\D/g, '')}`;
  await asMigrator(async (m) => {
    const [thread] = await m<{ id: string; account_id: string | null }[]>`
      select id, account_id from whatsapp_threads
       where entity_id = ${SNAPSHOT_COMPANY.entityId} and wa_id = ${waId}`;
    if (thread === undefined || thread.account_id === null) {
      throw new Error('the snapshot company has no matched chat');
    }
    await m`insert into agent_runs (id, entity_id, agent, principal_id, purpose, action_type, model,
                                    tokens_in, tokens_out, cost_paise, outcome, duration_ms, request_id)
             values (${SHADOW_RUN}, ${SNAPSHOT_COMPANY.entityId}, 'agent:concierge', ${CONCIERGE},
                     'whatsapp_reply', ${REPLY}, 'claude-sonnet-5-5', 3000, 60, 1, 'shadowed', 1200,
                     'e2e-concierge')
             on conflict (id) do nothing`;
    await m`insert into agent_actions (id, entity_id, run_id, agent, action_type, input_json, autonomy,
                                       state, created_by)
             values (${SHADOW_ACTION}, ${SNAPSHOT_COMPANY.entityId}, ${SHADOW_RUN}, 'agent:concierge',
                     ${REPLY},
                     ${m.json({
                       entityId: SNAPSHOT_COMPANY.entityId,
                       threadId: thread.id,
                       accountId: thread.account_id,
                       body: CONCIERGE_JOURNEY.shadowDraft,
                     })},
                     'shadow', 'shadowed', ${CONCIERGE})
             on conflict (id) do nothing`;
  });
}
