import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type ConfirmSalesOrderDto,
  type Principal,
  type QuoteDto,
  type SalesOrderDto,
} from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  createTestTeam,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { updateAccount } from '../../src/commands/crm/customer';
import { mergeLeads } from '../../src/commands/crm/merges';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { setAccountTier } from '../../src/commands/crm/set-account-tier';
import { rollbackImportJob } from '../../src/commands/imports/rollback-job';
import { acceptQuote } from '../../src/commands/sales/accept-quote';
import { attachQuotePdf } from '../../src/commands/sales/attach-quote-pdf';
import { cancelSalesOrder } from '../../src/commands/sales/cancel-order';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { createSalesOrder } from '../../src/commands/sales/create-order';
import { createQuote } from '../../src/commands/sales/create-quote';
import { recordDealerOutstanding, setDealerTerms } from '../../src/commands/sales/dealer-credit';
import { sendQuote } from '../../src/commands/sales/send-quote';
import { withdrawQuote } from '../../src/commands/sales/withdraw-quote';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { homeCredit } from '../../src/queries/home/home';
import { listDealerCredit } from '../../src/queries/sales/dealer-credit';
import { getSalesOrder } from '../../src/queries/sales/list-orders';

// The sales-integrity fixes of the Phase 0–1 audit (12-10-2026): DOM-1 to DOM-5, DOM-V1 and
// ARCH-5, each through the real commands on real Postgres. Orders are made in company 4, as in
// orders.test.ts, on this file's own tier, list and items; every price, rate and limit here is a
// synthetic test value, never a client figure, and the shared rows are removed afterwards.
const E = 4;
const P = '01990000-0000-7000-8000-000000b7';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = {
  tier: fixed(0x0001),
  list: fixed(0x0002),
  module: fixed(0x0003),
  rateModule: fixed(0x0004),
  priced: fixed(0x0005),
};

let teamId: string;
let lc: Principal;
let stl: Principal;
let gm: Principal;
let exec: Principal;
let accounts: Principal;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** Removes this file's orders, credit entries, quotes and the shared rows they name. */
async function removeRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const orders = tx`select id from sales_orders where price_list_id = ${ids.list}`;
      await tx`alter table commission_accruals disable trigger commission_accruals_guard`;
      await tx`delete from commission_accruals where sales_order_id in (${orders})`;
      await tx`alter table commission_accruals enable trigger commission_accruals_guard`;
      await tx`alter table sales_order_lines disable trigger sales_order_lines_append_only`;
      await tx`delete from sales_order_lines where sales_order_id in (${orders})`;
      await tx`alter table sales_order_lines enable trigger sales_order_lines_append_only`;
      await tx`delete from sales_orders where price_list_id = ${ids.list}`;
      const dealers = tx`select id from accounts where tier_id = ${ids.tier} and type = 'dealer'`;
      await tx`alter table dealer_terms disable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding disable trigger dealer_outstanding_append_only`;
      await tx`delete from dealer_terms where account_id in (${dealers})`;
      await tx`delete from dealer_outstanding where account_id in (${dealers})`;
      await tx`alter table dealer_terms enable trigger dealer_terms_append_only`;
      await tx`alter table dealer_outstanding enable trigger dealer_outstanding_append_only`;
      await tx`alter table quote_lines disable trigger quote_lines_append_only`;
      await tx`alter table quote_versions disable trigger quote_versions_append_only`;
      const quotes = tx`select id from quotes where price_list_id = ${ids.list}`;
      await tx`delete from quote_versions where quote_id in (${quotes})`;
      await tx`delete from quote_lines where quote_id in (${quotes})`;
      await tx`update quotes set withdrawn_for_id = null, withdrawn_reason = 'test cleanup'
                where price_list_id = ${ids.list} and withdrawn_for_id is not null`;
      await tx`delete from quotes where price_list_id = ${ids.list}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
      await tx`delete from tax_rates where id = ${ids.rateModule}`;
    }),
  );
}

beforeAll(async () => {
  await removeRows();
  teamId = await createTestTeam(E, 'integrity team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId });
  stl = await createTestPrincipal('sales_team_lead', [E], { teamId });
  gm = await createTestPrincipal('general_manager', [E]);
  exec = await createTestPrincipal('executive');
  accounts = await createTestPrincipal('accounts', [E]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${ids.tier}, 't_integrity_test', 'Integrity test tier')
        on conflict (id) do update set is_active = true, archived_at = null`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.module}, 'IT-MODULE', 'integrity test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })})
        on conflict (id) do nothing`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
        values (${ids.list}, ${ids.tier}, ${E}, 1, '2026-04-01', ${exec.id}, now())
        on conflict (id) do update set entity_id = ${E}, archived_at = null, approved_by = ${exec.id}, approved_at = now()`;
      await tx`alter table price_list_items disable trigger price_list_items_log_change`;
      await tx`delete from price_list_items where price_list_id = ${ids.list}`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price) values
        (${ids.priced}, ${ids.list}, ${ids.module}, 12000.00)`;
      await tx`alter table price_list_items enable trigger price_list_items_log_change`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref) values
        (${ids.rateModule}, ${ids.module}, 12.00, '2026-04-01', 'integrity test')`;
    }),
  );
});

