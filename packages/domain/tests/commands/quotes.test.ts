import {
  newId,
  SYSTEM_WORKERS_PRINCIPAL_ID,
  type Principal,
  type QuoteDto,
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
import { failureOf, runCommand } from '../../src/command/run-command';
import { createLead } from '../../src/commands/crm/create-lead';
import { recordSizing } from '../../src/commands/crm/record-sizing';
import { setAccountTier } from '../../src/commands/crm/set-account-tier';
import { attachQuotePdf } from '../../src/commands/sales/attach-quote-pdf';
import { createQuote } from '../../src/commands/sales/create-quote';
import { expireQuotes } from '../../src/commands/sales/expire-quotes';
import { requoteQuote } from '../../src/commands/sales/requote';
import { sendQuote } from '../../src/commands/sales/send-quote';
import { withdrawQuote } from '../../src/commands/sales/withdraw-quote';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import {
  accountQuotes,
  getQuote,
  listQuotes,
  searchQuotes,
} from '../../src/queries/sales/list-quotes';
import { loadQuoteBuilder, previewQuote } from '../../src/queries/sales/quote-builder';
import { loadQuoteForPrint } from '../../src/queries/sales/quote-print';
import { quoteValidUntil } from '../../src/state-machines/machines/quote';

// Quotes are made in company 2: the catalogue fixture resets company 1's quote series for the
// year (catalogue-fixture.ts), and a quote number is never used twice. Every price, rate and split
// here is a synthetic test value made for this file, never a client figure (PRICE-2, PRICE-4);
// the shared tax rows it adds are removed afterwards with the quotes that name them, since the
// catalogue scope test reads those tables whole.
const E = 2;
const P = '01990000-0000-7000-8000-0000000f';
const fixed = (n: number) => `${P}${n.toString(16).padStart(4, '0')}`;
const ids = {
  tier: fixed(0x0001),
  bareTier: fixed(0x0002),
  list: fixed(0x0003),
  pump: fixed(0x0004),
  module: fixed(0x0005),
  cable: fixed(0x0006),
  kit: fixed(0x0007),
  unpriced: fixed(0x0008),
  ratePump: fixed(0x0009),
  rateModule: fixed(0x000a),
  rateCable: fixed(0x000b),
  rule: fixed(0x000c),
  priced: [fixed(0x0010), fixed(0x0011), fixed(0x0012), fixed(0x0013)],
  kitComponent: fixed(0x0014),
};

let teamId: string;
let lc: Principal;
let otherLc: Principal;
let cc: Principal;
let exec: Principal;
let gm1: Principal;
const workers = (entityId = E): Principal => ({
  ...principalFor('system:workers', [entityId]),
  id: SYSTEM_WORKERS_PRINCIPAL_ID,
});

/** Removes this file's quotes and the shared tax rows they name, from this run or an earlier one. */
async function removeQuoteRows(): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`alter table quote_lines disable trigger quote_lines_append_only`;
      await tx`alter table quote_versions disable trigger quote_versions_append_only`;
      const quotes = tx`select id from quotes where price_list_id = ${ids.list}`;
      await tx`delete from quote_versions where quote_id in (${quotes})`;
      await tx`delete from quote_lines where quote_id in (${quotes})`;
      await tx`update quotes set supersedes_id = null where price_list_id = ${ids.list}`;
      await tx`delete from quotes where price_list_id = ${ids.list}`;
      await tx`alter table quote_lines enable trigger quote_lines_append_only`;
      await tx`alter table quote_versions enable trigger quote_versions_append_only`;
      await tx`delete from tax_rates where id in (${ids.ratePump}, ${ids.rateModule}, ${ids.rateCable})`;
      await tx`delete from composite_supply_rules where id = ${ids.rule}`;
    }),
  );
}

