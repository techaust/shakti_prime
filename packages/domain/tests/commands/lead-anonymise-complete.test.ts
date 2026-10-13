import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type LeadDto,
  type Principal,
} from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestUser, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiProvider } from '../../src/ai/provider';
import { runTriage } from '../../src/ai/triage/run-triage';
import { fakeModelTransport, fakeReply } from '../../src/ai/transport';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { anonymiseStaleLeads } from '../../src/commands/crm/anonymise-stale-leads';
import { createLead } from '../../src/commands/crm/create-lead';
import { addNote, updateContact, upsertSite } from '../../src/commands/crm/customer';
import { routeEnquiry } from '../../src/commands/crm/route-enquiry';
import { createTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryKeyValue } from '../../src/ports/key-value';
import { memoryLogger } from '../../src/ports/logger';

// Nothing of an anonymised person is left anywhere (BLUEPRINT §7.9; the owner's decision of
// 13-10-2026 on the audit trail): a lead made through the real commands, so its audit rows,
// timeline, events and every other row the commands write exist, carries this run's marker in
// every free-text field and its own phone number. The Triage agent reads it and proposes with a
// note, and a colleague's walk-in for the same number is refused as the colleague's customer and
// routed to its owner with a note. Once all of it has aged past the retention period and the job
// has run, no text or json column of any table holds the marker or the number.

let triageConfig: string | undefined;
afterAll(async () => {
  if (triageConfig !== undefined) {
    const made = triageConfig;
    await asMigrator((m) => m`delete from agent_configs where id = ${made}`);
  }
  await closeDb();
});

