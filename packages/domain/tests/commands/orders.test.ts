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
import { sql as sqlTag } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { failureOf, runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { setAccountTier } from '../../src/commands/crm/set-account-tier';
import { createTask } from '../../src/commands/crm/tasks';
import { acceptQuote } from '../../src/commands/sales/accept-quote';
import { attachQuotePdf } from '../../src/commands/sales/attach-quote-pdf';
import { cancelSalesOrder } from '../../src/commands/sales/cancel-order';
import { confirmSalesOrder } from '../../src/commands/sales/confirm-order';
import { createSalesOrder } from '../../src/commands/sales/create-order';
import { createQuote } from '../../src/commands/sales/create-quote';
import { recordDealerOutstanding, setDealerTerms } from '../../src/commands/sales/dealer-credit';
import { releaseCredit } from '../../src/commands/sales/release-credit';
import { sendQuote } from '../../src/commands/sales/send-quote';
import { istCalendarDate } from '../../src/numbering/financial-year';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { dealerCreditHistory, listDealerCredit } from '../../src/queries/sales/dealer-credit';
import {
  accountSalesOrders,
  getSalesOrder,
  listSalesOrders,
} from '../../src/queries/sales/list-orders';
import { loadSalesOrderBuilder, previewSalesOrder } from '../../src/queries/sales/order-facts';
import { commissionAmount } from '../../src/sales/commission';

// Orders are made in company 3 (Agro Solar Hub), which no other command suite numbers orders in.
// Every price, rate, limit, outstanding figure and commission rule here is a synthetic test value
// made for this file, never a client figure (SALE-4, SALE-6, CRM-5); the rows it adds that other
// suites read whole (tax rates, commission rules) are removed afterwards.
const E = 3;
const P = '01990000-0000-7000-8000-000000a5';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = {
  tier: fixed(0x0001),
  list: fixed(0x0002),
  module: fixed(0x0003),
  cable: fixed(0x0004),
  rateModule: fixed(0x0005),
  rateCable: fixed(0x0006),
  priced: [fixed(0x0010), fixed(0x0011)],
  partnerPercent: fixed(0x0020),
  partnerPerKw: fixed(0x0021),
  partnerNone: fixed(0x0022),
  rulePercent: fixed(0x0030),
  rulePerKw: fixed(0x0031),
};

let teamId: string;
let lc: Principal;
let otherLc: Principal;
let cc: Principal;
let exec: Principal;
let gm: Principal;
let gm1: Principal;
let accounts: Principal;
let accounts1: Principal;
const workers = (): Principal => ({
  ...principalFor('system:workers', [E]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** Removes this file's orders, commission, credit entries, quotes and the shared rows they name. */
async function removeOrderRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      const orders = tx`select id from sales_orders where price_list_id = ${ids.list}`;
      await tx`alter table commission_accruals disable trigger commission_accruals_guard`;
      await tx`delete from commission_accruals where sales_order_id in (${orders})`;
      await tx`alter table commission_accruals enable trigger commission_accruals_guard`;
      await tx`delete from commission_rules where id in (${ids.rulePercent}, ${ids.rulePerKw})`;
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
      await tx`delete from quotes where price_list_id = ${ids.list}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
      await tx`delete from tax_rates where id in (${ids.rateModule}, ${ids.rateCable})`;
    }),
  );
}

beforeAll(async () => {
  await removeOrderRows();
  teamId = await createTestTeam(E, 'order team');
  const otherTeam = await createTestTeam(E, 'order other team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId });
  otherLc = await createTestPrincipal('tele_caller_lc', [E], { teamId: otherTeam });
  cc = await createTestPrincipal('tele_caller_cc', [E], { teamId });
  exec = await createTestPrincipal('executive');
  gm = await createTestPrincipal('general_manager', [E]);
  gm1 = await createTestPrincipal('general_manager', [1]);
  accounts = await createTestPrincipal('accounts', [E]);
  accounts1 = await createTestPrincipal('accounts', [1]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${ids.tier}, 't_order_test', 'Order test tier')
        on conflict (id) do update set is_active = true, archived_at = null`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.module}, 'OT-MODULE', 'order test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })}),
        (${ids.cable}, 'OT-CABLE', 'order test cable', 'cable', '8544', 'metre', false, '{}'::jsonb)
        on conflict (id) do nothing`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
        values (${ids.list}, ${ids.tier}, ${E}, 1, '2026-04-01', ${exec.id}, now())
        on conflict (id) do update set archived_at = null, approved_by = ${exec.id}, approved_at = now()`;
      await tx`alter table price_list_items disable trigger price_list_items_log_change`;
      await tx`delete from price_list_items where price_list_id = ${ids.list}`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price) values
        (${ids.priced[0] ?? ''}, ${ids.list}, ${ids.module}, 12000.00),
        (${ids.priced[1] ?? ''}, ${ids.list}, ${ids.cable}, 85.50)`;
      await tx`alter table price_list_items enable trigger price_list_items_log_change`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref) values
        (${ids.rateModule}, ${ids.module}, 12.00, '2026-04-01', 'order test'),
        (${ids.rateCable}, ${ids.cable}, 18.00, '2026-04-01', 'order test')`;
      // Three referral partners related to the company: one paid a percentage, one paid per kW,
      // one with no rule.
      for (const [partner, code] of [
        [ids.partnerPercent, 'OTPCT1'],
        [ids.partnerPerKw, 'OTKW1'],
        [ids.partnerNone, 'OTNONE1'],
      ] as const) {
        await tx`insert into accounts (id, type, name, created_by)
          values (${partner}, 'referral_partner', 'Order test partner', ${exec.id})
          on conflict (id) do nothing`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${newId()}, ${partner}, ${E}, ${exec.id}, ${exec.id})
          on conflict (account_id, entity_id) do nothing`;
        await tx`insert into referral_partners (account_id, code, created_by)
          values (${partner}, ${code}, ${exec.id}) on conflict (account_id) do nothing`;
      }
      await tx`insert into commission_rules (id, partner_id, basis, amount, effective_from, created_by) values
        (${ids.rulePercent}, ${ids.partnerPercent}, 'percent', 2.50, '2026-01-01', ${exec.id}),
        (${ids.rulePerKw}, ${ids.partnerPerKw}, 'per_kw', 1000.00, '2026-01-01', ${exec.id})`;
    }),
  );
});

afterAll(async () => {
  await removeOrderRows();
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

async function failure(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<{ code?: string | undefined; reason?: unknown; stage?: string | undefined }> {
  const error: unknown = await run(principal, command, input).then(
    () => undefined,
    (e: unknown) => e,
  );
  const e = error as { code?: string; details?: { reason?: unknown } } | undefined;
  return { code: e?.code, reason: e?.details?.reason, stage: failureOf(error)?.stage };
}

async function eventsOf(aggregateId: string): Promise<{ type: string; payload: unknown }[]> {
  const rows = await asOutboxPublisher(
    (p) => p<{ type: string; payload_json: unknown }[]>`
      select type, payload_json from outbox_events where aggregate_id = ${aggregateId}
       order by created_at, type`,
  );
  return rows.map((r) => ({ type: r.type, payload: r.payload_json }));
}

/** A sized rooftop lead of company 3 owned by the LC, its customer on the test tier. */
async function sizedLead(): Promise<{ id: string; accountId: string }> {
  const lead = await run<{ id: string; account: { id: string } }>(lc, createLead, {
    entityId: E,
    pipelineKey: 'residential_rooftop',
    contact: {
      name: 'Order test customer',
      phone: `95${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'household' },
    site: { type: 'rooftop', village: 'Order test village' },
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
async function readyFile(purpose: 'quote_pdf' | 'signed_quote', status = 'ready'): Promise<string> {
  const id = newId();
  const by = purpose === 'quote_pdf' ? SYSTEM_WORKERS_PRINCIPAL_ID : lc.id;
  const type = purpose === 'quote_pdf' ? 'application/pdf' : 'image/jpeg';
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${id}, ${E}, ${purpose}, 'local', ${`${String(E)}/${purpose}/${id}`}, 'file',
                     ${type}, 10, ${'c'.repeat(64)}, ${status}, ${by})`,
  );
  return id;
}

/** A sent quote of a sized lead, its lead optionally credited to a referral partner. */
async function sentQuote(partnerId: string | null = null): Promise<QuoteDto> {
  const lead = await sizedLead();
  if (partnerId !== null) {
    await asMigrator(
      (m) => m`update opportunities set referral_partner_id = ${partnerId} where id = ${lead.id}`,
    );
  }
  const quote = await run<QuoteDto>(lc, createQuote, {
    entityId: E,
    opportunityId: lead.id,
    lines: [
      { itemId: ids.module, qty: '5' },
      { itemId: ids.cable, qty: '10' },
    ],
  });
  const pdf = await readyFile('quote_pdf');
  await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId: pdf });
  return run<QuoteDto>(lc, sendQuote, { entityId: E, quoteId: quote.id });
}

async function acceptedOrder(partnerId: string | null = null): Promise<SalesOrderDto> {
  const quote = await sentQuote(partnerId);
  const signed = await readyFile('signed_quote');
  const accepted = await run<QuoteDto>(lc, acceptQuote, {
    entityId: E,
    quoteId: quote.id,
    signedFileId: signed,
  });
  return asPrincipal(lc, (context) =>
    getSalesOrder(context, { entityId: E, orderId: accepted.orderId ?? '' }),
  );
}

/** A dealer of company 3 on the test tier, its relationship owned by the LC. */
async function newDealer(): Promise<string> {
  const id = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, tier_id, created_by)
        values (${id}, 'dealer', 'Order test dealer', ${ids.tier}, ${lc.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${id}, ${E}, ${lc.id}, ${teamId}, ${lc.id})`;
    }),
  );
  return id;
}