afterAll(async () => {
  await removeRows();
  await asMigrator(async (m) => {
    await m`update price_lists set archived_at = now() where id = ${ids.list}`;
    await m`update price_tiers set is_active = false, archived_at = now() where id = ${ids.tier}`;
  });
  await closeDb();
});

function run<T>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

/** A refusal's code and catalogue reason. */
const refused = (code: string, reason: string) => ({ code, details: { reason } });

const phone = () => `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** A sized household rooftop lead owned by the LC, its customer on the test tier. */
async function sizedLead(): Promise<{ id: string; accountId: string }> {
  const lead = await run<{ id: string; account: { id: string } }>(lc, createLead, {
    entityId: E,
    pipelineKey: 'residential_rooftop',
    contact: { name: 'Integrity test customer', phone: phone() },
    account: { type: 'household' },
    site: { type: 'rooftop', village: 'Integrity test village' },
  });
  await run(exec, setAccountTier, { entityId: E, accountId: lead.account.id, tierId: ids.tier });
  await run(lc, recordSizing, {
    entityId: E,
    opportunityId: lead.id,
    sizing: {
      kind: 'rooftop',
      inputs: { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
    },
  });
  return { id: lead.id, accountId: lead.account.id };
}

/** A ready file of the company, as the upload's checks leave one. */
async function readyFile(purpose: 'quote_pdf' | 'signed_quote' | 'import', by = lc.id) {
  const id = newId();
  const type = purpose === 'quote_pdf' ? 'application/pdf' : 'image/jpeg';
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${id}, ${E}, ${purpose}, 'local', ${`${String(E)}/${purpose}/${id}`}, 'file',
                     ${type}, 10, ${'c'.repeat(64)}, 'ready',
                     ${purpose === 'quote_pdf' ? SYSTEM_WORKERS_PRINCIPAL_ID : by})`,
  );
  return id;
}

/** A draft quote of `modules` modules for the lead. */
function draftQuote(leadId: string, modules = 5): Promise<QuoteDto> {
  return run<QuoteDto>(lc, createQuote, {
    entityId: E,
    opportunityId: leadId,
    lines: [{ itemId: ids.module, qty: String(modules) }],
  });
}

/** A quote of the lead, rendered and sent. */
async function sentQuote(leadId: string, modules = 5): Promise<QuoteDto> {
  const quote = await draftQuote(leadId, modules);
  const pdf = await readyFile('quote_pdf');
  await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId: pdf });
  return run<QuoteDto>(lc, sendQuote, { entityId: E, quoteId: quote.id });
}

async function accept(quoteId: string): Promise<QuoteDto> {
  return run<QuoteDto>(lc, acceptQuote, {
    entityId: E,
    quoteId,
    signedFileId: await readyFile('signed_quote'),
  });
}

