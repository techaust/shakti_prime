import { SYSTEM_WORKERS_PRINCIPAL_ID, type LeadDto, type Principal } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, createTestPrincipal, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { anonymiseStaleLeads } from '../../src/commands/crm/anonymise-stale-leads';
import { createLead } from '../../src/commands/crm/create-lead';
import { addNote, updateContact, upsertSite } from '../../src/commands/crm/customer';
import { createTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';

// Nothing of an anonymised person is left anywhere (BLUEPRINT §7.9; the owner's decision of
// 13-10-2026 on the audit trail): a lead made through the real commands, so its audit rows,
// timeline, events and every other row the commands write exist, carries this run's marker in
// every free-text field and its own phone number; once it has aged past the retention period and
// the job has run, no text or json column of any table holds either.

afterAll(closeDb);

const E = 4;
const MARK = `zqxc${Math.random().toString(36).slice(2, 10)}`;
const DIGITS = `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

let person: Principal;
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

beforeAll(async () => {
  person = await createTestPrincipal('general_manager', [E]);
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
          [table === 'contacts' || table === 'contact_phones' || table === 'consents' ? contactId : accountId],
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
