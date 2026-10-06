import { newId, SYSTEM_WORKERS_PRINCIPAL_ID, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
  stageId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { recordConsent } from '../../src/commands/crm/consent';
import { createLead } from '../../src/commands/crm/create-lead';
import { upsertSite } from '../../src/commands/crm/customer';
import {
  dismissDuplicate,
  scanDuplicates,
  suggestDuplicate,
} from '../../src/commands/crm/duplicates';
import { mergeCustomers, mergeLeads, unmergeCustomers } from '../../src/commands/crm/merges';
import { createTask } from '../../src/commands/crm/tasks';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';
import { matchText } from '../../src/crm/duplicate-confidence';
import { listAccountDuplicates, listDuplicates } from '../../src/queries/crm/duplicates';

// Duplicates (PRD CRM-03, docs/design/phase1.md §7.4): the cards lead creation and the nightly
// search record, repeat enquiries attached to the open lead, and the customer and lead merges, with
// their undo, each refused to a role without crm.lead.merge, outside the request's companies, to
// an agent, and across a colleague's customer. The suites never clean the CRM tables, so every
// customer here has a number and a name of this run only.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

const RUN = newId().slice(-6);

let teamA: string;
let teamB: string;
let callerA: Principal;
let leadA: Principal;
let leadB: Principal;
let gm2: Principal;

beforeAll(async () => {
  teamA = await createTestTeam(1, 'duplicates team A');
  teamB = await createTestTeam(1, 'duplicates team B');
  callerA = await createTestPrincipal('tele_caller_cc', [1], { teamId: teamA });
  leadA = await createTestPrincipal('sales_team_lead', [1], { teamId: teamA });
  leadB = await createTestPrincipal('sales_team_lead', [1], { teamId: teamB });
  gm2 = await createTestPrincipal('general_manager', [2]);
});

function run<T = unknown>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
  sinks: { outbox?: typeof outbox; audit?: typeof audit } = {},
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(
      command,
      { context, audit: sinks.audit ?? audit, outbox: sinks.outbox ?? outbox },
      input,
    ),
  ) as Promise<T>;
}

function refusal(work: Promise<unknown>): Promise<unknown> {
  return work.then(
    () => undefined,
    (e: unknown) => e,
  );
}

const reason = (r: string) => ({ details: { reason: r } });

let numbers = 0;
/** A mobile number of this run only, as a caller types it. */
function phone(): string {
  numbers += 1;
  return `93${RUN.replace(/[^0-9]/g, '7')
    .padEnd(6, '7')
    .slice(0, 6)}${String(numbers).padStart(2, '0')}`;
}

interface Lead {
  id: string;
  outcome: 'created' | 'attached';
  account: { id: string };
  contact: { id: string } | null;
}

function newLead(
  principal: Principal,
  args: { name: string; phone: string; pipelineKey?: string; village?: string },
  sinks: { outbox?: typeof outbox; audit?: typeof audit } = {},
): Promise<Lead> {
  return run<Lead>(
    principal,
    createLead,
    {
      entityId: 1,
      pipelineKey: args.pipelineKey ?? 'farmer_pumps',
      contact: { name: args.name, phone: args.phone },
      account: { type: 'farm' },
      ...(args.village === undefined ? {} : { site: { type: 'borewell', village: args.village } }),
    },
    sinks,
  );
}

interface CandidateRow {
  id: string;
  kind: string;
  account_id: string | null;
  other_account_id: string | null;
  opportunity_id: string | null;
  other_opportunity_id: string | null;
  reason: string;
  confidence: number;
  state: string;
  decided_by: string | null;
  signals_json: string[];
}

async function candidatesOf(id: string): Promise<CandidateRow[]> {
  return asMigrator(
    (m) => m<CandidateRow[]>`
      select id, kind, account_id, other_account_id, opportunity_id, other_opportunity_id, reason,
             confidence, state, decided_by, signals_json
        from duplicate_candidates
       where ${id} in (account_id, other_account_id, opportunity_id, other_opportunity_id)
       order by created_at`,
  );
}