/** A dealer of company 4 on the test tier, its relationship owned by the LC. */
async function newDealer(createdBy = lc.id): Promise<string> {
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, tier_id, created_by)
        values (${id}, 'dealer', 'Integrity test dealer', ${ids.tier}, ${createdBy})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${id}, ${E}, ${lc.id}, ${teamId}, ${createdBy})`;
    }),
  );
  return id;
}

function dealerOrder(accountId: string, modules = 2): Promise<SalesOrderDto> {
  return run<SalesOrderDto>(lc, createSalesOrder, {
    entityId: E,
    accountId,
    lines: [{ itemId: ids.module, qty: String(modules) }],
  });
}

function confirm(orderId: string): Promise<ConfirmSalesOrderDto> {
  return run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, { entityId: E, orderId });
}

async function typeOf(accountId: string): Promise<string | undefined> {
  const rows = await asMigrator(
    (m) => m<{ type: string }[]>`select type from accounts where id = ${accountId}`,
  );
  return rows[0]?.type;
}

describe("a customer's type and the dealer credit check (DOM-1)", () => {
  it('is changed to or from dealer only by a holder of sales.credit.write, in the command', async () => {
    const dealer = await newDealer();
    const { accountId: household } = await sizedLead();
    for (const who of [lc, gm]) {
      await expect(
        run(who, updateAccount, { entityId: E, accountId: dealer, type: 'business' }),
      ).rejects.toMatchObject(refused('forbidden', 'account_type_needs_credit'));
      await expect(
        run(who, updateAccount, { entityId: E, accountId: household, type: 'dealer' }),
      ).rejects.toMatchObject(refused('forbidden', 'account_type_needs_credit'));
    }
    expect(await typeOf(dealer)).toBe('dealer');
    expect(await typeOf(household)).toBe('household');
    // The rest of the customer stays theirs to change, and a type that leaves dealers alone too.
    await run(lc, updateAccount, { entityId: E, accountId: dealer, name: 'Integrity renamed' });
    await run(lc, updateAccount, { entityId: E, accountId: household, type: 'farm' });
    expect(await typeOf(household)).toBe('farm');
    // The Executive holds sales.credit.write for every company.
    await run(exec, updateAccount, { entityId: E, accountId: dealer, type: 'business' });
    expect(await typeOf(dealer)).toBe('business');
  });

  it('is refused by the database to a request without sales.credit.write, whatever the path', async () => {
    const dealer = await newDealer();
    const write = (who: Principal, type: string) =>
      asPrincipal(who, ({ tx }) =>
        tx.execute(sql`update accounts set type = ${type} where id = ${dealer}`),
      );
    await expect(write(lc, 'business')).rejects.toMatchObject({
      cause: { code: '42501' },
    });
    expect(await typeOf(dealer)).toBe('dealer');
    await write(exec, 'business');
    expect(await typeOf(dealer)).toBe('business');
    await write(exec, 'dealer');
  });

  it("keeps the customer's type on the order, so a change between hold and confirm skips nothing", async () => {
    const dealer = await newDealer();
    const order = await dealerOrder(dealer);
    expect(order.accountType).toBe('dealer');
    // No limit set: the check fails closed and holds the order.
    expect(await confirm(order.id)).toMatchObject({
      outcome: 'held',
      order: { creditHold: { reason: 'credit_limit_missing' } },
    });
    await run(exec, updateAccount, { entityId: E, accountId: dealer, type: 'business' });
    const again = await confirm(order.id);
    expect(again).toMatchObject({
      outcome: 'held',
      order: { state: 'draft', accountType: 'dealer' },
    });
    const [row] = await asMigrator(
      (m) => m<{ account_type: string; state: string; credit_release_by: string | null }[]>`
        select account_type, state, credit_release_by from sales_orders where id = ${order.id}`,
    );
    expect(row).toEqual({ account_type: 'dealer', state: 'draft', credit_release_by: null });
  });

  it('a quote-less order made while the customer was a dealer is checked after the type changes back', async () => {
    const { id: leadId, accountId } = await sizedLead();
    await expect(dealerOrder(accountId)).rejects.toMatchObject(
      refused('conflict', 'order_needs_accepted_quote'),
    );
    await run(exec, updateAccount, { entityId: E, accountId, type: 'dealer' });
    const order = await dealerOrder(accountId);
    await run(exec, updateAccount, { entityId: E, accountId, type: 'household' });
    expect(await confirm(order.id)).toMatchObject({
      outcome: 'held',
      order: { accountType: 'dealer', creditHold: { reason: 'credit_limit_missing' } },
    });
    const [lead] = await asMigrator(
      (m) => m<{ state: string }[]>`select state from opportunities where id = ${leadId}`,
    );
    expect(lead?.state).toBe('open');
  });

  it("refuses an order whose kept type is not the customer's, in the database", async () => {
    const dealer = await newDealer();
    const insert = (accountType: string) =>
      asPrincipal(lc, ({ tx }) =>
        tx.execute(sql`
          insert into sales_orders (id, entity_id, so_no, fy, account_id, account_type, tier_id,
            price_list_id, place_of_supply_state, supply_kind, subtotal, cgst, sgst, igst,
            tax_total, round_off, grand_total, created_by)
          values (${newId()}, ${E}, ${`IT/${newId()}`}, '2026-27', ${dealer}, ${accountType},
            ${ids.tier}, ${ids.list}, '08', 'intra', 0, 0, 0, 0, 0, 0, 0, ${lc.id})`),
      );
    await expect(insert('household')).rejects.toMatchObject({ cause: { code: '42501' } });
    await expect(insert('dealer')).resolves.toBeDefined();
  });
});

describe('one accepted quote, one order and one commission a lead (DOM-4)', () => {
  it("withdraws the lead's other draft and sent quotes when one is accepted, naming it", async () => {
    const { id: leadId } = await sizedLead();
    const first = await sentQuote(leadId, 5);
    const second = await sentQuote(leadId, 8);
    const draft = await draftQuote(leadId, 6);
    const accepted = await accept(first.id);
    expect(accepted.state).toBe('accepted');
    const others = await asMigrator(
      (m) => m<{ id: string; state: string; withdrawn_for_id: string | null }[]>`
        select id, state, withdrawn_for_id from quotes
         where id in (${second.id}, ${draft.id}) order by id`,
    );
    expect(others.map((q) => [q.state, q.withdrawn_for_id])).toEqual([
      ['withdrawn', first.id],
      ['withdrawn', first.id],
    ]);
    const events = await asOutboxPublisher(
      (p) => p<{ aggregate_id: string }[]>`
        select aggregate_id from outbox_events
         where type = 'sales.quote.withdrawn' and aggregate_id in (${second.id}, ${draft.id})`,
    );
    expect(events).toHaveLength(2);
    // The withdrawn quote can no longer be accepted.
    await expect(accept(second.id)).rejects.toMatchObject({ code: 'conflict' });
    // Nor can a quote made after the acceptance: the lead has its sale.
    const later = await sentQuote(leadId, 7);
    await expect(accept(later.id)).rejects.toMatchObject(
      refused('conflict', 'quote_lead_already_accepted'),
    );
    const [counts] = await asMigrator(
      (m) => m<{ accepted: number; orders: number }[]>`
        select (select count(*)::int from quotes where opportunity_id = ${leadId} and state = 'accepted') as accepted,
               (select count(*)::int from sales_orders where opportunity_id = ${leadId}) as orders`,
    );
    expect(counts).toEqual({ accepted: 1, orders: 1 });
  });

  it('gives one accepted quote and one order when two quotes are accepted at once', async () => {
    const { id: leadId } = await sizedLead();
    const one = await sentQuote(leadId, 5);
    const two = await sentQuote(leadId, 8);
    const signed = [await readyFile('signed_quote'), await readyFile('signed_quote')];
    const outcomes = await Promise.allSettled(
      [one, two].map((q, i) =>
        run<QuoteDto>(lc, acceptQuote, { entityId: E, quoteId: q.id, signedFileId: signed[i] }),
      ),
    );
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    const [counts] = await asMigrator(
      (m) => m<{ accepted: number; orders: number }[]>`
        select (select count(*)::int from quotes where opportunity_id = ${leadId} and state = 'accepted') as accepted,
               (select count(*)::int from sales_orders where opportunity_id = ${leadId}) as orders`,
    );
    expect(counts).toEqual({ accepted: 1, orders: 1 });
  });

  it('holds one accepted quote a lead in the database, whatever writes it', async () => {
    const { id: leadId } = await sizedLead();
    const first = await sentQuote(leadId, 5);
    const second = await sentQuote(leadId, 8);
    await accept(first.id);
    const file = await readyFile('signed_quote');
    await expect(
      asMigrator(
        (m) => m`update quotes set state = 'accepted', withdrawn_for_id = null,
                   accepted_via = 'signed_upload', signed_file_id = ${file}
                  where id = ${second.id}`,
      ),
    ).rejects.toMatchObject({ constraint_name: 'quotes_opportunity_accepted_unique' });
  });
});

describe('a lead merge never strands a sale (DOM-2)', () => {
  /** A second open lead of the customer, of the same pipeline, as an import or old enquiry leaves one. */
  async function twinLead(leadId: string): Promise<string> {
    const id = newId();
    await asMigrator(
      (
        m,
      ) => m`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
               select ${id}, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by
                 from opportunities where id = ${leadId}`,
    );
    return id;
  }
  const merge = (kept: string, merged: string) =>
    run(stl, mergeLeads, { entityId: E, keptOpportunityId: kept, mergedOpportunityId: merged });

  it('refuses to merge away a lead with a live quote, and merges the other way', async () => {
    const { id: quoted } = await sizedLead();
    const quote = await sentQuote(quoted);
    const twin = await twinLead(quoted);
    await expect(merge(twin, quoted)).rejects.toMatchObject(
      refused('conflict', 'merge_leads_has_sale'),
    );
    await merge(quoted, twin);
    const [lead] = await asMigrator(
      (m) => m<{ archived: boolean }[]>`
        select archived_at is not null as archived from opportunities where id = ${quoted}`,
    );
    expect(lead?.archived).toBe(false);
    // The quote is still the lead's to accept.
    expect((await accept(quote.id)).state).toBe('accepted');
  });

  it('refuses to merge away a lead with an order, and lets a withdrawn quote go', async () => {
    const { id: sold } = await sizedLead();
    await accept((await sentQuote(sold)).id);
    await expect(merge(await twinLead(sold), sold)).rejects.toMatchObject(
      refused('conflict', 'merge_leads_has_sale'),
    );
    const { id: dropped } = await sizedLead();
    const quote = await sentQuote(dropped);
    await run(lc, withdrawQuote, {
      entityId: E,
      quoteId: quote.id,
      reason: 'Customer chose a pump',
    });
    const twin = await twinLead(dropped);
    await merge(twin, dropped);
  });
});

describe('an import rollback keeps what has since been sold (DOM-3, DOM-V1)', () => {
  /** A committed job of `kind` by `importer` whose rows made `records`, as the commit leaves one. */
  async function committedJob(
    kind: 'leads' | 'accounts',
    importer: Principal,
    records: readonly string[],
  ): Promise<string> {
    const jobId = newId();
    const fileId = await readyFile('import', importer.id);
    const type = kind === 'leads' ? 'opportunity' : 'account';
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into import_jobs (id, entity_id, kind, file_id, format, columns_json, state,
                   total_rows, valid_rows, committed_rows, created_by)
                 values (${jobId}, ${E}, ${kind}, ${fileId}, 'csv', '[]'::jsonb, 'committed',
                   ${records.length}, ${records.length}, ${records.length}, ${importer.id})`;
        for (const [i, id] of records.entries()) {
          await tx`insert into import_rows (job_id, entity_id, row_no, raw_json, state, created_type,
                     created_id, committed_batch, created_by)
                   values (${jobId}, ${E}, ${i + 1}, '{}'::jsonb, 'committed', ${type}, ${id}, 1,
                     ${importer.id})`;
        }
      }),
    );
    return jobId;
  }

  async function rollbackCounts(jobId: string) {
    const done = await run<{ state: string }>(gm, rollbackImportJob, { entityId: E, jobId });
    expect(done.state).toBe('rolled_back');
    const [row] = await asMigrator(
      (m) => m<{ after_json: { archived: number; kept: number } }[]>`
        select after_json from audit_logs
         where aggregate_id = ${jobId} and command = 'imports.job.rollback'`,
    );
    return row?.after_json;
  }

  const archived = async (table: 'opportunities' | 'accounts', id: string) => {
    const rows = await asMigrator((m) =>
      table === 'opportunities'
        ? m<
            { a: boolean }[]
          >`select archived_at is not null as a from opportunities where id = ${id}`
        : m<{ a: boolean }[]>`select archived_at is not null as a from accounts where id = ${id}`,
    );
    return rows[0]?.a;
  };

  it('keeps an imported lead that has since been quoted and accepted, and counts it kept', async () => {
    // The LC is the importer here: the leads are theirs, and only the quote marks one in use.
    const { id: sold } = await sizedLead();
    const quote = await sentQuote(sold);
    const order = (await accept(quote.id)).orderId ?? '';
    const { id: idle } = await sizedLead();
    const job = await committedJob('leads', lc, [sold, idle]);
    expect(await rollbackCounts(job)).toMatchObject({ archived: 1, kept: 1 });
    expect(await archived('opportunities', sold)).toBe(false);
    expect(await archived('opportunities', idle)).toBe(true);
    // The sale goes on: the order of the kept lead confirms.
    expect((await confirm(order)).outcome).toBe('confirmed');
  });

  it('keeps an imported dealer that has since got credit terms or an order', async () => {
    const withTerms = await newDealer(gm.id);
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: withTerms,
      creditLimit: '5000000.00',
      creditDays: 30,
    });
    const withOrder = await newDealer(gm.id);
    await dealerOrder(withOrder);
    const idle = await newDealer(gm.id);
    const job = await committedJob('accounts', gm, [withTerms, withOrder, idle]);
    expect(await rollbackCounts(job)).toMatchObject({ archived: 1, kept: 2 });
    expect(await archived('accounts', withTerms)).toBe(false);
    expect(await archived('accounts', withOrder)).toBe(false);
    expect(await archived('accounts', idle)).toBe(true);
    await expect(dealerOrder(withTerms)).resolves.toMatchObject({ accountType: 'dealer' });
  });
});

