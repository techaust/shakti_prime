import { newId, type ImportJobDto, type PermissionGrant, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  createTestUser,
  grantsForRole,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { Command } from '../../src/command/define-command';
import { executeCommand } from '../../src/command/execute';
import { runCommand } from '../../src/command/run-command';
import { assignOpportunity } from '../../src/commands/crm/assign-opportunity';
import { createLead } from '../../src/commands/crm/create-lead';
import { commitImportBatch, commitImportJob } from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { parseImportFile } from '../../src/imports/parse';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { listImportRows } from '../../src/queries/imports/import-queries';
import { searchLeads } from '../../src/queries/crm/search-leads';

// Two gaps in the rule that a customer a colleague looks after in a company goes to that
// colleague (AUDIT M25), closed by 0055: a new lead typed with the number of that customer, and a
// lead handed to someone who could then read the lead but not its customer.

afterAll(closeDb);
vi.setConfig({ testTimeout: 60_000 });

/** Ten digits no earlier run used: the suites never clean the CRM tables. */
function digits(): string {
  return `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
}

function run<I extends z.ZodType, O extends z.ZodType>(
  principal: Principal,
  command: Command<I, O>,
  input: unknown,
): Promise<z.output<O>> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  );
}

const newCustomer = (entityId: number, phone: string, name = 'Lead guard customer') => ({
  entityId,
  pipelineKey: 'farmer_pumps',
  contact: { name, phone },
  account: { type: 'farm' as const },
  site: { type: 'borewell' as const, village: 'Lead guard village' },
});

/** Customers that have the number, read past the policies. */
async function customersWith(phone: string): Promise<number> {
  const [row] = await asMigrator(
    (m) => m<{ n: number }[]>`
      select count(distinct ac.account_id)::int as n
        from contact_phones cp join account_contacts ac on ac.contact_id = cp.contact_id
       where cp.e164 = ${`+91${phone}`}`,
  );
  return row?.n ?? -1;
}

async function leadsOwnedBy(ownerId: string): Promise<number> {
  const [row] = await asMigrator(
    (m) =>
      m<{ n: number }[]>`select count(*)::int as n from opportunities where owner_id = ${ownerId}`,
  );
  return row?.n ?? -1;
}

let teamId: string;
let otherTeamId: string;
let owner: Principal;
let colleague: Principal;

beforeAll(async () => {
  teamId = await createTestTeam(1, 'lead guard team');
  otherTeamId = await createTestTeam(1, 'lead guard other team');
  owner = await createTestPrincipal('tele_caller_cc', [1], { teamId });
  colleague = await createTestPrincipal('tele_caller_cc', [1], { teamId });
});

describe('crm.lead.create with a number a colleague’s customer has (0055)', () => {
  it('is denied without crm.lead.write, and refused for a company outside the request', async () => {
    const phone = digits();
    await run(owner, createLead, newCustomer(1, phone));
    const hr = await createTestPrincipal('hr_admin', [1]);
    await expect(run(hr, createLead, newCustomer(1, phone))).rejects.toMatchObject({
      code: 'forbidden',
    });
    const elsewhere = await createTestPrincipal('tele_caller_cc', [2]);
    await expect(run(elsewhere, createLead, newCustomer(1, phone))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(await customersWith(phone)).toBe(1);
  });

  it('is refused to a colleague who may not act for the owner, and creates nothing', async () => {
    const phone = digits();
    await run(owner, createLead, newCustomer(1, phone));
    await expect(
      run(colleague, createLead, newCustomer(1, `${phone.slice(0, 5)} ${phone.slice(5)}`)),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });
    // The same answer, and the same sentence, as the known-customer path gives (AUDIT M25).
    expect(await customersWith(phone)).toBe(1);
    expect(await leadsOwnedBy(colleague.id)).toBe(0);
    const [made] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from accounts where created_by = ${colleague.id}`,
    );
    expect(made?.n).toBe(0);
  });

  it('goes through as before for your own customer, one you may act for, or another company’s', async () => {
    const phone = digits();
    await run(owner, createLead, newCustomer(1, phone));
    // The owner's repeat enquiry typed as a new customer: unchanged, a customer of their own
    // (the duplicate cards come with CRM-03).
    await run(owner, createLead, newCustomer(1, phone));
    // The team lead and the General Manager may act for the owner.
    const teamLead = await createTestPrincipal('sales_team_lead', [1], { teamId });
    await run(teamLead, createLead, newCustomer(1, phone));
    const gm = await createTestPrincipal('general_manager', [1]);
    await run(gm, createLead, newCustomer(1, phone));
    // A caller of company 2, where nobody deals with the customer yet.
    const company2 = await createTestPrincipal('tele_caller_cc', [2]);
    await run(company2, createLead, newCustomer(2, phone));
    expect(await customersWith(phone)).toBe(5);

    // A team lead of another team may not act for the owner, so is refused.
    const otherLead = await createTestPrincipal('sales_team_lead', [1], { teamId: otherTeamId });
    await expect(run(otherLead, createLead, newCustomer(1, phone))).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });
  });
});