/** A dealer's draft order of `modules` solar modules at ₹12,000 with 12% GST. */
function dealerOrder(accountId: string, modules: number): Promise<SalesOrderDto> {
  return run<SalesOrderDto>(lc, createSalesOrder, {
    entityId: E,
    accountId,
    lines: [{ itemId: ids.module, qty: String(modules) }],
  });
}

const today = () => istCalendarDate(new Date());
const yesterday = () => istCalendarDate(new Date(Date.now() - 86_400_000));

describe('sales.quote.accept (SAL-05, SAL-06)', () => {
  it('accepts a sent quote by its signed copy and makes the order draft with the quote’s lines', async () => {
    const quote = await sentQuote();
    const signed = await readyFile('signed_quote');
    const accepted = await run<QuoteDto>(lc, acceptQuote, {
      entityId: E,
      quoteId: quote.id,
      signedFileId: signed,
    });
    expect(accepted).toMatchObject({
      state: 'accepted',
      acceptedVia: 'signed_upload',
      signedFileId: signed,
      canAccept: false,
    });
    expect(accepted.orderNo).toMatch(/^ASH\/SO\/\d{4}-\d{2}\/\d{4,}$/);
    const order = await asPrincipal(lc, (context) =>
      getSalesOrder(context, { entityId: E, orderId: accepted.orderId ?? '' }),
    );
    expect(order).toMatchObject({
      soNo: accepted.orderNo,
      state: 'draft',
      quoteId: quote.id,
      quoteNo: quote.quoteNo,
      opportunityId: quote.opportunityId,
      accountId: quote.accountId,
      tierId: ids.tier,
      priceListId: ids.list,
      placeOfSupplyState: quote.placeOfSupplyState,
      supplyKind: quote.supplyKind,
      creditHold: null,
      canConfirm: true,
      canCancel: false,
    });
    // The order's lines and totals are the quote's, price and tax snapshot as they stood.
    expect(order.lines).toEqual(quote.lines);
    expect(order.totals).toEqual(quote.totals);
    expect((await eventsOf(quote.id)).map((e) => e.type)).toContain('sales.quote.accepted');
    expect(await eventsOf(order.id)).toEqual([
      {
        type: 'sales.order.created',
        payload: {
          v: 1,
          accountId: quote.accountId,
          quoteId: quote.id,
          opportunityId: quote.opportunityId,
          lineCount: 2,
        },
      },
    ]);
    // A quote becomes one order.
    expect(
      await failure(lc, acceptQuote, { entityId: E, quoteId: quote.id, signedFileId: signed }),
    ).toMatchObject({ code: 'conflict', reason: 'quote_transition_not_allowed' });
  });

  it('refuses a quote past its validity with the re-quote sentence, and a quote not yet sent', async () => {
    const quote = await sentQuote();
    const signed = await readyFile('signed_quote');
    await asMigrator(
      (m) => m`update quotes set valid_until = now() - interval '1 minute' where id = ${quote.id}`,
    );
    expect(
      await failure(lc, acceptQuote, { entityId: E, quoteId: quote.id, signedFileId: signed }),
    ).toMatchObject({ code: 'conflict', reason: 'quote_expired' });

    const lead = await sizedLead();
    const draft = await run<QuoteDto>(lc, createQuote, {
      entityId: E,
      opportunityId: lead.id,
      lines: [{ itemId: ids.module, qty: '1' }],
    });
    expect(
      await failure(lc, acceptQuote, { entityId: E, quoteId: draft.id, signedFileId: signed }),
    ).toMatchObject({ code: 'conflict', reason: 'quote_transition_not_allowed' });
  });

  it('needs a checked signed copy of the quote’s company', async () => {
    const quote = await sentQuote();
    const input = (signedFileId: string) => ({ entityId: E, quoteId: quote.id, signedFileId });
    expect(await failure(lc, acceptQuote, input(newId()))).toMatchObject({
      code: 'not_found',
      reason: 'signed_copy_missing',
    });
    expect(await failure(lc, acceptQuote, input(await readyFile('quote_pdf')))).toMatchObject({
      reason: 'signed_copy_missing',
    });
    expect(
      await failure(lc, acceptQuote, input(await readyFile('signed_quote', 'scanning'))),
    ).toMatchObject({ code: 'conflict', reason: 'signed_copy_checking' });
    expect(
      await failure(lc, acceptQuote, input(await readyFile('signed_quote', 'rejected'))),
    ).toMatchObject({ code: 'validation_failed', reason: 'signed_copy_refused' });
  });

  it('is denied without the permission, to a colleague and to another company', async () => {
    const quote = await sentQuote();
    const signed = await readyFile('signed_quote');
    const input = { entityId: E, quoteId: quote.id, signedFileId: signed };
    expect(await failure(cc, acceptQuote, input)).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(otherLc, acceptQuote, input)).toMatchObject({
      code: 'not_found',
      reason: 'quote_missing',
    });
    expect(await failure(gm1, acceptQuote, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(lc, acceptQuote, { ...input, entityId: 1 })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('sales.order.create (SAL-06, SAL-03)', () => {
  it('prices a dealer’s order from the live list of the dealer’s tier and taxes it by the engine', async () => {
    const dealer = await newDealer();
    const builder = await asPrincipal(lc, (context) =>
      loadSalesOrderBuilder(context, { entityId: E, accountId: dealer }),
    );
    expect(builder).toMatchObject({ tierName: 'Order test tier', priceListId: ids.list });
    expect(builder.choices.map((c) => c.sku)).toEqual(['OT-CABLE', 'OT-MODULE']);
    const input = { entityId: E, accountId: dealer, lines: [{ itemId: ids.module, qty: '2' }] };
    const preview = await asPrincipal(lc, (context) => previewSalesOrder(context, input));
    const order = await run<SalesOrderDto>(lc, createSalesOrder, input);
    expect(order).toMatchObject({
      state: 'draft',
      quoteId: null,
      opportunityId: null,
      accountId: dealer,
      accountType: 'dealer',
      tierId: ids.tier,
      priceListId: ids.list,
      placeOfSupplyState: '08',
      supplyKind: 'intra',
    });
    expect(order.soNo).toMatch(/^ASH\/SO\/\d{4}-\d{2}\/\d{4,}$/);
    // 2 modules at 12,000 = 24,000 at 12%.
    expect(order.lines.map((l) => [l.sku, l.unitPrice, l.taxableValue, l.cgst, l.sgst])).toEqual([
      ['OT-MODULE', '12000.00', '24000.00', '1440.00', '1440.00'],
    ]);
    expect(order.totals).toEqual(preview.totals);
    expect(order.totals.grandTotal).toBe('26880.00');
  });

  it('refuses a price in the input, a customer who is not a dealer, and an item off the list', async () => {
    const dealer = await newDealer();
    expect(
      await failure(lc, createSalesOrder, {
        entityId: E,
        accountId: dealer,
        lines: [{ itemId: ids.module, qty: '1', unitPrice: '1.00' }],
      }),
    ).toMatchObject({ code: 'validation_failed' });
    const lead = await sizedLead();
    expect(
      await failure(lc, createSalesOrder, {
        entityId: E,
        accountId: lead.accountId,
        lines: [{ itemId: ids.module, qty: '1' }],
      }),
    ).toMatchObject({ code: 'conflict', reason: 'order_needs_accepted_quote' });
    expect(
      await failure(lc, createSalesOrder, {
        entityId: E,
        accountId: dealer,
        lines: [{ itemId: newId(), qty: '1' }],
      }),
    ).toMatchObject({ reason: 'order_item_missing' });
  });

  it('is denied without the permission, to a colleague and to another company', async () => {
    const dealer = await newDealer();
    const input = { entityId: E, accountId: dealer, lines: [{ itemId: ids.module, qty: '1' }] };
    expect(await failure(cc, createSalesOrder, input)).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(otherLc, createSalesOrder, input)).toMatchObject({
      code: 'not_found',
      reason: 'account_missing',
    });
    expect(await failure(gm1, createSalesOrder, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(lc, createSalesOrder, { ...input, entityId: 1 })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('sales.order.confirm (SAL-06, SAL-07)', () => {
  it('confirms an order of a lead, wins the lead and ends its open callbacks', async () => {
    const order = await acceptedOrder();
    const lead = order.opportunityId ?? '';
    const callback = await run<{ id: string }>(lc, createTask, {
      entityId: E,
      opportunityId: lead,
      kind: 'callback',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const result = await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, {
      entityId: E,
      orderId: order.id,
    });
    expect(result.outcome).toBe('confirmed');
    expect(result.order).toMatchObject({ state: 'confirmed', canConfirm: false, creditHold: null });
    expect(result.order.confirmedAt).not.toBeNull();
    const [row] = await asMigrator(
      (m) => m<{ state: string; task: string }[]>`
        select o.state, t.state as task from opportunities o, tasks t
         where o.id = ${lead} and t.id = ${callback.id}`,
    );
    expect(row).toEqual({ state: 'won', task: 'cancelled' });
    const events = await eventsOf(order.id);
    expect(events.map((e) => e.type)).toEqual(['sales.order.created', 'sales.order.confirmed']);
    expect(events[1]?.payload).toEqual({
      v: 1,
      accountId: order.accountId,
      opportunityId: lead,
      released: false,
    });
    expect((await eventsOf(lead)).map((e) => e.type)).toContain('crm.opportunity.won');
  });

  it('holds a dealer order over the limit with the limit and the exposure, and keeps the hold', async () => {
    const dealer = await newDealer();
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: dealer,
      creditLimit: '50000.00',
      creditDays: 30,
    });
    await run(accounts, recordDealerOutstanding, {
      entityId: E,
      accountId: dealer,
      outstanding: '30000.00',
      oldestOverdueDays: null,
      oldestOverdueInvoiceNo: null,
      asOf: yesterday(),
    });
    const order = await dealerOrder(dealer, 1); // 13,440.00
    expect(
      (await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, { entityId: E, orderId: order.id }))
        .outcome,
    ).toBe('confirmed');
    // 30,000 outstanding + 13,440 confirmed since + 13,440 now = 56,880 over 50,000.
    const second = await dealerOrder(dealer, 1);
    const held = await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, {
      entityId: E,
      orderId: second.id,
    });
    expect(held.outcome).toBe('held');
    expect(held.order).toMatchObject({
      state: 'draft',
      creditHold: {
        reason: 'credit_limit_exceeded',
        limit: '50000.00',
        exposure: '56880.00',
        invoiceNo: null,
      },
      canRelease: false,
    });
    const events = await eventsOf(second.id);
    expect(events.at(-1)).toEqual({
      type: 'sales.order.credit_held',
      payload: { v: 1, accountId: dealer, createdBy: lc.id, reason: 'credit_limit_exceeded' },
    });
    // Accounts' figure of today includes the first order: confirmed orders count only after the
    // entry's date, so 36,000 + 13,440 = 49,440 now passes.
    await run(accounts, recordDealerOutstanding, {
      entityId: E,
      accountId: dealer,
      outstanding: '36000.00',
      oldestOverdueDays: null,
      oldestOverdueInvoiceNo: null,
      asOf: today(),
    });
    const passed = await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, {
      entityId: E,
      orderId: second.id,
    });
    expect(passed).toMatchObject({ outcome: 'confirmed', order: { creditHold: null } });
  });

  it('holds a dealer with no limit set, and names the overdue invoice', async () => {
    const bare = await newDealer();
    const order = await dealerOrder(bare, 1);
    expect(
      await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, { entityId: E, orderId: order.id }),
    ).toMatchObject({ outcome: 'held', order: { creditHold: { reason: 'credit_limit_missing' } } });

    const late = await newDealer();
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: late,
      creditLimit: '1000000.00',
      creditDays: 30,
    });
    await run(accounts, recordDealerOutstanding, {
      entityId: E,
      accountId: late,
      outstanding: '1000.00',
      oldestOverdueDays: 45,
      oldestOverdueInvoiceNo: 'ASH/SI/TEST/0001',
      asOf: today(),
    });
    const overdue = await dealerOrder(late, 1);
    expect(
      await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, { entityId: E, orderId: overdue.id }),
    ).toMatchObject({
      outcome: 'held',
      order: {
        creditHold: {
          reason: 'credit_overdue',
          invoiceNo: 'ASH/SI/TEST/0001',
          overdueDays: 45,
          creditDays: 30,
        },
      },
    });
  });

  it('is released once by the Executive with a reason, and then confirmed', async () => {
    const dealer = await newDealer();
    const order = await dealerOrder(dealer, 1);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: order.id });
    const release = { entityId: E, orderId: order.id, reason: 'Paid by cheque this morning' };
    // Only the Executive releases, and only with a reason.
    for (const who of [lc, gm, accounts]) {
      expect(await failure(who, releaseCredit, release)).toMatchObject({
        code: 'forbidden',
        stage: 'guard',
      });
    }
    expect(await failure(exec, releaseCredit, { ...release, reason: ' ' })).toMatchObject({
      code: 'validation_failed',
    });
    const released = await run<SalesOrderDto>(exec, releaseCredit, release);
    expect(released).toMatchObject({
      state: 'draft',
      creditHold: null,
      creditRelease: { reason: 'Paid by cheque this morning' },
    });
    // A release needs a hold.
    expect(await failure(exec, releaseCredit, release)).toMatchObject({
      code: 'conflict',
      reason: 'order_not_held',
    });
    const confirmed = await run<ConfirmSalesOrderDto>(lc, confirmSalesOrder, {
      entityId: E,
      orderId: order.id,
    });
    expect(confirmed.outcome).toBe('confirmed');
    const events = await eventsOf(order.id);
    expect(events.map((e) => e.type)).toEqual([
      'sales.order.created',
      'sales.order.credit_held',
      'sales.order.credit_released',
      'sales.order.confirmed',
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ released: true });
    const [audited] = await asMigrator(
      (m) => m<{ n: number }[]>`
        select count(*)::int as n from audit_logs
         where command = 'sales.credit.release' and outcome = 'ok' and actor_principal_id = ${exec.id}
           and aggregate_id = ${order.id}`,
    );
    expect(audited?.n).toBe(1);
  });

  it('is denied without the permission, to a colleague and to another company', async () => {
    const dealer = await newDealer();
    const order = await dealerOrder(dealer, 1);
    const input = { entityId: E, orderId: order.id };
    expect(await failure(cc, confirmSalesOrder, input)).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(otherLc, confirmSalesOrder, input)).toMatchObject({
      code: 'not_found',
      reason: 'order_missing',
    });
    expect(await failure(gm1, confirmSalesOrder, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(lc, confirmSalesOrder, { ...input, entityId: 1 })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('the referral commission (CRM-09)', () => {
  async function accrualOf(orderId: string) {
    const [row] = await asMigrator(
      (m) => m<
        {
          partner_id: string;
          commission_rule_id: string;
          basis: string;
          rate: string;
          measure: string;
          amount: string;
          state: string;
          created_by: string;
        }[]
      >`select partner_id, commission_rule_id, basis, rate, measure, amount, state, created_by
          from commission_accruals where sales_order_id = ${orderId}`,
    );
    return row;
  }

  it('accrues a percentage of the order’s taxable value by the partner’s rule in force', async () => {
    const order = await acceptedOrder(ids.partnerPercent);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: order.id });
    // 2.5% of 60,855.00 = 1,521.375, rounded half-up.
    expect(await accrualOf(order.id)).toMatchObject({
      partner_id: ids.partnerPercent,
      commission_rule_id: ids.rulePercent,
      basis: 'percent',
      rate: '2.50',
      amount: '1521.38',
      state: 'accrued',
      created_by: lc.id,
    });
    expect(order.totals.subtotal).toBe('60855.00');
    // The person confirming cannot read the commission; the Executive and Accounts can.
    const seen = async (who: Principal) =>
      asPrincipal(who, async ({ tx }) => {
        const rows = (await tx.execute(sqlCount(order.id))) as unknown as { n: number }[];
        return rows[0]?.n;
      });
    expect(await seen(lc)).toBe(0);
    expect(await seen(exec)).toBe(1);
    expect(await seen(accounts)).toBe(1);
  });

  it('accrues per kW of the lead’s sizing, and nothing for a partner with no rule', async () => {
    const order = await acceptedOrder(ids.partnerPerKw);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: order.id });
    const accrual = await accrualOf(order.id);
    expect(accrual).toMatchObject({ basis: 'per_kw', rate: '1000.00', state: 'accrued' });
    expect(Number(accrual?.measure)).toBeGreaterThan(0);
    expect(accrual?.amount).toBe(
      commissionAmount({
        basis: 'per_kw',
        rate: '1000.00',
        taxableValue: '0.00',
        kw: Number(accrual?.measure),
        hp: null,
      })?.amount,
    );

    const none = await acceptedOrder(ids.partnerNone);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: none.id });
    expect(await accrualOf(none.id)).toBeUndefined();
  });

  it('is cancelled with its order by the General Manager; the lead stays won', async () => {
    const order = await acceptedOrder(ids.partnerPercent);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: order.id });
    const input = { entityId: E, orderId: order.id, reason: 'The customer changed their mind' };
    expect(await failure(lc, cancelSalesOrder, input)).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(gm, cancelSalesOrder, { ...input, reason: ' ' })).toMatchObject({
      code: 'validation_failed',
    });
    expect(await failure(gm1, cancelSalesOrder, input)).toMatchObject({ code: 'forbidden' });
    const cancelled = await run<SalesOrderDto>(gm, cancelSalesOrder, input);
    expect(cancelled).toMatchObject({
      state: 'cancelled',
      cancelReason: 'The customer changed their mind',
      canCancel: false,
    });
    expect(await accrualOf(order.id)).toMatchObject({ state: 'cancelled' });
    const [lead] = await asMigrator(
      (m) =>
        m<{ state: string }[]>`select state from opportunities where id = ${order.opportunityId}`,
    );
    expect(lead?.state).toBe('won');
    expect((await eventsOf(order.id)).at(-1)).toEqual({
      type: 'sales.order.cancelled',
      payload: {
        v: 1,
        accountId: order.accountId,
        opportunityId: order.opportunityId,
        fromState: 'confirmed',
      },
    });
  });
});