beforeAll(async () => {
  await removeQuoteRows();
  teamId = await createTestTeam(E, 'quote team');
  const otherTeam = await createTestTeam(E, 'quote other team');
  lc = await createTestPrincipal('tele_caller_lc', [E], { teamId });
  otherLc = await createTestPrincipal('tele_caller_lc', [E], { teamId: otherTeam });
  cc = await createTestPrincipal('tele_caller_cc', [E], { teamId });
  exec = await createTestPrincipal('executive');
  gm1 = await createTestPrincipal('general_manager', [1]);
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values
        (${ids.tier}, 't_quote_test', 'Quote test tier'),
        (${ids.bareTier}, 't_quote_bare', 'Quote test tier with no list')
        on conflict (id) do update set is_active = true, archived_at = null`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
        (${ids.pump}, 'QT-PUMP', 'quote test pump', 'pump', '8413', 'nos', false,
         ${tx.json({ hp: 7.5, kw: 5.5, phase: 'three', pumpType: 'submersible', outletMm: 50, maxHeadM: 50 })}),
        (${ids.module}, 'QT-MODULE', 'quote test module', 'solar_module', '8541', 'nos', true,
         ${tx.json({ wp: 540 })}),
        (${ids.cable}, 'QT-CABLE', 'quote test cable', 'cable', '8544', 'metre', false, '{}'::jsonb),
        (${ids.unpriced}, 'QT-UNPRICED', 'quote test unpriced item', 'other', '8479', 'nos', false, '{}'::jsonb)
        on conflict (id) do nothing`;
      await tx`insert into pump_curves (id, item_id, head_m, flow_lph) values
        (${fixed(0x0020)}, ${ids.pump}, 30.00, 20000.00), (${fixed(0x0021)}, ${ids.pump}, 50.00, 16000.00)
        on conflict (id) do nothing`;
      await tx`insert into kits (id, sku, name) values (${ids.kit}, 'QT-KIT', 'quote test rooftop kit')
        on conflict (id) do nothing`;
      await tx`insert into kit_components (id, kit_id, item_id, qty) values
        (${ids.kitComponent}, ${ids.kit}, ${ids.module}, 5.000) on conflict (id) do nothing`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
        values (${ids.list}, ${ids.tier}, ${E}, 1, '2026-04-01', ${exec.id}, now())
        on conflict (id) do update set archived_at = null, approved_by = ${exec.id}, approved_at = now()`;
      await tx`alter table price_list_items disable trigger price_list_items_log_change`;
      await tx`delete from price_list_items where price_list_id = ${ids.list}`;
      await tx`insert into price_list_items (id, price_list_id, item_id, kit_id, price) values
        (${ids.priced[0] ?? ''}, ${ids.list}, ${ids.pump}, null, 50000.00),
        (${ids.priced[1] ?? ''}, ${ids.list}, ${ids.module}, null, 12000.00),
        (${ids.priced[2] ?? ''}, ${ids.list}, ${ids.cable}, null, 85.50),
        (${ids.priced[3] ?? ''}, ${ids.list}, null, ${ids.kit}, 70000.00)`;
      await tx`alter table price_list_items enable trigger price_list_items_log_change`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref) values
        (${ids.ratePump}, ${ids.pump}, 12.00, '2026-04-01', 'quote test'),
        (${ids.rateModule}, ${ids.module}, 12.00, '2026-04-01', 'quote test'),
        (${ids.rateCable}, ${ids.cable}, 18.00, '2026-04-01', 'quote test')`;
      await tx`insert into composite_supply_rules (id, segment, goods_share_pct, services_share_pct,
                 goods_rate_pct, services_rate_pct, effective_from)
        values (${ids.rule}, 'residential_rooftop', 70.00, 30.00, 12.00, 18.00, '2026-04-01')`;
    }),
  );
});

afterAll(async () => {
  await removeQuoteRows();
  await asMigrator(async (m) => {
    await m`update price_lists set archived_at = now() where id = ${ids.list}`;
    await m`update price_tiers set is_active = false, archived_at = now() where id in (${ids.tier}, ${ids.bareTier})`;
  });
  await closeDb();
});

