// The Triage agent's journey (`e2e/triage.spec.ts`), written by the seed on the host. A lead of
// the snapshot company, made once by the Executive, is triaged by the real agent runtime through
// the fake transport, which answers as a model would: the lead's pipeline, a small raise of its
// score, and the snapshot caller to take it. The agent starts in Shadow, so the proposals are
// recorded and nothing acts. The run's spending limit is set only while it runs, so leads the
// journeys make later are not triaged with the fake transport's empty answer.
import type { Principal } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  agentPrincipal,
  createAiProvider,
  createLead,
  executeCommand,
  executeQuery,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
  readTriageFacts,
  runTriage,
} from '@shakti/domain';
import { SNAPSHOT_COMPANY } from '../support/users';
import { TRIAGE_JOURNEY } from './triage-journey';

const E = SNAPSHOT_COMPANY.entityId;

/** The journey's lead, made once and found again by its customer's name. */
async function triageLead(executive: Principal): Promise<string> {
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select o.id from opportunities o
        join account_contacts ac on ac.account_id = o.account_id
        join contacts c on c.id = ac.contact_id
       where o.entity_id = ${E} and c.name = ${TRIAGE_JOURNEY.customer}
       order by o.created_at limit 1`,
  );
  if (found) return found.id;
  const lead = await executeCommand(executive, { entityIds: [E] }, createLead, {
    entityId: E,
    pipelineKey: 'farmer_pumps',
    contact: { name: TRIAGE_JOURNEY.customer, phone: TRIAGE_JOURNEY.phone },
    account: { type: 'farm' },
    sourceCode: 'walk_in',
  });
  return lead.id;
}

export async function ensureTriageJourney(
  executiveId: string,
  snapshotCallerId: string,
): Promise<string> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  const lead = await triageLead(executive);
  const facts = await executeQuery(
    agentPrincipal('agent:triage', E),
    { entityIds: [E] },
    ({ tx }) =>
      readTriageFacts(
        tx,
        { entityId: E, opportunityId: lead, existingCustomer: false },
        new Date(),
      ),
    { name: 'e2e.triage.facts' },
  );
  const person = facts?.people.find((p) => p.personId === snapshotCallerId)?.label ?? 'P1';
  const answer = JSON.stringify({
    pipeline: { key: 'farmer_pumps' },
    score: { change: 5, note: TRIAGE_JOURNEY.scoreNote },
    duplicate: null,
    assignee: { person },
  });
  await asMigrator(
    (
      m,
    ) => m`insert into agent_configs (id, agent, action_type, entity_id, daily_spend_cap_paise, created_by)
             values (${TRIAGE_JOURNEY.capId}, 'agent:triage', null, ${E}, 100000, ${executiveId})
             on conflict (agent, action_type, entity_id) do update set daily_spend_cap_paise = 100000`,
  );
  try {
    const logger = memoryLogger();
    await runTriage(
      {
        eventId: TRIAGE_JOURNEY.eventId,
        entityId: E,
        opportunityId: lead,
        existingCustomer: false,
      },
      {
        provider: createAiProvider({
          claude: fakeModelTransport([fakeReply(answer, { inputTokens: 1_800 })]),
          voyage: undefined,
          keyValue: memoryKeyValue(),
          logger,
        }),
        logger,
      },
    );
  } finally {
    await asMigrator(
      (m) => m`delete from agent_configs
                where agent = 'agent:triage' and action_type is null and entity_id = ${E}`,
    );
  }
  return lead;
}