/** The command input for a CSV file, parsed the way the upload action parses it. */
async function fileInput(entityId: number, csv: string) {
  const bytes = new TextEncoder().encode(csv);
  const parsed = await parseImportFile(bytes);
  return {
    entityId,
    kind: 'leads' as const,
    file: {
      name: 'lead-guard.csv',
      contentType: 'text/csv',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bucket: 'memory',
      key: `imports/${String(entityId)}/${newId()}`,
    },
    format: parsed.format,
    columns: parsed.columns,
    rows: parsed.rows,
  };
}

async function previewedJob(principal: Principal, rows: string[]): Promise<ImportJobDto> {
  const created = await run(
    principal,
    createImportJob,
    await fileInput(1, `Name,Mobile,Village\n${rows.join('\n')}\n`),
  );
  await run(principal, mapImportJob, {
    entityId: 1,
    jobId: created.id,
    mapping: {
      columns: { contactName: 'Name', phone: 'Mobile', village: 'Village' },
      defaults: { pipelineKey: 'farmer_pumps', accountType: 'farm', siteType: 'borewell' },
    },
  });
  return run(principal, previewImportJob, { entityId: 1, jobId: created.id });
}

/**
 * An importer whose role an Executive has narrowed: imports for the company, but leads and
 * customers of their own only. With the seeded roles every importer writes every customer of the
 * company (General Manager, Executive), so none of them is ever refused.
 */
async function narrowImporter(): Promise<Principal> {
  const permissions: PermissionGrant[] = grantsForRole('general_manager').map((g) =>
    g.key.startsWith('crm.lead.') || g.key.startsWith('crm.account.')
      ? { key: g.key, scope: 'own' }
      : g,
  );
  return createTestPrincipal('general_manager', [1], { teamId: otherTeamId, permissions });
}