function run<T = QuoteDto>(principal: Principal, command: AnyCommand, input: unknown): Promise<T> {
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

/** A lead of company 2 owned by the LC, its customer on the test tier unless `tier` is null. */
async function newLead(
  pipelineKey: 'residential_rooftop' | 'farmer_pumps',
  options: { tier?: string | null; owner?: Principal } = {},
): Promise<{ id: string; accountId: string }> {
  const owner = options.owner ?? lc;
  const lead = await run<{ id: string; account: { id: string } }>(owner, createLead, {
    entityId: E,
    pipelineKey,
    contact: {
      name: 'Quote test customer',
      phone: `96${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
    },
    account: { type: 'household' },
    site: {
      type: pipelineKey === 'farmer_pumps' ? 'borewell' : 'rooftop',
      village: 'Quote test village',
    },
  });
  const tier = options.tier === undefined ? ids.tier : options.tier;
  if (tier !== null) {
    await run(exec, setAccountTier, { accountId: lead.account.id, tierId: tier });
  }
  return { id: lead.id, accountId: lead.account.id };
}

async function sizeRooftop(opportunityId: string, owner: Principal = lc): Promise<void> {
  await run(owner, recordSizing, {
    entityId: E,
    opportunityId,
    sizing: {
      kind: 'rooftop',
      inputs: { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
    },
  });
}

async function sizePump(opportunityId: string): Promise<void> {
  await run(lc, recordSizing, {
    entityId: E,
    opportunityId,
    sizing: {
      kind: 'pump',
      itemId: ids.pump,
      inputs: {
        pumpType: 'submersible',
        drive: 'solar',
        pipeMaterial: 'hdpe',
        staticLevelM: 30,
        drawdownM: 5,
        deliveryHeightM: 2,
        pipeLengthM: 50,
        pipeInnerDiameterMm: 50,
        flowLph: 18_000,
      },
    },
  });
}

const rooftopLines = [
  { itemId: ids.module, qty: '5' },
  { itemId: ids.cable, qty: '10' },
];

async function sizedRooftopQuote(owner: Principal = lc): Promise<QuoteDto> {
  const lead = await newLead('residential_rooftop', { owner });
  await sizeRooftop(lead.id, owner);
  return run(owner, createQuote, { entityId: E, opportunityId: lead.id, lines: rooftopLines });
}

/** A ready PDF of the quote's company, as the render worker records one. */
async function readyPdf(entityId = E): Promise<string> {
  const id = newId();
  await asMigrator(
    (
      m,
    ) => m`insert into files (id, entity_id, purpose, bucket, key, name, content_type, size, sha256, status, created_by)
             values (${id}, ${entityId}, 'quote_pdf', 'local', ${`${String(entityId)}/quote_pdf/${id}.pdf`}, 'quote.pdf',
                     'application/pdf', 10, ${'b'.repeat(64)}, 'ready', ${SYSTEM_WORKERS_PRINCIPAL_ID})`,
  );
  return id;
}

async function sentQuote(): Promise<QuoteDto> {
  const quote = await sizedRooftopQuote();
  const fileId = await readyPdf();
  await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId });
  return run(lc, sendQuote, { entityId: E, quoteId: quote.id });
}

describe('sales.quote.create (design §7.3, SAL-03, SAL-04)', () => {
  it('prices a sized lead from the live list of the customer’s tier and taxes it by the engine', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    const before = new Date();
    const quote = await run(lc, createQuote, {
      entityId: E,
      opportunityId: lead.id,
      lines: rooftopLines,
    });
    expect(quote).toMatchObject({
      entityId: E,
      opportunityId: lead.id,
      accountId: lead.accountId,
      state: 'draft',
      tierId: ids.tier,
      tierName: 'Quote test tier',
      priceListId: ids.list,
      scheme: 'none',
      // No state on the site or in a GSTIN: the company's own state, so CGST and SGST.
      placeOfSupplyState: '08',
      supplyKind: 'intra',
      pdfFileId: null,
      canSend: false,
      canRequote: true,
      canWithdraw: true,
    });
    expect(quote.quoteNo).toMatch(/^SMP\/Q\/\d{4}-\d{2}\/\d{4,}$/);
    // 5 modules at 12,000 = 60,000 at 12%; 10 m of cable at 85.50 = 855 at 18%.
    expect(
      quote.lines.map((l) => [l.sku, l.unitPrice, l.taxableValue, l.cgst, l.sgst, l.igst]),
    ).toEqual([
      ['QT-MODULE', '12000.00', '60000.00', '3600.00', '3600.00', '0.00'],
      ['QT-CABLE', '85.50', '855.00', '76.95', '76.95', '0.00'],
    ]);
    expect(quote.lines[0]).toMatchObject({ taxRateId: ids.rateModule, taxRatePct: '12.00' });
    expect(quote.totals).toEqual({
      subtotal: '60855.00',
      cgst: '3676.95',
      sgst: '3676.95',
      igst: '0.00',
      taxTotal: '7353.90',
      roundOff: '0.10',
      grandTotal: '68209.00',
    });
    const validUntil = Date.parse(quote.validUntil);
    expect(validUntil).toBeGreaterThanOrEqual(quoteValidUntil(before).getTime());
    expect(validUntil).toBeLessThanOrEqual(quoteValidUntil(new Date()).getTime());

    const events = await asOutboxPublisher(
      (p) => p<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events where aggregate_id = ${quote.id} order by type`,
    );
    expect(events).toEqual([
      {
        type: 'print.document.requested',
        payload_json: { v: 1, documentType: 'quote', documentId: quote.id, version: 1 },
      },
      {
        type: 'sales.quote.created',
        payload_json: { v: 1, opportunityId: lead.id, supersedesId: null, lineCount: 2 },
      },
    ]);
    const versions = await asMigrator(
      (m) => m<{ version: number; snapshot: { quoteNo: string } }[]>`
        select version, snapshot_json as snapshot from quote_versions where quote_id = ${quote.id}`,
    );
    expect(versions).toMatchObject([{ version: 1, snapshot: { quoteNo: quote.quoteNo } }]);
    const audits = await asMigrator(
      (m) => m<{ command: string; after_json: Record<string, unknown> }[]>`
        select command, after_json from audit_logs where aggregate_id = ${quote.id}`,
    );
    expect(audits).toMatchObject([
      {
        command: 'sales.quote.create',
        after_json: {
          quoteNo: quote.quoteNo,
          state: 'draft',
          lineCount: 2,
          grandTotal: '68209.00',
        },
      },
    ]);
  });

  it('numbers quotes of a company one after another', async () => {
    const a = await sizedRooftopQuote();
    const b = await sizedRooftopQuote();
    const serial = (no: string) => Number(no.split('/').at(-1));
    expect(serial(b.quoteNo)).toBe(serial(a.quoteNo) + 1);
  });

  it('refuses a price, a rate or an amount in the input (SAL-03)', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    for (const extra of [{ unitPrice: '1.00' }, { price: '1.00' }, { taxRatePct: '0.00' }]) {
      expect(
        await failure(lc, createQuote, {
          entityId: E,
          opportunityId: lead.id,
          lines: [{ itemId: ids.module, qty: '5', ...extra }],
        }),
      ).toMatchObject({ code: 'validation_failed', stage: 'input' });
    }
  });

  it('refuses a customer with no tier, and a tier with no live list', async () => {
    const none = await newLead('residential_rooftop', { tier: null });
    await sizeRooftop(none.id);
    expect(
      await failure(lc, createQuote, { entityId: E, opportunityId: none.id, lines: rooftopLines }),
    ).toMatchObject({ code: 'validation_failed', reason: 'quote_tier_missing' });
    const bare = await newLead('residential_rooftop', { tier: ids.bareTier });
    await sizeRooftop(bare.id);
    expect(
      await failure(lc, createQuote, { entityId: E, opportunityId: bare.id, lines: rooftopLines }),
    ).toMatchObject({ code: 'validation_failed', reason: 'quote_price_list_missing' });
  });

  it('refuses a lead with no sizing, a system over the sanctioned load, and a pump off its curve', async () => {
    const unsized = await newLead('residential_rooftop');
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: unsized.id,
        lines: rooftopLines,
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'sizing_incomplete' });

    const rooftop = await newLead('residential_rooftop');
    await sizeRooftop(rooftop.id);
    // Ten modules of 540 Wp are 5.4 kWp, over the 5 kW sanctioned load the sizing recorded.
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: rooftop.id,
        lines: [{ itemId: ids.module, qty: '10' }],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'dcr_rule_failed' });
    // PM Surya Ghar needs DCR modules: the cable alone carries none.
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: rooftop.id,
        scheme: 'pm_surya_ghar',
        lines: [{ itemId: ids.cable, qty: '10' }],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'dcr_rule_failed' });

    const pump = await newLead('farmer_pumps');
    await sizePump(pump.id);
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: pump.id,
        lines: [{ itemId: ids.cable, qty: '30' }],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'pump_curve_out_of_bounds' });
    const ok = await run(lc, createQuote, {
      entityId: E,
      opportunityId: pump.id,
      lines: [
        { itemId: ids.pump, qty: '1' },
        { itemId: ids.cable, qty: '30' },
      ],
    });
    expect(ok.sizingId).not.toBeNull();
    expect(ok.totals.subtotal).toBe('52565.00');
  });

  it('refuses an item with no price on the list and a kit that is not a works contract', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: lead.id,
        lines: [{ itemId: ids.unpriced, qty: '1' }],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'quote_price_missing' });
    expect(
      await failure(lc, createQuote, {
        entityId: E,
        opportunityId: lead.id,
        lines: [{ kitId: ids.kit, qty: '1' }],
      }),
    ).toMatchObject({ code: 'validation_failed', reason: 'quote_kit_tax_missing' });
  });

  it('prices a kit at its fixed price and splits it 70:30 as a rooftop works contract (PRICE-3)', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    const quote = await run(lc, createQuote, {
      entityId: E,
      opportunityId: lead.id,
      lines: [{ kitId: ids.kit, qty: '1', worksContract: true }],
    });
    expect(quote.lines[0]).toMatchObject({
      kitId: ids.kit,
      unitPrice: '70000.00',
      hsn: null,
      compositeRuleId: ids.rule,
      goodsTaxable: '49000.00',
      servicesTaxable: '21000.00',
      // 49,000 at 12% and 21,000 at 18%: 5,880 + 3,780 = 9,660, halved.
      cgst: '4830.00',
      sgst: '4830.00',
    });
  });

  it('charges IGST when the site is in another state', async () => {
    const lead = await newLead('residential_rooftop');
    await asMigrator(
      (m) => m`update customer_sites set state_code = '24'
               where id = (select site_id from opportunities where id = ${lead.id})`,
    );
    await sizeRooftop(lead.id);
    const quote = await run(lc, createQuote, {
      entityId: E,
      opportunityId: lead.id,
      lines: rooftopLines,
    });
    expect(quote).toMatchObject({ placeOfSupplyState: '24', supplyKind: 'inter' });
    expect(quote.totals).toMatchObject({ cgst: '0.00', sgst: '0.00', igst: '7353.90' });
  });

  it('previews exactly what it makes, and saves nothing', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    const input = { entityId: E, opportunityId: lead.id, lines: rooftopLines };
    const preview = await asPrincipal(lc, (context) => previewQuote(context, input));
    const quote = await run(lc, createQuote, input);
    expect(preview.lines).toEqual(quote.lines);
    expect(preview.totals).toEqual(quote.totals);
    const builder = await asPrincipal(lc, (context) =>
      loadQuoteBuilder(context, { entityId: E, opportunityId: lead.id }),
    );
    expect(builder).toMatchObject({
      tierName: 'Quote test tier',
      priceListId: ids.list,
      sizing: { kind: 'rooftop', inBounds: true, stale: false },
    });
    expect(builder.choices.map((c) => c.sku).sort()).toEqual(
      ['QT-CABLE', 'QT-KIT', 'QT-MODULE', 'QT-PUMP'].sort(),
    );
  });

  it('is denied to a caller without sales.quote.create, and to another company', async () => {
    const lead = await newLead('residential_rooftop');
    await sizeRooftop(lead.id);
    const input = { entityId: E, opportunityId: lead.id, lines: rooftopLines };
    expect(await failure(cc, createQuote, input)).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(gm1, createQuote, input)).toMatchObject({ code: 'forbidden' });
    expect(await failure(lc, createQuote, { ...input, entityId: 1 })).toMatchObject({
      code: 'forbidden',
    });
    // Another LC cannot see a lead they do not own.
    expect(await failure(otherLc, createQuote, input)).toMatchObject({
      code: 'not_found',
      reason: 'lead_missing',
    });
  });
});