describe('dealer terms and outstanding (SALE-4, SALE-6)', () => {
  it('Accounts enter terms and outstanding, kept as history, and the list shows the exposure', async () => {
    const dealer = await newDealer();
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: dealer,
      creditLimit: '20000.00',
      creditDays: 15,
    });
    await run(accounts, setDealerTerms, {
      entityId: E,
      accountId: dealer,
      creditLimit: '40000.00',
      creditDays: 30,
    });
    await run(accounts, recordDealerOutstanding, {
      entityId: E,
      accountId: dealer,
      outstanding: '5000.00',
      oldestOverdueDays: 10,
      oldestOverdueInvoiceNo: 'ASH/SI/TEST/0002',
      asOf: yesterday(),
    });
    const order = await dealerOrder(dealer, 1);
    await run(lc, confirmSalesOrder, { entityId: E, orderId: order.id });

    const history = await asPrincipal(accounts, (context) =>
      dealerCreditHistory(context, { entityId: E, accountId: dealer }),
    );
    expect(history.terms.map((t) => [t.creditLimit, t.creditDays])).toEqual([
      ['40000.00', 30],
      ['20000.00', 15],
    ]);
    expect(history.outstanding).toHaveLength(1);

    let found: unknown;
    let cursor: string | undefined;
    do {
      const page = await asPrincipal(accounts, (context) =>
        listDealerCredit(context, { entityId: E, limit: 100, ...(cursor ? { cursor } : {}) }),
      );
      found = found ?? page.items.find((row) => row.accountId === dealer);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && found === undefined);
    expect(found).toMatchObject({
      creditLimit: '40000.00',
      creditDays: 30,
      outstanding: '5000.00',
      oldestOverdueInvoiceNo: 'ASH/SI/TEST/0002',
      asOf: yesterday(),
      confirmedUnpaid: '13440.00',
      exposure: '18440.00',
    });
  });

  it('refuses a customer who is not a dealer, a date after today, other people and another company', async () => {
    const dealer = await newDealer();
    const lead = await sizedLead();
    const terms = { entityId: E, accountId: dealer, creditLimit: '1000.00', creditDays: 10 };
    expect(
      await failure(accounts, setDealerTerms, { ...terms, accountId: lead.accountId }),
    ).toMatchObject({ reason: 'credit_not_dealer' });
    expect(
      await failure(accounts, recordDealerOutstanding, {
        entityId: E,
        accountId: dealer,
        outstanding: '1.00',
        oldestOverdueDays: null,
        oldestOverdueInvoiceNo: null,
        asOf: istCalendarDate(new Date(Date.now() + 3 * 86_400_000)),
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'outstanding_date_future' });
    for (const who of [lc, gm]) {
      expect(await failure(who, setDealerTerms, terms)).toMatchObject({
        code: 'forbidden',
        stage: 'guard',
      });
    }
    expect(await failure(accounts1, setDealerTerms, terms)).toMatchObject({ code: 'forbidden' });
    expect(await failure(accounts, setDealerTerms, { ...terms, entityId: 1 })).toMatchObject({
      code: 'forbidden',
    });
    await expect(
      asPrincipal(lc, (context) => listDealerCredit(context, { entityId: E })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('the order lists', () => {
  it('lists orders by state, on Account 360, and only those the caller reads', async () => {
    const dealer = await newDealer();
    const order = await dealerOrder(dealer, 1);
    const drafts = await asPrincipal(lc, (context) =>
      listSalesOrders(context, { entityId: E, state: 'draft', limit: 100 }),
    );
    expect(drafts.items.every((row) => row.state === 'draft')).toBe(true);
    expect(drafts.items.some((row) => row.id === order.id)).toBe(true);
    const mine = await asPrincipal(lc, (context) => accountSalesOrders(context, dealer, E));
    expect(mine.map((row) => row.soNo)).toEqual([order.soNo]);
    const theirs = await asPrincipal(otherLc, (context) =>
      listSalesOrders(context, { entityId: E, limit: 100 }),
    );
    expect(theirs.items.some((row) => row.id === order.id)).toBe(false);
  });
});

function sqlCount(orderId: string) {
  return sqlTag`select count(*)::int as n from commission_accruals where sales_order_id = ${orderId}`;
}