describe('a cancelled order is not held for credit (DOM-5)', () => {
  it('clears the hold on cancel, so neither the order nor Accounts’ home counts it', async () => {
    const heldNow = async () => {
      const rows = await asPrincipal(accounts, (context) => homeCredit(context));
      return rows.find((r) => r.entityId === E)?.heldOrders ?? 0;
    };
    const before = await heldNow();
    const dealer = await newDealer();
    const order = await dealerOrder(dealer);
    expect((await confirm(order.id)).outcome).toBe('held');
    expect(await heldNow()).toBe(before + 1);
    const cancelled = await run<SalesOrderDto>(gm, cancelSalesOrder, {
      entityId: E,
      orderId: order.id,
      reason: 'Dealer withdrew the order',
    });
    expect(cancelled).toMatchObject({ state: 'cancelled', creditHold: null });
    expect(await heldNow()).toBe(before);
    const [row] = await asMigrator(
      (m) => m<{ held: boolean; reason: string | null }[]>`
        select credit_held_at is not null as held, credit_hold_reason as reason
          from sales_orders where id = ${order.id}`,
    );
    expect(row).toEqual({ held: false, reason: null });
    const read = await asPrincipal(lc, (context) =>
      getSalesOrder(context, { entityId: E, orderId: order.id }),
    );
    expect(read.creditHold).toBeNull();
  });
});

