import { newId, type ImportJobDto, type PermissionGrant, type Principal } from '@shakti/contracts';
import {
  AGENT_PRINCIPAL_SEED,
  asMigrator,
  asOutboxPublisher,
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
import {
  commitImportBatch,
  commitImportJob,
  SET_BASED_BATCH_BOUND_MS,
} from '../../src/commands/imports/commit-job';
import { createImportJob } from '../../src/commands/imports/create-job';
import { mapImportJob } from '../../src/commands/imports/map-job';
import { previewImportJob } from '../../src/commands/imports/preview-job';
import { parseImportFile } from '../../src/imports/parse';
import { importRowKey } from '../../src/imports/row-key';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { memoryLogger } from '../../src/ports/logger';
import { listImportRows } from '../../src/queries/imports/import-queries';
import { searchLeads } from '../../src/queries/crm/search-leads';
import { importBatchSettings } from '../../src/testing';

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

  it('is not done for the triage agent, which may not write customers; the new owner reads the customer through the lead (0059)', async () => {
    const fromUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const toUser = await createTestUser([{ entityId: 1, roleKey: 'tele_caller_cc', teamId }]);
    const from = principalFor('tele_caller_cc', [1], { id: fromUser.id, teamId });
    const to = principalFor('tele_caller_cc', [1], { id: toUser.id, teamId });
    const lead = await run(from, createLead, newCustomer(1, digits()));
    const before = await relationship(lead.account.id);
    // The seeded agent: a new agent principal would change the group's list of agents.
    const seeded = AGENT_PRINCIPAL_SEED.find((a) => a.roleKey === 'agent:triage');
    const triage = principalFor('agent:triage', [1], { id: seeded?.id ?? '' });
    const requestId = newId();
    const moved = await executeCommand(triage, { entityIds: [1], requestId }, assignOpportunity, {
      entityId: 1,
      opportunityId: lead.id,
      ownerId: to.id,
    });
    // The lead moves; the customer master is left as it was (SECURITY §3.3).
    expect(moved.ownerId).toBe(to.id);
    expect(await relationship(lead.account.id)).toEqual(before);
    expect(before?.owner).toBe(from.id);
    const types = await asMigrator(
      (m) => m<{ type: string }[]>`
        select aggregate_type as type from audit_logs where request_id = ${requestId}`,
    );
    expect(types.map((t) => t.type)).toEqual(['opportunity']);
    // The new owner reads the customer through the lead (0057), and so does the previous owner,
    // who still looks after it.
    expect(await reads(to, lead.account.id)).toEqual({ account: 1, site: 1, contact: 1, phone: 1 });
    expect(await reads(from, lead.account.id)).toEqual({
      account: 1,
      site: 1,
      contact: 1,
      phone: 1,
    });
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

describe('two new leads at once with one new number (0059)', () => {
  /** Advisory locks some session is waiting for, read past the policies. */
  async function waitingOnANumber(): Promise<number> {
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted`,
    );
    return row?.n ?? 0;
  }

  async function until(check: () => Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i += 1) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('the condition never held');
  }

  /**
   * Makes a lead for `phone` as `owner` and keeps its transaction open until `release` is called,
   * as a colleague's save still running would.
   */
  function heldOpen(phone: string) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let made: () => void = () => undefined;
    const written = new Promise<void>((resolve) => {
      made = resolve;
    });
    const done = asPrincipal(owner, async (context) => {
      const lead = await runCommand(createLead, { context, audit, outbox }, newCustomer(1, phone));
      made();
      await released;
      return lead;
    });
    return { done, written, release };
  }

  /** Whether `promise` has settled, without waiting for it. */
  function settledFlag(promise: Promise<unknown>): () => boolean {
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    return () => settled;
  }

  it('the second waits for the first to commit, then finds its customer', async () => {
    const phone = digits();
    const first = heldOpen(phone);
    await first.written;
    const second = run(colleague, createLead, newCustomer(1, phone));
    const settled = settledFlag(second);
    await until(async () => (await waitingOnANumber()) > 0);
    expect(settled()).toBe(false);
    first.release();
    await first.done;
    await expect(second).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'customer_held_by_colleague' },
    });
    expect(await customersWith(phone)).toBe(1);
    expect(await leadsOwnedBy(colleague.id)).toBe(0);
  });

  it('an import row does not wait for a lead being saved with its number, and can make a second customer (known limitation, duplicate cards in Phase 1)', async () => {
    const phone = digits();
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Race Held,${phone},Sikar`,
      `Race Free,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const first = heldOpen(phone);
    await first.written;
    // The batch holds no number and waits for nobody: it commits while the colleague's save runs
    // and cannot yet see its customer.
    await expect(
      run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    ).resolves.toMatchObject({ state: 'committed', committedRows: 2 });
    first.release();
    await first.done;
    expect(await customersWith(phone)).toBe(2);
  });
});

describe('import batches: their numbers, why one goes row by row, and its time (0059)', () => {
  /** Each row of the job as it stands, read past the policies, in file order. */
  async function rowsOf(jobId: string) {
    return asMigrator(
      (m) => m<{ name: string; state: string; batch: number | null }[]>`
        select raw_json->>'Name' as name, state, committed_batch as batch
          from import_rows where job_id = ${jobId} order by row_no`,
    );
  }

  async function batchCountOf(jobId: string): Promise<number | undefined> {
    const [row] = await asMigrator(
      (m) => m<{ n: number }[]>`select batch_count as n from import_jobs where id = ${jobId}`,
    );
    return row?.n;
  }

  async function committedEvent(jobId: string) {
    const [row] = await asOutboxPublisher(
      (p) => p<{ payload: Record<string, unknown> }[]>`
        select payload_json as payload from outbox_events
         where aggregate_id = ${jobId} and type = 'imports.job.committed'`,
    );
    return row?.payload;
  }

  /** The batch numbers and row counts of the job's audit rows, oldest first. */
  async function auditedBatches(jobId: string) {
    const rows = await asMigrator(
      (m) => m<{ after: Record<string, unknown> }[]>`
        select after_json as after from audit_logs
         where aggregate_id = ${jobId} and command = 'imports.job.commit_batch'
         order by created_at, id`,
    );
    return rows.map((r) => ({ batch: r.after.batch, rows: r.after.rows }));
  }

  it('a batch whose every row was refused still takes its number, and the count is right', async () => {
    const [heldOne, heldTwo] = [digits(), digits()];
    await run(owner, createLead, newCustomer(1, heldOne));
    await run(owner, createLead, newCustomer(1, heldTwo));
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Numbered Held One,${heldOne},Sikar`,
      `Numbered Held Two,${heldTwo},Sikar`,
      `Numbered Free,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const first = await run(importer, commitImportBatch, {
      entityId: 1,
      jobId: job.id,
      batchSize: 2,
    });
    expect(first).toMatchObject({ state: 'committing', committedRows: 0, invalidRows: 2 });
    const second = await run(importer, commitImportBatch, {
      entityId: 1,
      jobId: job.id,
      batchSize: 2,
    });
    expect(second).toMatchObject({ state: 'committed', committedRows: 1 });
    expect(await rowsOf(job.id)).toEqual([
      { name: 'Numbered Held One', state: 'invalid', batch: null },
      { name: 'Numbered Held Two', state: 'invalid', batch: null },
      { name: 'Numbered Free', state: 'committed', batch: 2 },
    ]);
    expect(await batchCountOf(job.id)).toBe(2);
    expect(await auditedBatches(job.id)).toEqual([
      { batch: 1, rows: 2 },
      { batch: 2, rows: 1 },
    ]);
    expect(await committedEvent(job.id)).toMatchObject({ committedRows: 1, batches: 2 });
  });

  it('logs why a batch went row by row, with no value from the file', async () => {
    const held = digits();
    await run(owner, createLead, newCustomer(1, held));
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Logged Free,${digits()},Sikar`,
      `Logged Held,${held},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const saved = importBatchSettings.logger;
    const log = memoryLogger();
    importBatchSettings.logger = log;
    const requestId = newId();
    try {
      await executeCommand(importer, { entityIds: [1], requestId }, commitImportBatch, {
        entityId: 1,
        jobId: job.id,
      });
    } finally {
      importBatchSettings.logger = saved;
    }
    expect(log.entries).toEqual([
      {
        level: 'info',
        event: 'imports.batch_row_by_row',
        fields: {
          requestId,
          jobId: job.id,
          batch: 1,
          rows: 2,
          reason: 'a customer a colleague looks after',
        },
      },
    ]);
    const line = JSON.stringify(log.entries);
    expect(line).not.toContain(held.slice(-6));
    expect(line).not.toContain('Logged');
  });

  it('stops a row-by-row batch when its time runs out and leaves the rest for the next one', async () => {
    const held = digits();
    await run(owner, createLead, newCustomer(1, held));
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Timed First,${digits()},Sikar`,
      `Timed Held,${held},Sikar`,
      `Timed Third,${digits()},Sikar`,
      `Timed Fourth,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const saved = importBatchSettings.budgetMs;
    // No time at all: a row-by-row batch does its first row and stops there.
    importBatchSettings.budgetMs = 0;
    try {
      const one = await run(importer, commitImportBatch, { entityId: 1, jobId: job.id });
      expect(one).toMatchObject({ state: 'committing', committedRows: 1, invalidRows: 0 });
      const two = await run(importer, commitImportBatch, { entityId: 1, jobId: job.id });
      expect(two).toMatchObject({ state: 'committing', committedRows: 1, invalidRows: 1 });
      // With its time back, the rest is plain, so the set-based path takes it whole.
      importBatchSettings.budgetMs = saved;
      const three = await run(importer, commitImportBatch, { entityId: 1, jobId: job.id });
      expect(three).toMatchObject({ state: 'committed', committedRows: 3, invalidRows: 1 });
    } finally {
      importBatchSettings.budgetMs = saved;
    }
    expect(await rowsOf(job.id)).toEqual([
      { name: 'Timed First', state: 'committed', batch: 1 },
      { name: 'Timed Held', state: 'invalid', batch: null },
      { name: 'Timed Third', state: 'committed', batch: 3 },
      { name: 'Timed Fourth', state: 'committed', batch: 3 },
    ]);
    expect(await auditedBatches(job.id)).toEqual([
      { batch: 1, rows: 1 },
      { batch: 2, rows: 1 },
      { batch: 3, rows: 2 },
    ]);
    expect(await batchCountOf(job.id)).toBe(3);
    expect(await committedEvent(job.id)).toMatchObject({ committedRows: 3, batches: 3 });
  });
});

describe('an import batch begun late, and two jobs sharing numbers (the last-mile audit)', () => {
  /** The settings a test changes, put back afterwards. */
  async function withSettings<T>(
    change: Partial<typeof importBatchSettings>,
    work: () => Promise<T>,
  ): Promise<T> {
    const saved = { ...importBatchSettings };
    Object.assign(importBatchSettings, change);
    try {
      return await work();
    } finally {
      Object.assign(importBatchSettings, saved);
    }
  }

  /**
   * A clock that stands still at `at` milliseconds after the batch began, and moves `step` on at
   * each reading after the first two (the batch's start and its choice of path).
   */
  function fakeClock(at: number, step = 0): () => number {
    let readings = 0;
    return () => {
      readings += 1;
      if (readings === 1) return 0;
      return at + (readings - 2) * step;
    };
  }

  it('skips the set-based try when less than the slowest set-based batch is left', async () => {
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Late One,${digits()},Sikar`,
      `Late Two,${digits()},Sikar`,
      `Late Three,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const log = memoryLogger();
    const budget = importBatchSettings.budgetMs;
    // The batch waited so long for its start that one millisecond less than a try needs is left.
    const done = await withSettings(
      { logger: log, now: fakeClock(budget - SET_BASED_BATCH_BOUND_MS + 1) },
      () => run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    );
    // Plain rows every one, so only the time sent them row by row; with the clock standing
    // still, every row is done.
    expect(done).toMatchObject({ state: 'committed', committedRows: 3 });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      level: 'info',
      event: 'imports.batch_row_by_row',
      fields: { jobId: job.id, rows: 3, reason: 'too little time for the set-based path' },
    });
  });

  it('keeps to its time row by row after skipping the set-based try', async () => {
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Clocked One,${digits()},Sikar`,
      `Clocked Two,${digits()},Sikar`,
      `Clocked Three,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const budget = importBatchSettings.budgetMs;
    // Each row takes four seconds and the batch began with seven left: it stops after the
    // second row and leaves the third for the next batch.
    const left = 7_000;
    const first = await withSettings(
      { logger: memoryLogger(), now: fakeClock(budget - left, 4_000) },
      () => run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    );
    expect(first).toMatchObject({ state: 'committing', committedRows: 2 });
    const second = await run(importer, commitImportBatch, { entityId: 1, jobId: job.id });
    expect(second).toMatchObject({ state: 'committed', committedRows: 3 });
  });

  it('tries the set-based path when the slowest set-based batch still fits', async () => {
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Timely One,${digits()},Sikar`,
      `Timely Two,${digits()},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    const log = memoryLogger();
    const budget = importBatchSettings.budgetMs;
    const done = await withSettings(
      { logger: log, now: fakeClock(budget - SET_BASED_BATCH_BOUND_MS) },
      () => run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    );
    expect(done).toMatchObject({ state: 'committed', committedRows: 2 });
    expect(log.entries).toEqual([]);
  });

  it('two jobs whose rows share new numbers in opposite orders both commit at once', async () => {
    const importer = await narrowImporter();
    const numbers = Array.from({ length: 16 }, () => digits());
    const lines = numbers.map((phone, i) => `Shared ${String(i + 1)},${phone},Sikar`);
    const forward = await previewedJob(importer, lines);
    const backward = await previewedJob(importer, [...lines].reverse());
    for (const job of [forward, backward]) {
      await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    }
    // A budget too short for a set-based try, and a clock that stands still: both batches go row
    // by row, in file order, at the same time. Neither holds a number, so neither waits.
    const results = await withSettings(
      { logger: memoryLogger(), now: () => 0, budgetMs: SET_BASED_BATCH_BOUND_MS - 1 },
      () =>
        Promise.all(
          [forward, backward].map((job) =>
            run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
          ),
        ),
    );
    for (const done of results) {
      expect(done).toMatchObject({ state: 'committed', committedRows: 16, failedBatch: null });
    }
  });

  /**
   * Holds a new customer's number in company 1 from another transaction, as a lead being typed in
   * would, until `release` is called.
   */
  async function holdNumber(phone: string) {
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let taken: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      taken = resolve;
    });
    const done = asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${`lead-phone:1:+91${phone}`}, 0))`;
        taken();
        await released;
      }),
    );
    await held;
    return { release, done };
  }

  async function jobState(jobId: string) {
    const [row] = await asMigrator(
      (m) => m<{ state: string; committed: number; failed: number | null; batches: number }[]>`
        select state, committed_rows as committed, failed_batch as failed, batch_count as batches
          from import_jobs where id = ${jobId}`,
    );
    return row;
  }

  it('takes no lock on a number: one held elsewhere neither delays nor fails a batch', async () => {
    const importer = await narrowImporter();
    for (const change of [{}, { budgetMs: SET_BASED_BATCH_BOUND_MS - 1 }]) {
      const held = digits();
      const job = await previewedJob(importer, [
        `Unheld One,${digits()},Sikar`,
        `Unheld Two,${held},Sikar`,
      ]);
      await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
      const lock = await holdNumber(held);
      try {
        // Set-based, then row by row with too little time for a set-based try.
        const started = Date.now();
        await expect(
          withSettings({ ...change, logger: memoryLogger() }, () =>
            run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
          ),
        ).resolves.toMatchObject({ state: 'committed', committedRows: 2 });
        // Far inside the ten seconds a wait for the lock would take.
        expect(Date.now() - started).toBeLessThan(5_000);
      } finally {
        lock.release();
        await lock.done;
      }
      expect(await jobState(job.id)).toMatchObject({ state: 'committed', failed: null });
    }
  });

  it('goes row by row for at least one row when a set-based try has used the budget up', async () => {
    const held = digits();
    await run(owner, createLead, newCustomer(1, held));
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [
      `Slow One,${digits()},Sikar`,
      `Slow Held,${held},Sikar`,
    ]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    // The batch begins with all its time; the set-based try, sent row by row by the colleague's
    // customer, reports back after the whole budget has gone.
    const budget = importBatchSettings.budgetMs;
    const readings = [0, 0];
    const first = await withSettings(
      { logger: memoryLogger(), now: () => readings.shift() ?? budget + 1 },
      () => run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    );
    // The first row is done all the same, and the rest waits for the next batch.
    expect(first).toMatchObject({ state: 'committing', committedRows: 1, failedBatch: null });
    await expect(
      run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
    ).resolves.toMatchObject({ state: 'committed', committedRows: 1, invalidRows: 1 });
  });

  /**
   * Runs a command in a transaction whose lock wait is `lockTimeout` rather than the connection's
   * ten seconds, so a test of a wait that runs out takes a second.
   */
  function runWaiting<I extends z.ZodType, O extends z.ZodType>(
    principal: Principal,
    command: Command<I, O>,
    input: unknown,
    lockTimeout = '1s',
  ): Promise<z.output<O>> {
    return asPrincipal(principal, async (context) => {
      await context.tx.execute(sql`select set_config('lock_timeout', ${lockTimeout}, true)`);
      return runCommand(command, { context, audit, outbox }, input);
    });
  }

  /**
   * Claims the idempotency key of a job's first row from another transaction and keeps the claim
   * open for `ms`, then takes it back, as a stuck run of the same row would.
   */
  async function holdRowKey(principal: Principal, jobId: string, ms: number) {
    const [first] = await asMigrator(
      (m) =>
        m<
          { rowNo: number }[]
        >`select min(row_no)::int as "rowNo" from import_rows where job_id = ${jobId}`,
    );
    const rowNo = first?.rowNo ?? 0;
    let taken: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      taken = resolve;
    });
    const done = asMigrator((m) =>
      m
        .begin(async (tx) => {
          await tx`insert into idempotency_keys (principal_id, key, command, input_hash)
            values (${principal.id}, ${importRowKey(jobId, rowNo)}, 'crm.lead.create', ${'0'.repeat(64)})`;
          taken();
          await new Promise((resolve) => setTimeout(resolve, ms));
          throw new Error('taken back');
        })
        .catch(() => undefined),
    );
    await held;
    // An object, so awaiting this function waits for the claim and not for its end.
    return { done };
  }

  it('answers the lead form the conflict sentence when a number stays held past the lock wait', async () => {
    const phone = digits();
    const lock = await holdNumber(phone);
    try {
      await expect(runWaiting(owner, createLead, newCustomer(1, phone))).rejects.toMatchObject({
        code: 'conflict',
        details: { reason: 'concurrent_change', sqlstate: '55P03' },
      });
    } finally {
      lock.release();
      await lock.done;
    }
    expect(await customersWith(phone)).toBe(0);
  });

  it('hands a lock wait that runs out mid-batch to the worker, failing nothing', async () => {
    const importer = await narrowImporter();
    // Set-based, then row by row with too little time for a set-based try.
    for (const change of [{}, { budgetMs: SET_BASED_BATCH_BOUND_MS - 1, now: () => 0 }]) {
      const job = await previewedJob(importer, [`Waited One,${digits()},Sikar`]);
      await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
      const holder = await holdRowKey(importer, job.id, 3_000);
      const started = Date.now();
      try {
        await expect(
          withSettings({ ...change, logger: memoryLogger() }, () =>
            runWaiting(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
          ),
        ).rejects.toMatchObject({ code: 'conflict', details: { sqlstate: '55P03' } });
        // One second of lock wait, not the three the claim is held for.
        expect(Date.now() - started).toBeLessThan(2_900);
      } finally {
        await holder.done;
      }
      expect(await jobState(job.id)).toEqual({
        state: 'committing',
        committed: 0,
        failed: null,
        batches: 0,
      });
      await expect(
        run(importer, commitImportBatch, { entityId: 1, jobId: job.id }),
      ).resolves.toMatchObject({ state: 'committed', committedRows: 1 });
    }
  });

  it('cuts a set-based statement off at the budget left and goes row by row', async () => {
    const importer = await narrowImporter();
    const job = await previewedJob(importer, [`Cut One,${digits()},Sikar`]);
    await run(importer, commitImportJob, { entityId: 1, jobId: job.id });
    // The set-based try is made with all the budget, then finds a millisecond left when it sets
    // its statement timeout, which is given its floor of one second.
    const budget = importBatchSettings.budgetMs;
    const readings = [0, 0, budget - 1];
    const log = memoryLogger();
    // The row's key is claimed elsewhere for three seconds: the set-based insert waits and is cut
    // off after one second, and the row-by-row claim waits out the rest within its lock wait.
    const holder = await holdRowKey(importer, job.id, 3_000);
    const started = Date.now();
    try {
      await expect(
        withSettings({ logger: log, now: () => readings.shift() ?? 0 }, () =>
          runWaiting(importer, commitImportBatch, { entityId: 1, jobId: job.id }, '10s'),
        ),
      ).resolves.toMatchObject({ state: 'committed', committedRows: 1 });
    } finally {
      await holder.done;
    }
    // It waited for the claim to be taken back, past the one-second cut-off, within the lock wait.
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_500);
    expect(Date.now() - started).toBeLessThan(9_000);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({
      event: 'imports.batch_row_by_row',
      fields: { reason: 'database_57014' },
    });
  });
});