const E = 4;
const MARK = `zqxc${Math.random().toString(36).slice(2, 10)}`;
const DIGITS = `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

let person: Principal;
let colleague: Principal;
let lead: LeadDto;

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

/** The tables whose rows the commands made, each with its moments moved back to 2001. */
const AGED = [
  ['accounts', ['created_at', 'updated_at']],
  ['contacts', ['created_at', 'updated_at']],
  ['contact_phones', ['created_at', 'updated_at']],
  ['consents', ['created_at', 'updated_at', 'given_at']],
  ['customer_sites', ['created_at', 'updated_at']],
  ['account_entities', ['created_at', 'updated_at', 'first_seen_at']],
  ['account_contacts', ['created_at', 'updated_at']],
] as const;

/** The Triage agent's answer for the lead: its pipeline, with the marker in the agent's note. */
const TRIAGE_ANSWER = JSON.stringify({
  pipeline: { key: 'farmer_pumps', note: `${MARK} sounds keen on a pump` },
  score: { change: 2 },
  duplicate: null,
  assignee: null,
});

beforeAll(async () => {
  const owner = await createTestUser([{ entityId: E, roleKey: 'general_manager' }]);
  person = principalFor('general_manager', [E], { id: owner.id });
  const walkIn = await createTestUser([{ entityId: E, roleKey: 'tele_caller_cc' }]);
  colleague = principalFor('tele_caller_cc', [E], { id: walkIn.id });
  lead = await run<LeadDto>(person, createLead, {
    entityId: E,
    pipelineKey: 'farmer_pumps',
    contact: { name: `${MARK} Person`, phone: DIGITS },
    account: { type: 'farm', name: `${MARK} Farm` },
    site: { type: 'borewell', village: `${MARK} Village`, pin: '302001' },
    consent: { channel: 'call', purpose: 'service', source: 'walk_in_form', textVersion: 'v1' },
  });
  const accountId = lead.account.id;
  const contactId = lead.contact?.id ?? '';
  await run(person, updateContact, {
    entityId: E,
    accountId,
    contactId,
    email: `${MARK}@example.in`,
  });
  await run(person, upsertSite, {
    entityId: E,
    accountId,
    type: 'rooftop',
    address: `${MARK} House, near the well`,
    village: `${MARK} Dhani`,
  });
  await run(person, addNote, {
    entityId: E,
    accountId,
    opportunityId: lead.id,
    body: `${MARK} wants a call after the harvest`,
  });
  await run(person, createTask, {
    entityId: E,
    opportunityId: lead.id,
    kind: 'callback',
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    title: `Call ${MARK} back`,
  });

  // The Triage agent reads the lead and proposes, its note carrying the marker.
  triageConfig = newId();
  const config = triageConfig;
  await asMigrator(async (m) => {
    await m`delete from agent_configs where agent = 'agent:triage' and action_type is null
              and entity_id = ${E}`;
    await m`insert into agent_configs (id, agent, action_type, entity_id, autonomy,
                                       daily_spend_cap_paise, enabled, created_by)
            values (${config}, 'agent:triage', null, ${E}, null, 100000, true, ${person.id})`;
  });
  const transport = fakeModelTransport([fakeReply(TRIAGE_ANSWER)]);
  const triaged = await runTriage(
    { eventId: newId(), entityId: E, opportunityId: lead.id, existingCustomer: false },
    {
      provider: createAiProvider({
        claude: transport,
        voyage: undefined,
        keyValue: memoryKeyValue(),
        logger: memoryLogger(),
        sleep: () => Promise.resolve(),
        timeoutMs: 20,
      }),
      logger: memoryLogger(),
    },
  );
  expect(triaged.runs.pipeline?.actionId).toEqual(expect.any(String));

  // A colleague's walk-in for the same number: refused as the colleague's customer, then routed
  // to them with a note, as the walk-in form does (`takeEnquiry`).
  const scope = { entityIds: [E], requestId: newId() };
  await expect(
    executeCommand(colleague, scope, createLead, {
      entityId: E,
      pipelineKey: 'farmer_pumps',
      contact: { name: `${MARK} Walkin`, phone: DIGITS },
      account: { type: 'farm', name: `${MARK} Walkin Farm` },
      site: { type: 'borewell', village: `${MARK} Gaon`, pin: '302001' },
    }),
  ).rejects.toMatchObject({ details: { reason: 'customer_held_by_colleague' } });
  await executeCommand(colleague, scope, routeEnquiry, {
    entityId: E,
    pipelineKey: 'farmer_pumps',
    phone: DIGITS,
    note: `${MARK} came to the shop about a pump`,
  });

  // Thirty months on: every moment of the customer and its lead moved back, the triggers that
  // stamp or guard those moments set aside for the move alone.
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const at = '2001-04-01T00:00:00Z';
      for (const [table, columns] of AGED) {
        await tx.unsafe(`alter table public.${table} disable trigger user`);
        const sets = columns.map((c) => `${c} = '${at}'`).join(', ');
        await tx.unsafe(
          `update public.${table} set ${sets}
            where ${
              table === 'accounts'
                ? 'id'
                : table === 'contacts'
                  ? 'id'
                  : table === 'contact_phones' || table === 'consents'
                    ? 'contact_id'
                    : 'account_id'
            } = $1`,
          [
            table === 'contacts' || table === 'contact_phones' || table === 'consents'
              ? contactId
              : accountId,
          ],
        );
        await tx.unsafe(`alter table public.${table} enable trigger user`);
      }
      await tx`alter table opportunities disable trigger user`;
      await tx`update opportunities set created_at = ${at}, updated_at = ${at}, state_changed_at = ${at}
               where id = ${lead.id}`;
      await tx`alter table opportunities enable trigger user`;
      await tx`alter table tasks disable trigger user`;
      await tx`update tasks set created_at = ${at}, updated_at = ${at}, due_at = ${at}
               where opportunity_id = ${lead.id}`;
      await tx`alter table tasks enable trigger user`;
      await tx`alter table activities disable trigger user`;
      await tx`update activities set created_at = ${at} where account_id = ${accountId}`;
      await tx`alter table activities enable trigger user`;
      await tx`alter table inbox_items disable trigger user`;
      await tx`update inbox_items set created_at = ${at}, updated_at = ${at}
               where subject_id in (${lead.id}, ${accountId})`;
      await tx`alter table inbox_items enable trigger user`;
      await tx`alter table agent_actions disable trigger user`;
      await tx`update agent_actions set created_at = ${at}
               where input_json ->> 'opportunityId' = ${lead.id}`;
      await tx`alter table agent_actions enable trigger user`;
    }),
  );
});

describe('an anonymised customer made through the commands', () => {
  it('leaves the marker and the phone number in no column of any table', async () => {
    const workers = principalFor('system:workers', [E], { id: SYSTEM_WORKERS_PRINCIPAL_ID });
    let anonymised = 0;
    let after: unknown = null;
    do {
      const batch = await run<{ anonymised: number; next: unknown }>(workers, anonymiseStaleLeads, {
        entityId: E,
        after,
      });
      anonymised += batch.anonymised;
      after = batch.next;
    } while (after !== null);
    expect(anonymised).toBeGreaterThanOrEqual(1);
    const [state] = await asMigrator(
      (m) => m<{ anonymised: boolean }[]>`
        select anonymised_at is not null as anonymised from opportunities where id = ${lead.id}`,
    );
    expect(state?.anonymised).toBe(true);

    // Every text, character, json and array column of every table, partitions read through
    // their parents: the audit trail, the outbox and the idempotency keys included.
    const columns = await asMigrator(
      (m) => m<{ table: string; column: string }[]>`
        select c.table_name as table, c.column_name as column
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
         order by 1, 2`,
    );
    expect(columns.length).toBeGreaterThan(100);
    const hits: string[] = [];
    await asMigrator(async (m) => {
      for (const { table, column } of columns) {
        const [row] = await m.unsafe<{ n: number }[]>(
          `select count(*)::int as n from public."${table}"
            where "${column}"::text like '%' || $1 || '%' or "${column}"::text like '%' || $2 || '%'`,
          [MARK, DIGITS],
        );
        if ((row?.n ?? 0) > 0) hits.push(`${table}.${column}`);
      }
    });
    expect(hits).toEqual([]);
  }, 180_000);
});