describe('dealer exposure is worked out in one place (ARCH-5)', () => {
  it('Accounts’ home and /dealer-credit read a dealer as the confirmation does', async () => {
    const overNow = async () => {
      const rows = await asPrincipal(accounts, (context) => homeCredit(context));
      return rows.find((r) => r.entityId === E);
    };
    const before = await overNow();
    const dealer = await newDealer();
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: dealer,
      creditLimit: '100000.00',
      creditDays: 30,
    });
    await run(accounts, recordDealerOutstanding, {
      entityId: E,
      accountId: dealer,
      outstanding: '100000.01',
      oldestUnpaidInvoiceDate: istCalendarDate(new Date(Date.now() - 31 * 86_400_000)),
      oldestUnpaidInvoiceNo: 'IT/SI/0001',
      asOf: istCalendarDate(new Date()),
    });
    const after = await overNow();
    expect(after?.dealersOverLimit).toBe((before?.dealersOverLimit ?? 0) + 1);
    expect(after?.overdueInvoices).toBe((before?.overdueInvoices ?? 0) + 1);
    let cursor: string | undefined;
    let row;
    do {
      const page = await asPrincipal(accounts, (context) =>
        listDealerCredit(context, { entityId: E, limit: 100, cursor }),
      );
      row = page.items.find((r) => r.accountId === dealer);
      cursor = page.nextCursor ?? undefined;
    } while (row === undefined && cursor !== undefined);
    expect(row).toMatchObject({ exposure: '100000.01', oldestUnpaidAgeDays: 31 });
    // The confirmation holds a new order on the same reading.
    const order = await dealerOrder(dealer, 1);
    expect(await confirm(order.id)).toMatchObject({
      outcome: 'held',
      order: { creditHold: { reason: 'credit_limit_exceeded' } },
    });
  });
});