describe('sending, withdrawing and re-quoting', () => {
  it('sends a quote only once its PDF is attached', async () => {
    const quote = await sizedRooftopQuote();
    expect(await failure(lc, sendQuote, { entityId: E, quoteId: quote.id })).toMatchObject({
      code: 'conflict',
      reason: 'quote_pdf_missing',
    });
    const fileId = await readyPdf();
    // Only the worker attaches a PDF.
    expect(
      await failure(lc, attachQuotePdf, { entityId: E, quoteId: quote.id, fileId }),
    ).toMatchObject({ code: 'forbidden', stage: 'guard' });
    await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId });
    // Attaching the same file again changes nothing; another file is refused.
    await run(workers(), attachQuotePdf, { entityId: E, quoteId: quote.id, fileId });
    expect(
      await failure(workers(), attachQuotePdf, {
        entityId: E,
        quoteId: quote.id,
        fileId: await readyPdf(),
      }),
    ).toMatchObject({ code: 'conflict', reason: 'quote_pdf_mismatch' });

    expect(await failure(cc, sendQuote, { entityId: E, quoteId: quote.id })).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    expect(await failure(gm1, sendQuote, { entityId: E, quoteId: quote.id })).toMatchObject({
      code: 'forbidden',
    });
    const sent = await run(lc, sendQuote, { entityId: E, quoteId: quote.id });
    expect(sent).toMatchObject({ state: 'sent', pdfFileId: fileId, canSend: false });
    const [event] = await asOutboxPublisher(
      (p) => p<{ payload_json: Record<string, unknown> }[]>`
        select payload_json from outbox_events where aggregate_id = ${quote.id} and type = 'sales.quote.sent'`,
    );
    expect(event?.payload_json).toEqual({
      v: 1,
      opportunityId: quote.opportunityId,
      pdfFileId: fileId,
    });
  });

  it('withdraws a quote with a reason and keeps the reason', async () => {
    const quote = await sizedRooftopQuote();
    expect(
      await failure(lc, withdrawQuote, { entityId: E, quoteId: quote.id, reason: ' ' }),
    ).toMatchObject({ code: 'validation_failed' });
    expect(
      await failure(cc, withdrawQuote, {
        entityId: E,
        quoteId: quote.id,
        reason: 'No longer needed',
      }),
    ).toMatchObject({ code: 'forbidden', stage: 'guard' });
    const withdrawn = await run(lc, withdrawQuote, {
      entityId: E,
      quoteId: quote.id,
      reason: 'The customer chose a smaller system',
    });
    expect(withdrawn).toMatchObject({
      state: 'withdrawn',
      withdrawnReason: 'The customer chose a smaller system',
      canRequote: false,
      canWithdraw: false,
    });
    expect(await failure(lc, requoteQuote, { entityId: E, quoteId: quote.id })).toMatchObject({
      code: 'conflict',
      reason: 'quote_transition_not_allowed',
    });
  });

  it('re-quotes at today’s prices, keeping the old quote as superseded', async () => {
    const old = await sentQuote();
    await asMigrator(async (m) => {
      await m`alter table price_list_items disable trigger price_list_items_log_change`;
      await m`update price_list_items set price = 12500.00 where id = ${ids.priced[1] ?? ''}`;
      await m`alter table price_list_items enable trigger price_list_items_log_change`;
    });
    try {
      expect(await failure(cc, requoteQuote, { entityId: E, quoteId: old.id })).toMatchObject({
        code: 'forbidden',
        stage: 'guard',
      });
      const next = await run(lc, requoteQuote, { entityId: E, quoteId: old.id });
      expect(next).toMatchObject({
        state: 'draft',
        supersedesId: old.id,
        supersedesNo: old.quoteNo,
        opportunityId: old.opportunityId,
      });
      expect(next.quoteNo).not.toBe(old.quoteNo);
      expect(next.lines[0]).toMatchObject({
        sku: 'QT-MODULE',
        qty: '5.000',
        unitPrice: '12500.00',
      });
      const before = await asPrincipal(lc, (context) =>
        getQuote(context, { entityId: E, quoteId: old.id }),
      );
      expect(before).toMatchObject({
        state: 'superseded',
        supersededById: next.id,
        supersededByNo: next.quoteNo,
        // A superseded quote keeps its prices.
        lines: [expect.objectContaining({ unitPrice: '12000.00' }), expect.anything()],
      });
      const versions = await asMigrator(
        (m) => m<{ version: number }[]>`
          select version from quote_versions where quote_id = ${old.id} order by version`,
      );
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      // A quote is replaced once.
      expect(await failure(lc, requoteQuote, { entityId: E, quoteId: old.id })).toMatchObject({
        code: 'conflict',
        reason: 'quote_transition_not_allowed',
      });
    } finally {
      await asMigrator(async (m) => {
        await m`alter table price_list_items disable trigger price_list_items_log_change`;
        await m`update price_list_items set price = 12000.00 where id = ${ids.priced[1] ?? ''}`;
        await m`alter table price_list_items enable trigger price_list_items_log_change`;
      });
    }
  });
});