/** A customer of company 1 written past the policies, as an import commits one. */
async function importedCustomer(args: {
  name: string;
  phone?: string;
  village?: string;
  owner: Principal;
  team: string;
  lead?: { stage?: string; activityDaysAgo?: number };
}): Promise<{ accountId: string; contactId: string; leadId: string | null }> {
  const accountId = newId();
  const contactId = newId();
  const leadId = args.lead === undefined ? null : newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, created_by)
        values (${accountId}, 'farm', ${args.name}, ${args.owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${accountId}, 1, ${args.owner.id}, ${args.team}, ${args.owner.id})`;
      await tx`insert into contacts (id, name, created_by) values (${contactId}, ${args.name}, ${args.owner.id})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${accountId}, ${contactId}, 'owner', ${args.owner.id})`;
      if (args.phone !== undefined) {
        await tx`insert into contact_phones (id, contact_id, e164, is_primary, created_by)
          values (${newId()}, ${contactId}, ${`+91${args.phone}`}, true, ${args.owner.id})`;
      }
      if (args.village !== undefined) {
        await tx`insert into customer_sites (id, account_id, type, village, created_by)
          values (${newId()}, ${accountId}, 'borewell', ${args.village}, ${args.owner.id})`;
      }
      if (leadId !== null) {
        await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          select ${leadId}, 1, ${accountId}, p.id, ${stageId(1, 1)}, ${args.owner.id}, ${args.team}, ${args.owner.id}
            from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
        if (args.lead?.activityDaysAgo !== undefined) {
          await tx`insert into activities (id, entity_id, opportunity_id, account_id, type, actor_principal_id, created_at)
            values (${newId()}, 1, ${leadId}, ${accountId}, 'lead_created', ${args.owner.id},
                    now() - make_interval(days => ${args.lead.activityDaysAgo}))`;
        }
      }
    }),
  );
  return { accountId, contactId, leadId };
}

describe('crm.lead.create puts duplicates forward and attaches repeat enquiries (CRM-03)', () => {
  it('records a customer the lead form makes beside one the caller has, by its number', async () => {
    const number = phone();
    const first = await newLead(callerA, {
      name: `Ram ${RUN}`,
      phone: number,
      village: `Kheda ${RUN}`,
    });
    const emitted = memoryOutboxSink();
    // Another segment, so the enquiry is not a repeat of the open lead.
    const second = await newLead(
      callerA,
      { name: `ram  ${RUN}`, phone: number, pipelineKey: 'residential_rooftop' },
      { outbox: emitted },
    );
    expect(second.outcome).toBe('created');
    expect(second.account.id).not.toBe(first.account.id);
    const [candidate] = await candidatesOf(second.account.id);
    const [low, high] = [first.account.id, second.account.id].sort();
    expect(candidate).toMatchObject({
      kind: 'customer',
      account_id: low,
      other_account_id: high,
      reason: 'phone',
      confidence: 95,
      state: 'open',
      signals_json: ['same_phone', 'same_name'],
    });
    expect(emitted.records.map((r) => r.type)).toEqual(['crm.lead.created', 'crm.duplicate.found']);
    expect(emitted.records[1]).toMatchObject({
      aggregateId: candidate?.id,
      payload: { kind: 'customer', reason: 'phone', confidence: 95 },
    });
  });

  it('attaches a repeat enquiry for the same segment to the open lead instead of a second lead', async () => {
    const number = phone();
    const first = await newLead(callerA, { name: `Sita Devi ${RUN}`, phone: number });
    const emitted = memoryOutboxSink();
    const recorded = memoryAuditSink();
    // The same name, whatever its case and spacing (DECISIONS 06-10-2026).
    const again = await newLead(
      callerA,
      { name: `SITA  devi ${RUN}`, phone: number },
      { outbox: emitted, audit: recorded },
    );
    expect(again).toMatchObject({
      id: first.id,
      outcome: 'attached',
      account: { id: first.account.id },
    });
    const counts = await asMigrator(
      (m) => m<{ leads: number; accounts: number; enquiries: number }[]>`
        select (select count(*)::int from opportunities where account_id = ${first.account.id}) as leads,
               (select count(*)::int from contact_phones where e164 = ${`+91${number}`}) as accounts,
               (select count(*)::int from activities
                 where opportunity_id = ${first.id} and type = 'enquiry_repeated') as enquiries`,
    );
    expect(counts[0]).toEqual({ leads: 1, accounts: 1, enquiries: 1 });
    expect(emitted.records.map((r) => r.type)).toEqual(['crm.lead.attached']);
    expect(recorded.records.find((r) => r.outcome === 'ok')).toMatchObject({
      aggregateId: first.id,
      after: { attached: true },
    });
  });

  it('makes a new customer and a card for a known number typed with another name (DECISIONS 06-10-2026)', async () => {
    const number = phone();
    const first = await newLead(callerA, { name: `Radha ${RUN}`, phone: number });
    const other = await newLead(callerA, { name: `Mohini ${RUN}`, phone: number });
    expect(other.outcome).toBe('created');
    expect(other.account.id).not.toBe(first.account.id);
    const [low, high] = [first.account.id, other.account.id].sort();
    expect(await candidatesOf(other.account.id)).toEqual([
      expect.objectContaining({
        kind: 'customer',
        account_id: low,
        other_account_id: high,
        reason: 'phone',
        confidence: 70,
        signals_json: ['same_phone'],
        state: 'open',
      }),
    ]);
  });

  it('joins a lead in nurture, by number or as a known customer, and puts it back in its queue (DECISIONS 06-10-2026)', async () => {
    const number = phone();
    const nurtured = await importedCustomer({
      name: `Uma ${RUN}`,
      phone: number,
      owner: callerA,
      team: teamA,
      lead: { activityDaysAgo: 200 },
    });
    const toNurture = (id: string | null) =>
      asMigrator(
        (
          m,
        ) => m`update opportunities set state = 'nurture', state_changed_at = now() - interval '150 days'
          where id = ${id ?? ''}`,
      );
    await toNurture(nurtured.leadId);
    const emitted = memoryOutboxSink();
    const byNumber = await newLead(
      callerA,
      { name: `uma ${RUN}`, phone: number },
      { outbox: emitted },
    );
    expect(byNumber).toMatchObject({ id: nurtured.leadId, outcome: 'attached' });
    expect(emitted.records.map((r) => r.type).sort()).toEqual([
      'crm.lead.attached',
      'crm.opportunity.reopened',
    ]);
    const [row] = await asMigrator(
      (m) => m<{ state: string; owner: string; reopened: number; enquiries: number }[]>`
        select o.state, o.owner_id::text as owner,
               (select count(*)::int from activities
                 where opportunity_id = o.id and type = 'reopened') as reopened,
               (select count(*)::int from activities
                 where opportunity_id = o.id and type = 'enquiry_repeated') as enquiries
          from opportunities o where o.id = ${nurtured.leadId ?? ''}`,
    );
    expect(row).toEqual({ state: 'open', owner: callerA.id, reopened: 1, enquiries: 1 });

    await toNurture(nurtured.leadId);
    const known = await run<Lead>(callerA, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: nurtured.accountId,
    });
    expect(known).toMatchObject({ id: nurtured.leadId, outcome: 'attached', state: 'open' });
  });

  it('attaches a repeat enquiry for a known customer, and still refuses a referral code no partner has', async () => {
    const first = await newLead(callerA, { name: `Gita ${RUN}`, phone: phone() });
    const known = { entityId: 1, pipelineKey: 'farmer_pumps', existingAccountId: first.account.id };
    expect(
      await refusal(run(callerA, createLead, { ...known, referralCode: 'NOSUCHCODE' })),
    ).toMatchObject(reason('referral_code_unknown'));
    const again = await run<Lead>(callerA, createLead, known);
    expect(again).toMatchObject({ id: first.id, outcome: 'attached' });
  });

  it('makes a new lead and a lead card when the open lead had no activity for 30 days', async () => {
    const owner = await importedCustomer({
      name: `Hari ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
      lead: { activityDaysAgo: 31 },
    });
    const lead = await run<Lead>(callerA, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: owner.accountId,
    });
    expect(lead.outcome).toBe('created');
    expect(lead.id).not.toBe(owner.leadId);
    const [candidate] = await candidatesOf(lead.id);
    const [low, high] = [owner.leadId ?? '', lead.id].sort();
    expect(candidate).toMatchObject({
      kind: 'lead',
      opportunity_id: low,
      other_opportunity_id: high,
      reason: 'phone',
      confidence: 95,
      signals_json: ['same_customer', 'same_phone'],
    });
  });
});

