// The Caller Co-pilot journey's fixtures (`e2e/copilot.spec.ts`), written by the seed on the host
// after the stand-in agent's settings (the Co-pilot runs in company 1 with its suggestions needing
// approval). Per project, one lead of the tele-caller made afresh on every run, with what the
// Co-pilot would have written by then: a brief two hours old, so a new one may be asked for; an
// answered dial of the lead, not saved yet, and its summary with the facts heard and the outcome
// it suggests; and its two suggestions that need approval, the facts and a follow-up for the
// caller, filed through the real runtime with the fake transport. Nothing reaches a vendor.
import { AGENT_PRINCIPAL_IDS, newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  createAiProvider,
  createLead,
  effectiveDispositions,
  executeCommand,
  executeQuery,
  fakeModelTransport,
  fakeReply,
  memoryKeyValue,
  memoryLogger,
  runAgentStep,
} from '@shakti/domain';
import { COPILOT_JOURNEY, COPILOT_LEADS } from '../copilot-fixtures';
import { PROJECTS } from '../support/users';

const ENTITY = 1;
const HOUR = 3_600_000;
const COPILOT = AGENT_PRINCIPAL_IDS['agent:copilot'];

/** A mobile number no earlier run used. */
function phone(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

/** Tomorrow at 11:00 in India, inside calling hours. */
function tomorrowAtEleven(): string {
  const day = new Date(Date.now() + 5.5 * HOUR + 24 * HOUR).toISOString().slice(0, 10);
  return `${day}T11:00:00+05:30`;
}

/** Files one of the Co-pilot's suggestions about the lead through the runtime. */
async function suggest(
  actionType: string,
  input: Record<string, unknown>,
  leadId: string,
  assigneeId?: string,
): Promise<void> {
  const provider = createAiProvider({
    claude: fakeModelTransport([fakeReply('{}')]),
    voyage: undefined,
    keyValue: memoryKeyValue(),
    logger: memoryLogger(),
  });
  const run = await runAgentStep(
    {
      agent: 'agent:copilot',
      entityId: ENTITY,
      eventId: newId(),
      purpose: 'copilot_call_summary',
      actionType,
      async decide(model) {
        await model.complete({ system: 'Seed', question: 'Seed', maxTokens: 10 });
        return {
          input,
          subjectType: 'opportunity',
          subjectId: leadId,
          ...(assigneeId === undefined ? {} : { assigneeId }),
        };
      },
    },
    { provider, logger: memoryLogger() },
  );
  if (run.outcome !== 'proposed') {
    throw new Error(`the Co-pilot's ${actionType} ended ${run.outcome}, not with a suggestion`);
  }
}

/** Makes each project's Co-pilot lead for the tele-caller `callerId`. */
export async function ensureCopilotJourneys(callerId: string): Promise<void> {
  const caller = principalFor('tele_caller_cc', [ENTITY], { id: callerId });
  for (const project of PROJECTS) {
    const name = COPILOT_LEADS[project];
    // Earlier runs' leads of this name are set aside, so the search finds this run's alone.
    await asMigrator(
      (m) => m`update opportunities o set archived_at = now()
                 from account_contacts ac join contacts c on c.id = ac.contact_id
                where ac.account_id = o.account_id and c.name = ${name}
                  and o.owner_id = ${callerId} and o.archived_at is null`,
    );
    const lead = await executeCommand(caller, { entityIds: [ENTITY] }, createLead, {
      entityId: ENTITY,
      pipelineKey: 'farmer_pumps',
      contact: { name, phone: phone() },
      account: { type: 'farm' },
      site: { type: 'borewell', village: 'Chomu' },
    });
    const outcomes = await executeQuery(
      caller,
      { entityIds: [ENTITY] },
      (ctx) => effectiveDispositions(ctx, ENTITY, 'farmer_pumps'),
      { name: 'e2e.copilot.outcomes' },
    );
    const outcome = outcomes.dispositions.find((d) => d.nextAction === 'callback');
    if (outcome === undefined) throw new Error('company 1 has no call-back outcome');
    const call = newId();
    await asMigrator(async (m) => {
      const [contactPhone] = await m<{ id: string }[]>`
        select cp.id from contact_phones cp
          join account_contacts ac on ac.contact_id = cp.contact_id
         where ac.account_id = ${lead.account.id} limit 1`;
      await m`insert into provider_calls (id, entity_id, opportunity_id, contact_phone_id, caller_id,
                                          direction, series, purpose, status, started_at, answered_at,
                                          ended_at, duration_s)
               values (${call}, ${ENTITY}, ${lead.id}, ${contactPhone?.id ?? null}, ${callerId},
                       'outbound', '140', 'promotional', 'completed', now() - interval '6 minutes',
                       now() - interval '5 minutes', now() - interval '1 minute', 240)`;
      await m`insert into copilot_notes (id, entity_id, opportunity_id, kind, body, created_at, created_by)
               values (${newId()}, ${ENTITY}, ${lead.id}, 'brief', ${COPILOT_JOURNEY.brief},
                       now() - interval '2 hours', ${COPILOT})`;
      await m`insert into copilot_notes (id, entity_id, opportunity_id, provider_call_id, kind, body,
                                         fields_json, suggested_disposition_id, created_by)
               values (${newId()}, ${ENTITY}, ${lead.id}, ${call}, 'call_summary', ${COPILOT_JOURNEY.summary},
                       ${JSON.stringify(COPILOT_JOURNEY.facts)}::jsonb, ${outcome.id}, ${COPILOT})`;
    });
    await suggest(
      'crm.lead.qualification.set',
      { entityId: ENTITY, opportunityId: lead.id, facts: COPILOT_JOURNEY.facts },
      lead.id,
      callerId,
    );
    await suggest(
      'crm.task.create',
      {
        entityId: ENTITY,
        opportunityId: lead.id,
        kind: 'follow_up',
        dueAt: tomorrowAtEleven(),
        title: COPILOT_JOURNEY.followUp,
      },
      lead.id,
      callerId,
    );
  }
}