describe('an import row with a number a colleague’s customer has (0055)', () => {
  it('is marked with that reason, and the rest of the batch goes on', async () => {
    const held = digits();
    await run(owner, createLead, newCustomer(1, held));
    const importer = await narrowImporter();
    const [first, last] = [digits(), digits()];
    const job = await previewedJob(importer, [
      `Guard One,${first},Sikar`,
      `Guard Held,${held},Sikar`,
      `Guard Three,${last},Sikar`,
    ]);
    expect(job.validRows).toBe(3);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const requestId = newId();
    const done = await executeCommand(importer, { entityIds: [1], requestId }, commitImportBatch, {
      entityId: 1,
      jobId: job.id,
    });
    expect(done).toMatchObject({
      state: 'committed',
      validRows: 2,
      invalidRows: 1,
      committedRows: 2,
    });

    const page = await asPrincipal(importer, (ctx) =>
      listImportRows(ctx, { entityId: 1, jobId: job.id, limit: 50 }),
    );
    const byRow = new Map(page.rows.map((r) => [r.raw.Name, r]));
    expect(byRow.get('Guard Held')).toMatchObject({
      state: 'invalid',
      errors: [{ field: 'phone', code: 'customer_held_by_colleague' }],
      createdId: null,
    });
    expect(byRow.get('Guard One')?.state).toBe('committed');
    expect(byRow.get('Guard Three')?.state).toBe('committed');
    expect(await customersWith(held)).toBe(1);
    expect(await customersWith(first)).toBe(1);
    // The refused row left no key behind, so nothing replays it.
    const [keys] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from idempotency_keys where principal_id = ${importer.id}`,
    );
    expect(keys?.n).toBe(2);

    const [row] = await asMigrator(
      (m) => m<{ after: Record<string, unknown> }[]>`
        select after_json as after from audit_logs
         where request_id = ${requestId} and command = 'imports.job.commit_batch'`,
    );
    expect(row?.after).toMatchObject({ state: 'committed', committedRows: 2, refusedRows: 1 });
  });

  it('is imported as a new customer, as before, by an importer who may act for the owner', async () => {
    const held = digits();
    await run(owner, createLead, newCustomer(1, held));
    const gm = await createTestPrincipal('general_manager', [1]);
    const job = await previewedJob(gm, [`Guard Known,${held},Sikar`]);
    await run(gm, commitImportJob, { entityId: 1, jobId: job.id });
    const done = await run(gm, commitImportBatch, { entityId: 1, jobId: job.id });
    expect(done).toMatchObject({ state: 'committed', committedRows: 1, invalidRows: 0 });
    expect(await customersWith(held)).toBe(2);
  });
});

describe('crm.opportunity.assign takes the customer with the lead (0055)', () => {
  /** What `who` reads of the customer: the account, its site, its contact and the phone. */
  async function reads(who: Principal, accountId: string) {
    return asPrincipal(who, async ({ tx }) => {
      const [row] = (await tx.execute(sql`
        select (select count(*) from accounts where id = ${accountId})::int as account,
               (select count(*) from customer_sites where account_id = ${accountId})::int as site,
               (select count(*) from contacts c join account_contacts ac on ac.contact_id = c.id
                 where ac.account_id = ${accountId})::int as contact,
               (select count(*) from contact_phones p join account_contacts ac on ac.contact_id = p.contact_id
                 where ac.account_id = ${accountId})::int as phone`)) as unknown as Record<
        string,
        number
      >[];
      return row;
    });
  }

  async function relationship(accountId: string) {
    const [row] = await asMigrator(
      (m) => m<{ id: string; owner: string | null; team: string | null }[]>`
        select id, owner_id as owner, team_id as team from account_entities
         where account_id = ${accountId} and entity_id = 1`,
    );
    return row;
  }

  it('the new owner reads the customer and finds the lead; the previous owner no longer does', async () => {
    const fromUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const toUser = await createTestUser([
      { entityId: 1, roleKey: 'tele_caller_lc', teamId: otherTeamId },
    ]);
    const from = principalFor('tele_caller_cc', [1], { id: fromUser.id, teamId });
    const to = principalFor('tele_caller_lc', [1], { id: toUser.id, teamId: otherTeamId });
    const tag = `Handover ${newId().slice(-8)}`;
    const lead = await run(from, createLead, newCustomer(1, digits(), tag));
    const accountId = lead.account.id;
    expect(await reads(to, accountId)).toEqual({ account: 0, site: 0, contact: 0, phone: 0 });
    const before = await relationship(accountId);

    const gm = await createTestPrincipal('general_manager', [1]);
    const requestId = newId();
    await executeCommand(gm, { entityIds: [1], requestId }, assignOpportunity, {
      entityId: 1,
      opportunityId: lead.id,
      ownerId: to.id,
    });

    expect(await reads(to, accountId)).toEqual({ account: 1, site: 1, contact: 1, phone: 1 });
    const found = await asPrincipal(to, (ctx) => searchLeads(ctx, { q: tag, limit: 20 }));
    expect(found.map((h) => h.id)).toContain(lead.id);
    expect(await reads(from, accountId)).toEqual({ account: 0, site: 0, contact: 0, phone: 0 });
    expect(await relationship(accountId)).toEqual({
      id: before?.id,
      owner: to.id,
      team: otherTeamId,
    });

    const rows = await asMigrator(
      (m) => m<{ type: string; id: string; before: unknown; after: unknown }[]>`
        select aggregate_type as type, aggregate_id as id, before_json as before, after_json as after
          from audit_logs where request_id = ${requestId} order by aggregate_type`,
    );
    expect(rows.map((r) => r.type)).toEqual(['account_entity', 'opportunity']);
    expect(rows[0]).toEqual({
      type: 'account_entity',
      id: before?.id,
      before: { ownerId: from.id, teamId },
      after: { ownerId: to.id, teamId: otherTeamId },
    });
  });

  it('is done for the triage agent too, which holds no customer permission', async () => {
    const fromUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const toUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const from = principalFor('tele_caller_cc', [1], { id: fromUser.id, teamId });
    const to = principalFor('tele_caller_cc', [1], { id: toUser.id, teamId });
    const lead = await run(from, createLead, newCustomer(1, digits()));
    // The seeded agent: a new agent principal would change the group's list of agents.
    const seeded = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    const triage = principalFor('agent:triage', [1], { id: seeded?.id ?? '' });
    await run(triage, assignOpportunity, { entityId: 1, opportunityId: lead.id, ownerId: to.id });
    expect(await reads(to, lead.account.id)).toEqual({ account: 1, site: 1, contact: 1, phone: 1 });
    expect((await relationship(lead.account.id))?.owner).toBe(to.id);
  });

  it('leaves a relationship someone other than the previous owner holds as it is', async () => {
    const holder = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const fromUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const toUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const lead = await run(holder, createLead, newCustomer(1, digits()));
    // A lead of the holder's customer that someone else owns, as a raw write can leave it.
    await asMigrator(
      (m) => m`update opportunities set owner_id = ${fromUser.id} where id = ${lead.id}`,
    );
    const gm = await createTestPrincipal('general_manager', [1]);
    const requestId = newId();
    await executeCommand(gm, { entityIds: [1], requestId }, assignOpportunity, {
      entityId: 1,
      opportunityId: lead.id,
      ownerId: toUser.id,
    });
    expect((await relationship(lead.account.id))?.owner).toBe(holder.id);
    const types = await asMigrator(
      (m) => m<{ type: string }[]>`
        select aggregate_type as type from audit_logs where request_id = ${requestId}`,
    );
    expect(types.map((t) => t.type)).toEqual(['opportunity']);
  });

  it('two callers with a lead each both read the customer after a handover (0057)', async () => {
    const fromUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const toUser = await createTestUser([
      { entityId: 1, roleKey: 'tele_caller_lc', teamId: otherTeamId },
    ]);
    const from = principalFor('tele_caller_cc', [1], { id: fromUser.id, teamId });
    const to = principalFor('tele_caller_lc', [1], { id: toUser.id, teamId: otherTeamId });
    const first = await run(from, createLead, newCustomer(1, digits()));
    const accountId = first.account.id;
    const second = await run(from, createLead, {
      entityId: 1,
      pipelineKey: 'farmer_pumps',
      existingAccountId: accountId,
    });
    const gm = await createTestPrincipal('general_manager', [1]);
    await run(gm, assignOpportunity, { entityId: 1, opportunityId: second.id, ownerId: to.id });
    // The relationship went with the lead; the previous owner keeps the first lead and reads the
    // customer through it.
    expect((await relationship(accountId))?.owner).toBe(to.id);
    expect(await reads(to, accountId)).toEqual({ account: 1, site: 1, contact: 1, phone: 1 });
    expect(await reads(from, accountId)).toEqual({ account: 1, site: 1, contact: 1, phone: 1 });
  });
});

describe('a known customer in All-companies mode (0057)', () => {
  it('is judged in the lead’s company only, so a relationship in another company does not pass the routing', async () => {
    const holder = await createTestPrincipal('tele_caller_cc', [1], { teamId });
    const caller = await createTestPrincipal('tele_caller_cc', [1, 2]);
    const known = await run(holder, createLead, newCustomer(1, digits()));
    const existing = (entityId: number) => ({
      entityId,
      pipelineKey: 'farmer_pumps',
      existingAccountId: known.account.id,
    });
    // The caller takes the customer on in company 2, acting there.
    const inTwo = await asPrincipal({ ...caller, entityIds: [2] }, (context) =>
      runCommand(createLead, { context, audit, outbox }, existing(2)),
    );
    expect(inTwo.account.id).toBe(known.account.id);
    // Acting for both companies, a lead in company 1, where the holder looks after the customer,
    // goes to the holder; before 0057 the caller's company-2 relationship answered already_yours.
    await expect(run(caller, createLead, existing(1))).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });
    // A repeat enquiry in company 2, the caller's own there, still goes through.
    const again = await run(caller, createLead, existing(2));
    expect(again.account.id).toBe(known.account.id);
    const [links] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from account_entities where account_id = ${known.account.id}`,
    );
    expect(links?.n).toBe(2);
  });
});