describe('crm.customer.merge and crm.customer.unmerge', () => {
  async function pair(owner: Principal = callerA) {
    const number = phone();
    // A name and village of this pair only, so the card names the two of them.
    const name = `Mohan ${RUN} ${number.slice(-2)}`;
    const village = `Pali ${RUN} ${number.slice(-2)}`;
    const kept = await newLead(owner, { name, phone: number, village });
    const merged = await newLead(owner, {
      name,
      phone: number,
      pipelineKey: 'residential_rooftop',
      village,
    });
    const [candidate] = await candidatesOf(merged.account.id);
    if (candidate === undefined) throw new Error('no candidate');
    return { kept, merged, candidate };
  }

  it('is refused without crm.lead.merge, outside the request, to an agent and across a colleague', async () => {
    const { kept, merged, candidate } = await pair();
    const input = {
      entityId: 1,
      keptAccountId: kept.account.id,
      mergedAccountId: merged.account.id,
      candidateId: candidate.id,
    };
    expect(await refusal(run(callerA, mergeCustomers, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(gm2, mergeCustomers, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(leadA, mergeCustomers, { ...input, entityId: 2 }))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(run(principalFor('agent:triage', [1]), mergeCustomers, input)),
    ).toMatchObject({ code: 'forbidden', ...reason('people_only') });
    // Team B's lead may not change team A's customers, nor see their card.
    expect(
      await refusal(run(leadB, mergeCustomers, { ...input, candidateId: undefined })),
    ).toMatchObject({ code: 'conflict', ...reason('customer_held_by_colleague') });
    expect(await refusal(run(leadB, mergeCustomers, input))).toMatchObject(
      reason('duplicate_missing'),
    );
    expect((await candidatesOf(merged.account.id))[0]?.state).toBe('open');
  });

  it('moves everything to the kept customer, archives the other and undoes it all', async () => {
    const { kept, merged, candidate } = await pair();
    await run(callerA, createTask, {
      entityId: 1,
      opportunityId: merged.id,
      kind: 'callback',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const done = await run<{
      id: string;
      moved: Record<string, number>;
      undoneAt: string | null;
    }>(leadA, mergeCustomers, {
      entityId: 1,
      keptAccountId: kept.account.id,
      mergedAccountId: merged.account.id,
      candidateId: candidate.id,
    });
    expect(done.moved).toMatchObject({
      contacts: 1,
      sites: 1,
      relationships: 0,
      leads: 1,
      tasks: 1,
    });
    expect(done.moved.activities).toBeGreaterThanOrEqual(2);
    const after = await asMigrator(
      (m) => m<
        {
          archived: boolean;
          leadAccount: string;
          taskAccount: string;
          role: string;
          rows: number;
          merge: number;
        }[]
      >`
        select (select archived_at is not null from accounts where id = ${merged.account.id}) as archived,
               (select account_id::text from opportunities where id = ${merged.id}) as "leadAccount",
               (select account_id::text from tasks where opportunity_id = ${merged.id} limit 1) as "taskAccount",
               (select role from account_contacts
                 where contact_id = ${merged.contact?.id ?? ''}) as role,
               (select count(*)::int from activities where account_id = ${merged.account.id}) as rows,
               (select count(*)::int from customer_merges
                 where id = ${done.id} and undone_at is null) as merge`,
    );
    expect(after[0]).toEqual({
      archived: true,
      leadAccount: kept.account.id,
      taskAccount: kept.account.id,
      role: 'other',
      rows: 0,
      merge: 1,
    });
    expect((await candidatesOf(merged.account.id))[0]).toMatchObject({
      state: 'merged',
      decided_by: leadA.id,
    });
    const cards = await asPrincipal(leadA, (context) =>
      listAccountDuplicates(context, { entityId: 1, accountId: kept.account.id }),
    );
    expect(cards.merges).toEqual([
      expect.objectContaining({ id: done.id, mergedAccountId: merged.account.id }),
    ]);
    expect(cards.candidates.map((c) => c.id)).not.toContain(candidate.id);

    const undone = await run<{ undoneAt: string | null; moved: Record<string, number> }>(
      leadA,
      unmergeCustomers,
      { entityId: 1, mergeId: done.id },
    );
    expect(undone.undoneAt).not.toBeNull();
    // Nothing changed since the merge, so everything it moved came back.
    expect(undone.moved).toEqual(done.moved);
    const back = await asMigrator(
      (m) => m<
        {
          archived: boolean;
          leadAccount: string;
          taskAccount: string;
          role: string;
          sites: number;
          rows: number;
        }[]
      >`
        select (select archived_at is not null from accounts where id = ${merged.account.id}) as archived,
               (select account_id::text from opportunities where id = ${merged.id}) as "leadAccount",
               (select account_id::text from tasks where opportunity_id = ${merged.id} limit 1) as "taskAccount",
               (select role from account_contacts
                 where contact_id = ${merged.contact?.id ?? ''}) as role,
               (select count(*)::int from customer_sites where account_id = ${merged.account.id}) as sites,
               (select count(*)::int from activities where account_id = ${merged.account.id}) as rows`,
    );
    expect(back[0]).toEqual({
      archived: false,
      leadAccount: merged.account.id,
      taskAccount: merged.account.id,
      role: 'owner',
      sites: 1,
      rows: done.moved.activities,
    });
    expect((await candidatesOf(merged.account.id))[0]).toMatchObject({
      state: 'open',
      decided_by: null,
    });
    expect(
      await refusal(run(leadA, unmergeCustomers, { entityId: 1, mergeId: done.id })),
    ).toMatchObject({ code: 'conflict', ...reason('merge_undone_already') });
  });

  it('counts only what came back when a row changed since the merge', async () => {
    const { kept, merged } = await pair();
    const elsewhere = await importedCustomer({
      name: `Elsewhere ${RUN}`,
      owner: callerA,
      team: teamA,
    });
    // A second site of the merged customer, which no lead names.
    const spare = newId();
    await asMigrator(
      (m) => m`insert into customer_sites (id, account_id, type, village, created_by)
        values (${spare}, ${merged.account.id}, 'borewell', ${`Spare ${RUN}`}, ${callerA.id})`,
    );
    const done = await run<{ id: string; moved: Record<string, number> }>(leadA, mergeCustomers, {
      entityId: 1,
      keptAccountId: kept.account.id,
      mergedAccountId: merged.account.id,
    });
    expect(done.moved.sites).toBe(2);
    // The spare site is put on a third customer before the undo, so it stays there.
    await asMigrator(
      (m) => m`update customer_sites set account_id = ${elsewhere.accountId} where id = ${spare}`,
    );
    const undone = await run<{ moved: Record<string, number> }>(leadA, unmergeCustomers, {
      entityId: 1,
      mergeId: done.id,
    });
    expect(undone.moved).toEqual({ ...done.moved, sites: 1 });
  });

  it('refuses to undo a merge while the kept customer is merged into another, until that is undone', async () => {
    const make = (n: string) =>
      importedCustomer({
        name: `Chain ${n} ${RUN}`,
        village: `Chain ${RUN}`,
        owner: callerA,
        team: teamA,
      });
    const [a, b, c] = [await make('a'), await make('b'), await make('c')];
    const merge = (keptAccountId: string, mergedAccountId: string) =>
      run<{ id: string }>(leadA, mergeCustomers, { entityId: 1, keptAccountId, mergedAccountId });
    const aIntoB = await merge(b.accountId, a.accountId);
    const bIntoC = await merge(c.accountId, b.accountId);
    expect(
      await refusal(run(leadA, unmergeCustomers, { entityId: 1, mergeId: aIntoB.id })),
    ).toMatchObject({ code: 'conflict', ...reason('merge_undo_later_first') });
    await run(leadA, unmergeCustomers, { entityId: 1, mergeId: bIntoC.id });
    await run(leadA, unmergeCustomers, { entityId: 1, mergeId: aIntoB.id });
    const [row] = await asMigrator(
      (m) => m<{ live: number; sites: number }[]>`
        select (select count(*)::int from accounts
                 where id in (${a.accountId}, ${b.accountId}, ${c.accountId})
                   and archived_at is null) as live,
               (select count(*)::int from customer_sites where account_id = ${a.accountId}) as sites`,
    );
    expect(row).toEqual({ live: 3, sites: 1 });
  });

  it('asks for every company a customer is with, and says so to a GM of one company', async () => {
    const { kept, merged } = await pair();
    // The kept customer also buys from company 2, through a colleague there.
    await asMigrator(
      (m) => m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
        values (${newId()}, ${kept.account.id}, 2, ${gm2.id}, ${gm2.id})`,
    );
    const input = {
      entityId: 1,
      keptAccountId: kept.account.id,
      mergedAccountId: merged.account.id,
    };
    const gm1 = await createTestPrincipal('general_manager', [1]);
    expect(await refusal(run(gm1, mergeCustomers, input))).toMatchObject({
      code: 'conflict',
      ...reason('merge_other_company'),
    });
    const exec = await createTestPrincipal('executive', [1, 2]);
    const done = await run<{ id: string }>(exec, mergeCustomers, input);
    expect(
      await refusal(run(gm1, unmergeCustomers, { entityId: 1, mergeId: done.id })),
    ).toMatchObject(reason('merge_other_company'));
    const undone = await run<{ undoneAt: string | null }>(exec, unmergeCustomers, {
      entityId: 1,
      mergeId: done.id,
    });
    expect(undone.undoneAt).not.toBeNull();
  });

  it('never merges a referral partner away', async () => {
    const { kept, merged } = await pair();
    await asMigrator(
      (m) => m`insert into referral_partners (account_id, code, created_by)
        values (${merged.account.id}, ${`DUP${RUN}`.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}, ${callerA.id})`,
    );
    expect(
      await refusal(
        run(leadA, mergeCustomers, {
          entityId: 1,
          keptAccountId: kept.account.id,
          mergedAccountId: merged.account.id,
        }),
      ),
    ).toMatchObject(reason('merge_partner_account'));
  });
});

describe('crm.lead.merge', () => {
  async function twoLeads() {
    const owner = await importedCustomer({
      name: `Leela ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
      lead: { activityDaysAgo: 45 },
    });
    const second = await run<Lead>(callerA, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: owner.accountId,
    });
    const [candidate] = await candidatesOf(second.id);
    if (candidate === undefined || owner.leadId === null) throw new Error('no candidate');
    return { kept: second.id, merged: owner.leadId, candidate };
  }

  it('is refused without crm.lead.merge, outside the request and to an agent', async () => {
    const { kept, merged } = await twoLeads();
    const input = { entityId: 1, keptOpportunityId: kept, mergedOpportunityId: merged };
    expect(await refusal(run(callerA, mergeLeads, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(gm2, mergeLeads, input))).toMatchObject({ code: 'forbidden' });
    expect(await refusal(run(principalFor('agent:triage', [1]), mergeLeads, input))).toMatchObject(
      reason('people_only'),
    );
    expect(await refusal(run(leadB, mergeLeads, input))).toMatchObject(
      reason('customer_held_by_colleague'),
    );
  });

  it('moves the open tasks to the kept lead and closes the other', async () => {
    const { kept, merged, candidate } = await twoLeads();
    await run(callerA, createTask, {
      entityId: 1,
      opportunityId: merged,
      kind: 'follow_up',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const done = await run<{ moved: { tasks: number } }>(leadA, mergeLeads, {
      entityId: 1,
      keptOpportunityId: kept,
      mergedOpportunityId: merged,
      candidateId: candidate.id,
    });
    expect(done.moved.tasks).toBe(1);
    const [row] = await asMigrator(
      (m) => m<{ archived: boolean; tasks: number; merged: number }[]>`
        select (select archived_at is not null from opportunities where id = ${merged}) as archived,
               (select count(*)::int from tasks where opportunity_id = ${kept}) as tasks,
               (select count(*)::int from activities
                 where opportunity_id = ${kept} and type = 'leads_merged') as merged`,
    );
    expect(row).toEqual({ archived: true, tasks: 1, merged: 1 });
    expect((await candidatesOf(kept))[0]?.state).toBe('merged');
  });

  it('gives the kept lead the merged lead’s referral partner, and refuses two partners', async () => {
    const partner = async (name: string, prefix: string) => {
      const account = await importedCustomer({
        name: `${name} ${RUN}`,
        owner: callerA,
        team: teamA,
      });
      const code = `${prefix}${RUN}`.toUpperCase().replace(/[^A-Z0-9]/g, 'X');
      await asMigrator(
        (m) => m`insert into referral_partners (account_id, code, created_by)
          values (${account.accountId}, ${code}, ${callerA.id})`,
      );
      return account.accountId;
    };
    const credit = (lead: string, partnerId: string) =>
      asMigrator(
        (m) => m`update opportunities set referral_partner_id = ${partnerId} where id = ${lead}`,
      );
    const first = await twoLeads();
    const p1 = await partner('Partner one', 'PA');
    await credit(first.merged, p1);
    const recorded = memoryAuditSink();
    const done = await run<{ referralPartnerId: string | null }>(
      leadA,
      mergeLeads,
      { entityId: 1, keptOpportunityId: first.kept, mergedOpportunityId: first.merged },
      { audit: recorded },
    );
    expect(done.referralPartnerId).toBe(p1);
    expect(recorded.records.find((r) => r.aggregateId === first.kept)).toMatchObject({
      after: { referralPartnerId: p1 },
    });
    const [kept] = await asMigrator(
      (m) => m<{ partner: string }[]>`
        select referral_partner_id::text as partner from opportunities where id = ${first.kept}`,
    );
    expect(kept?.partner).toBe(p1);

    const second = await twoLeads();
    await credit(second.merged, p1);
    await credit(second.kept, await partner('Partner two', 'PB'));
    expect(
      await refusal(
        run(leadA, mergeLeads, {
          entityId: 1,
          keptOpportunityId: second.kept,
          mergedOpportunityId: second.merged,
        }),
      ),
    ).toMatchObject({ code: 'conflict', ...reason('merge_leads_two_partners') });
  });

  it('refuses two leads of one customer for two kinds of work', async () => {
    const number = phone();
    const pump = await newLead(callerA, { name: `Kiran ${RUN}`, phone: number });
    const roof = await run<Lead>(callerA, createLead, {
      entityId: 1,
      pipelineKey: 'residential_rooftop',
      existingAccountId: pump.account.id,
    });
    expect(roof.outcome).toBe('created');
    expect(
      await refusal(
        run(leadA, mergeLeads, {
          entityId: 1,
          keptOpportunityId: pump.id,
          mergedOpportunityId: roof.id,
        }),
      ),
    ).toMatchObject(reason('merge_leads_other_segment'));
  });

  it('pairs an open lead with a lead in nurture the caller cannot work, and keeps the open one', async () => {
    const owner = await importedCustomer({
      name: `Meera ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
    });
    // The customer is caller A's; its lead in nurture was handed to team B.
    const nurtured = newId();
    await asMigrator(
      (m) => m`insert into opportunities
          (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, state, created_by)
        select ${nurtured}, 1, ${owner.accountId}, p.id, ${stageId(1, 1)}, ${leadB.id}, ${teamB},
               'nurture', ${leadB.id}
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`,
    );
    const enquiry = await run<Lead>(callerA, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: owner.accountId,
    });
    expect(enquiry.outcome).toBe('created');
    expect(enquiry.id).not.toBe(nurtured);
    const [low, high] = [nurtured, enquiry.id].sort();
    const [candidate] = await candidatesOf(enquiry.id);
    expect(candidate).toMatchObject({
      kind: 'lead',
      opportunity_id: low,
      other_opportunity_id: high,
      state: 'open',
      signals_json: ['same_customer', 'same_phone'],
    });

    const gm1 = await createTestPrincipal('general_manager', [1]);
    expect(
      await refusal(
        run(gm1, mergeLeads, {
          entityId: 1,
          keptOpportunityId: nurtured,
          mergedOpportunityId: enquiry.id,
          candidateId: candidate?.id,
        }),
      ),
    ).toMatchObject({ code: 'validation_failed', ...reason('merge_leads_keep_open') });
    expect((await candidatesOf(enquiry.id))[0]?.state).toBe('open');
    await run(gm1, mergeLeads, {
      entityId: 1,
      keptOpportunityId: enquiry.id,
      mergedOpportunityId: nurtured,
      candidateId: candidate?.id,
    });
    const [row] = await asMigrator(
      (m) => m<{ archived: boolean; state: string }[]>`
        select (select archived_at is not null from opportunities where id = ${nurtured}) as archived,
               (select state from opportunities where id = ${enquiry.id}) as state`,
    );
    expect(row).toEqual({ archived: true, state: 'open' });
    expect((await candidatesOf(enquiry.id))[0]?.state).toBe('merged');
  });

  it('never pairs two leads in nurture', async () => {
    const owner = await importedCustomer({
      name: `Nanda ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
      lead: {},
    });
    const second = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`update opportunities set state = 'nurture' where id = ${owner.leadId ?? ''}`;
        await tx`insert into opportunities
            (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, state, created_by)
          select ${second}, 1, ${owner.accountId}, p.id, ${stageId(1, 1)}, ${callerA.id}, ${teamA},
                 'nurture', ${callerA.id}
            from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`;
      }),
    );
    // Caller A works both leads, so only the pair's states can refuse it.
    const [low, high] = [owner.leadId ?? '', second].sort();
    const written = await asPrincipal(callerA, ({ tx }) =>
      tx.execute(sql`
        select * from app.record_duplicates(1::smallint, ${JSON.stringify([
          {
            kind: 'lead',
            firstId: low,
            secondId: high,
            reason: 'phone',
            confidence: 95,
            signals: [],
          },
        ])}::jsonb)`),
    );
    expect(written.length).toBe(0);
    expect(await candidatesOf(second)).toEqual([]);
  });

  it('asks for the customers to be merged first when the leads are of two customers', async () => {
    const a = await newLead(callerA, { name: `Arjun ${RUN}`, phone: phone() });
    const b = await newLead(callerA, { name: `Bhim ${RUN}`, phone: phone() });
    expect(
      await refusal(
        run(leadA, mergeLeads, { entityId: 1, keptOpportunityId: a.id, mergedOpportunityId: b.id }),
      ),
    ).toMatchObject(reason('merge_customers_first'));
  });
});

describe('crm.duplicate.dismiss and crm.duplicate.suggest', () => {
  it('dismisses a card for good, for a person with crm.lead.merge in the company', async () => {
    const number = phone();
    await newLead(callerA, { name: `Kamla ${RUN}`, phone: number });
    const other = await newLead(callerA, {
      name: `Kamla ${RUN}`,
      phone: number,
      pipelineKey: 'residential_rooftop',
    });
    const [candidate] = await candidatesOf(other.account.id);
    const input = { entityId: 1, candidateId: candidate?.id };
    expect(await refusal(run(callerA, dismissDuplicate, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(gm2, dismissDuplicate, input))).toMatchObject({ code: 'forbidden' });
    expect(await run(leadA, dismissDuplicate, input)).toMatchObject({ state: 'dismissed' });
    expect(await refusal(run(leadA, dismissDuplicate, input))).toMatchObject(
      reason('duplicate_candidate_transition_not_allowed'),
    );
  });

  it('lets the Triage agent suggest two open leads of one customer, and nothing else', async () => {
    const triageSeed = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    if (triageSeed === undefined) throw new Error('no triage agent');
    const triage = principalFor('agent:triage', [1], { id: triageSeed.id });
    const owner = await importedCustomer({
      name: `Lakshmi ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
      lead: {},
    });
    const second = await importedCustomer({
      name: `Parvati ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
      lead: {},
    });
    const extra = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        select ${extra}, 1, ${owner.accountId}, p.id, ${stageId(1, 1)}, ${callerA.id}, ${teamA}, ${callerA.id}
          from pipelines p where p.key = 'farmer_pumps' and p.entity_id is null`,
    );
    const input = { entityId: 1, opportunityId: owner.leadId, otherOpportunityId: extra };
    expect(await refusal(run(callerA, suggestDuplicate, input))).toMatchObject({
      code: 'forbidden',
    });
    expect(await refusal(run(triage, suggestDuplicate, { ...input, entityId: 2 }))).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await refusal(run(triage, suggestDuplicate, { ...input, otherOpportunityId: second.leadId })),
    ).toMatchObject(reason('duplicate_not_matching'));
    const suggested = await run(triage, suggestDuplicate, input);
    expect(suggested).toMatchObject({ kind: 'lead', state: 'open', confidence: 95 });
    // Asked again, the same card is answered.
    expect(await run(triage, suggestDuplicate, input)).toEqual(suggested);
    // The agent may not decide it.
    expect(
      await refusal(
        run(triage, dismissDuplicate, {
          entityId: 1,
          candidateId: (suggested as { id: string }).id,
        }),
      ),
    ).toMatchObject(reason('people_only'));
  });
});

describe('crm.duplicate.scan, the nightly search', () => {
  const workers = (entityId: number): Principal => ({
    ...principalFor('system:workers', [entityId]),
    id: SYSTEM_WORKERS_PRINCIPAL_ID,
    kind: 'system',
  });

  it('is refused to everyone without crm.duplicates.scan, and outside the request', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    for (const principal of [callerA, leadA, exec, principalFor('agent:triage', [1])]) {
      expect(
        await refusal(run(principal, scanDuplicates, { entityId: 1, afterId: null })),
      ).toMatchObject({ code: 'forbidden' });
    }
    expect(
      await refusal(run(workers(2), scanDuplicates, { entityId: 1, afterId: null })),
    ).toMatchObject({ code: 'forbidden' });
    // Its definer answers no person, however wide their grants.
    const facts = await asPrincipal(exec, async ({ tx }) =>
      tx.execute(sql`select * from app.duplicate_facts(1::smallint, null::uuid, 10, null::uuid)`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(facts).toBeInstanceOf(Error);
  });

  it('finds two customers an import and a form made at the same moment, once', async () => {
    // Every customer before these is left out: the search starts after this id.
    const start = newId();
    const number = phone();
    const byForm = await importedCustomer({
      name: `Gopal ${RUN}`,
      phone: number,
      owner: callerA,
      team: teamA,
    });
    const byImport = await importedCustomer({
      name: `Gopal Rao ${RUN}`,
      phone: number,
      owner: leadB,
      team: teamB,
    });
    const sameName = await importedCustomer({
      name: `Basanti ${RUN}`,
      village: `Rampur ${RUN}`,
      owner: callerA,
      team: teamA,
    });
    const twin = await importedCustomer({
      name: ` basanti   ${RUN}`,
      village: `rampur ${RUN}`,
      owner: callerA,
      team: teamA,
    });
    const emitted = memoryOutboxSink();
    const sweep = async () => {
      let found = 0;
      let afterId: string | null = start;
      do {
        const batch: { found: number; nextAfterId: string | null } = await run(
          workers(1),
          scanDuplicates,
          { entityId: 1, afterId },
          { outbox: emitted },
        );
        found += batch.found;
        afterId = batch.nextAfterId;
      } while (afterId !== null);
      return found;
    };
    expect(await sweep()).toBeGreaterThanOrEqual(2);
    expect((await candidatesOf(byForm.accountId))[0]).toMatchObject({
      kind: 'customer',
      reason: 'phone',
      confidence: 70,
    });
    expect((await candidatesOf(byImport.accountId)).length).toBe(1);
    expect((await candidatesOf(sameName.accountId))[0]).toMatchObject({
      kind: 'customer',
      other_account_id: twin.accountId,
      reason: 'name_village',
      confidence: 60,
    });
    expect(
      emitted.records.filter((r) => r.type === 'crm.duplicate.found').length,
    ).toBeGreaterThanOrEqual(2);
    // A second night finds nothing new.
    expect(await sweep()).toBe(0);
    // Team B's lead sees only what both of its customers allow: neither card.
    const page = await asPrincipal(leadB, (context) => listDuplicates(context, {}));
    expect(page.items.map((i) => i.id)).not.toContain(
      (await candidatesOf(sameName.accountId))[0]?.id,
    );
  });
});

describe('a write about a known customer and a merge of it never cross', () => {
  /**
   * Holds the customer as a merge does (`for update`) and archives it once `write` is waiting on
   * that lock, then answers what the write did once the merge committed. The wait is read from
   * `pg_stat_activity`: a backend blocked by the stand-in merge's, polled every 50 ms for at most
   * 10 seconds, so a write that never waits fails the test on any machine.
   */
  async function whileMerging(accountId: string, write: () => Promise<unknown>) {
    let locked!: (pid: number) => void;
    let release!: () => void;
    const isLocked = new Promise<number>((resolve) => (locked = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const merging = asMigrator((m) =>
      m.begin(async (tx) => {
        const [me] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
        await tx`select id from accounts where id = ${accountId} for update`;
        locked(me?.pid ?? 0);
        await released;
        await tx`update accounts set archived_at = now() where id = ${accountId}`;
      }),
    );
    const standIn = await isLocked;
    let settled = false;
    const writing = refusal(write()).finally(() => {
      settled = true;
    });
    try {
      await waitForLockWait(standIn);
      // The write waits for the merge rather than reading the customer as still live.
      expect(settled).toBe(false);
    } finally {
      release();
      await merging;
    }
    return writing;
  }

  /** Polls until a backend other than `standIn` waits on a lock it holds; fails after 10 s. */
  async function waitForLockWait(standIn: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    await asMigrator(async (m) => {
      for (;;) {
        const [row] = await m<{ waiting: number }[]>`
          select count(*)::int as waiting
            from pg_stat_activity
           where pid <> ${standIn}
             and wait_event_type = 'Lock'
             and ${standIn} = any (pg_blocking_pids(pid))`;
        if ((row?.waiting ?? 0) > 0) return;
        if (Date.now() > deadline) {
          throw new Error('no write waited on the stand-in merge within 10 seconds');
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    });
  }

  it('a lead for the customer waits, then finds it merged away', async () => {
    const target = await importedCustomer({
      name: `Hold ${RUN}`,
      phone: phone(),
      owner: callerA,
      team: teamA,
    });
    const refused = await whileMerging(target.accountId, () =>
      run(callerA, createLead, {
        entityId: 1,
        pipelineKey: 'farmer_pumps',
        existingAccountId: target.accountId,
      }),
    );
    expect(refused).toMatchObject(reason('account_missing'));
    const [row] = await asMigrator(
      (m) => m<{ leads: number }[]>`
        select count(*)::int as leads from opportunities where account_id = ${target.accountId}`,
    );
    expect(row?.leads).toBe(0);
  });

  it('a new site for the customer waits, then finds it merged away', async () => {
    const target = await importedCustomer({
      name: `Hold site ${RUN}`,
      owner: callerA,
      team: teamA,
    });
    const refused = await whileMerging(target.accountId, () =>
      run(callerA, upsertSite, {
        entityId: 1,
        accountId: target.accountId,
        type: 'borewell',
        village: `Hold ${RUN}`,
      }),
    );
    expect(refused).toMatchObject(reason('account_missing'));
  });

  it('a consent for a contact of the customer waits, then finds it merged away', async () => {
    const target = await importedCustomer({
      name: `Hold consent ${RUN}`,
      owner: callerA,
      team: teamA,
    });
    const refused = await whileMerging(target.accountId, () =>
      run(callerA, recordConsent, {
        entityId: 1,
        accountId: target.accountId,
        contactId: target.contactId,
        channel: 'whatsapp',
        purpose: 'promotional',
        source: 'walk_in_form',
        textVersion: 'v2',
        givenAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    );
    expect(refused).toMatchObject(reason('account_missing'));
    const [row] = await asMigrator(
      (m) => m<{ consents: number; rows: number }[]>`
        select (select count(*)::int from consents where contact_id = ${target.contactId}) as consents,
               (select count(*)::int from activities
                 where account_id = ${target.accountId} and type = 'consent_recorded') as rows`,
    );
    expect(row).toEqual({ consents: 0, rows: 0 });
  });

  it('a task on a lead of the customer waits, then finds it merged away', async () => {
    const target = await importedCustomer({
      name: `Hold task ${RUN}`,
      owner: callerA,
      team: teamA,
      lead: {},
    });
    const refused = await whileMerging(target.accountId, () =>
      run(callerA, createTask, {
        entityId: 1,
        opportunityId: target.leadId,
        kind: 'callback',
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    );
    expect(refused).toMatchObject(reason('account_missing'));
    const [row] = await asMigrator(
      (m) => m<{ tasks: number }[]>`
        select count(*)::int as tasks from tasks where account_id = ${target.accountId}`,
    );
    expect(row?.tasks).toBe(0);
  });
});

describe('app.match_text() and matchText()', () => {
  it('compare a name or a village the same way', async () => {
    const samples = [
      'Ram Kumar',
      '  RAM\tKumar \n',
      'ram   kumar',
      'Élan  Rāṁ',
      'Sitapur\u00a0Kalan',
      "O'Neil  Farm",
      'राम  कुमार',
      'Ward 7  B',
      '',
      '   ',
    ];
    const rows = await asMigrator(
      (m) => m<{ value: string; key: string }[]>`
        select value, app.match_text(value) as key
          from unnest(${samples}::text[]) with ordinality as s(value, n) order by n`,
    );
    expect(rows.map((r) => r.key)).toEqual(samples.map(matchText));
  });
});