describe('sales.quote.expire (the daily job)', () => {
  it('shows a lapsed quote as expired, and the job marks it so as system:workers', async () => {
    const quote = await sentQuote();
    await asMigrator(
      (m) => m`update quotes set valid_until = now() - interval '1 minute' where id = ${quote.id}`,
    );
    const shown = await asPrincipal(lc, (context) =>
      getQuote(context, { entityId: E, quoteId: quote.id }),
    );
    expect(shown).toMatchObject({ state: 'expired', canSend: false, canRequote: true });
    // A lapsed quote cannot be sent.
    const draft = await sizedRooftopQuote();
    await run(workers(), attachQuotePdf, {
      entityId: E,
      quoteId: draft.id,
      fileId: await readyPdf(),
    });
    await asMigrator(
      (m) => m`update quotes set valid_until = now() - interval '1 minute' where id = ${draft.id}`,
    );
    expect(await failure(lc, sendQuote, { entityId: E, quoteId: draft.id })).toMatchObject({
      code: 'conflict',
      reason: 'quote_expired',
    });

    // No person and no agent may run the job.
    expect(await failure(exec, expireQuotes, { entityId: E })).toMatchObject({
      code: 'forbidden',
      stage: 'guard',
    });
    let expired = 0;
    let afterId: string | null = null;
    do {
      const batch: { expired: number; nextAfterId: string | null } = await run(
        workers(),
        expireQuotes,
        { entityId: E, afterId },
      );
      expired += batch.expired;
      afterId = batch.nextAfterId;
    } while (afterId !== null);
    expect(expired).toBeGreaterThanOrEqual(2);
    const rows = await asMigrator(
      (m) => m<{ id: string; state: string }[]>`
        select id, state from quotes where id in (${quote.id}, ${draft.id}) order by id`,
    );
    expect(rows.map((r) => r.state)).toEqual(['expired', 'expired']);
    const events = await asOutboxPublisher(
      (p) => p<{ type: string }[]>`
        select type from outbox_events where aggregate_id = ${quote.id} and type = 'sales.quote.expired'`,
    );
    expect(events).toHaveLength(1);
    // A quote still valid is left as it is.
    const fresh = await sizedRooftopQuote();
    await run(workers(), expireQuotes, { entityId: E, afterId: null });
    const still = await asPrincipal(lc, (context) =>
      getQuote(context, { entityId: E, quoteId: fresh.id }),
    );
    expect(still.state).toBe('draft');
  });

  it('cannot reach a company outside its request', async () => {
    expect(await failure(workers(1), expireQuotes, { entityId: E })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('crm.account.tier.set (PRICE-1)', () => {
  it('is an Executive’s: a caller or a General Manager is refused, and the database refuses the change too', async () => {
    const lead = await newLead('residential_rooftop', { tier: null });
    const gm2 = await createTestPrincipal('general_manager', [E]);
    for (const who of [lc, cc, gm2]) {
      expect(
        await failure(who, setAccountTier, { accountId: lead.accountId, tierId: ids.tier }),
      ).toMatchObject({ code: 'forbidden', stage: 'guard' });
    }
    // A customer writer changing the column directly is refused by the trigger.
    const direct: unknown = await asPrincipal(lc, ({ tx }) =>
      tx.execute(sql`update accounts set tier_id = ${ids.tier} where id = ${lead.accountId}`),
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(direct).toBeInstanceOf(Error);
    const set = await run<{ tierId: string | null }>(exec, setAccountTier, {
      accountId: lead.accountId,
      tierId: ids.tier,
    });
    expect(set.tierId).toBe(ids.tier);
    expect(
      await failure(exec, setAccountTier, { accountId: lead.accountId, tierId: newId() }),
    ).toMatchObject({ code: 'not_found', reason: 'price_tier_missing' });
    const cleared = await run<{ tierId: string | null }>(exec, setAccountTier, {
      accountId: lead.accountId,
      tierId: null,
    });
    expect(cleared.tierId).toBeNull();
  });
});

describe('the quote reads', () => {
  it('list, search and Account 360 show the quotes the caller can read, and no other team’s', async () => {
    const quote = await sizedRooftopQuote();
    const page = await asPrincipal(lc, (context) =>
      listQuotes(context, { entityId: E, limit: 100 }),
    );
    expect(page.items.map((r) => r.id)).toContain(quote.id);
    const others = await asPrincipal(otherLc, (context) =>
      listQuotes(context, { entityId: E, limit: 100 }),
    );
    expect(others.items.map((r) => r.id)).not.toContain(quote.id);
    const drafts = await asPrincipal(lc, (context) =>
      listQuotes(context, { entityId: E, state: 'draft', limit: 100 }),
    );
    expect(drafts.items.every((r) => r.state === 'draft')).toBe(true);

    const serial = quote.quoteNo.split('/').at(-1) ?? '';
    const hits = await asPrincipal(lc, (context) =>
      searchQuotes(context, { q: quote.quoteNo, limit: 8 }),
    );
    expect(hits[0]).toMatchObject({ id: quote.id, quoteNo: quote.quoteNo, state: 'draft' });
    const bySerial = await asPrincipal(lc, (context) =>
      searchQuotes(context, { q: serial, limit: 20 }),
    );
    expect(bySerial.map((h) => h.id)).toContain(quote.id);
    expect(
      await asPrincipal(otherLc, (context) =>
        searchQuotes(context, { q: quote.quoteNo, limit: 8 }),
      ),
    ).toEqual([]);

    const ofAccount = await asPrincipal(lc, (context) =>
      accountQuotes(context, quote.accountId, E),
    );
    expect(ofAccount.map((r) => r.id)).toEqual([quote.id]);
    await expect(
      asPrincipal(otherLc, (context) => getQuote(context, { entityId: E, quoteId: quote.id })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'quote_missing' } });
  });

  it('prints a quote for the render worker alone, with no phone number', async () => {
    const quote = await sizedRooftopQuote();
    const printed = await asPrincipal(workers(), (context) => loadQuoteForPrint(context, quote.id));
    expect(printed).toMatchObject({
      quoteNo: quote.quoteNo,
      customerName: 'Quote test customer',
      grandTotal: '68209.00',
      lines: [
        expect.objectContaining({ sku: 'QT-MODULE', qty: '5.000', taxRatePct: '12.00' }),
        expect.objectContaining({ sku: 'QT-CABLE' }),
      ],
    });
    expect(JSON.stringify(printed)).not.toMatch(/\+91|96\d{8}/);
    await expect(
      asPrincipal(lc, (context) => loadQuoteForPrint(context, quote.id)),
    ).rejects.toThrow();
    await expect(
      asPrincipal(workers(1), (context) => loadQuoteForPrint(context, quote.id)),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
