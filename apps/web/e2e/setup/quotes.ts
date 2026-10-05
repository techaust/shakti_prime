// The quote journeys' fixtures (`e2e/quotes.spec.ts`), written by the seed on the host: a price
// tier, two items with their own GST rates and a price list of that tier in the journeys' company
// and the snapshot company, made once. Every price and rate here is a test value for the journeys
// alone, never a client figure (PRICE-2, PRICE-4); the tier says so in its name. Then, in the
// snapshot company, one sized lead with one quote made by the seed's Executive, for the screenshots
// of the list, the quote and the builder, and the quotation printed from that real quote; and, in
// the journeys' company, one sized lead per project with no tier yet, which the journey prices.
import type { Principal } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  createQuote,
  createLead,
  executeCommand,
  executeQuery,
  loadCompanyForPrint,
  loadQuoteForPrint,
  recordSizing,
  setAccountTier,
} from '@shakti/domain';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileStore } from '../../src/files/store';
import { companyPrintOf, quotePrintOf } from '../../src/print/documents';
import { renderQuote } from '../../src/print/quote-template';
import { systemWorkersPrincipal } from '../../src/workers/events/system-principal';
import { PRINT_PAGES_DIR } from './print-pages';
import {
  PROJECTS,
  QUOTE_JOURNEY_COMPANY,
  QUOTE_JOURNEY_LEADS,
  QUOTE_TIER,
  SNAPSHOT_COMPANY,
  SNAPSHOT_QUOTE_LEAD,
  type QuoteJourneySeed,
} from '../support/users';

const id = (n: number) => `0199e2e0-0000-7000-8000-00000000f${n.toString(16).padStart(3, '0')}`;
const IDS = {
  tier: id(0x001),
  module: id(0x002),
  cable: id(0x003),
  moduleRate: id(0x004),
  cableRate: id(0x005),
  journeyList: id(0x006),
  snapshotList: id(0x007),
  journeyPrices: [id(0x008), id(0x009)],
  snapshotPrices: [id(0x00a), id(0x00b)],
};

/** The tier, items, rates and lists, made once and kept as they are. */
async function ensureCatalogue(executiveId: string): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${IDS.tier}, 'journeys', ${QUOTE_TIER})
               on conflict (id) do nothing`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json) values
               (${IDS.module}, 'JRN-MOD-540', 'Solar module 540 Wp', 'solar_module', '8541', 'nos',
                true, ${tx.json({ wp: 540 })}),
               (${IDS.cable}, 'JRN-CBL-4', 'Solar cable 4 sq mm', 'cable', '8544', 'metre', false,
                '{}'::jsonb)
               on conflict (id) do nothing`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref) values
               (${IDS.moduleRate}, ${IDS.module}, 12.00, '2026-04-01', 'journeys'),
               (${IDS.cableRate}, ${IDS.cable}, 18.00, '2026-04-01', 'journeys')
               on conflict (id) do nothing`;
      for (const [list, entityId, [modulePrice = '', cablePrice = '']] of [
        [IDS.journeyList, QUOTE_JOURNEY_COMPANY.entityId, IDS.journeyPrices],
        [IDS.snapshotList, SNAPSHOT_COMPANY.entityId, IDS.snapshotPrices],
      ] as const) {
        const [found] = await tx<
          { n: number }[]
        >`select count(*)::int as n from price_lists where id = ${list}`;
        if ((found?.n ?? 0) > 0) continue;
        await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
                 values (${list}, ${IDS.tier}, ${entityId}, 1, '2026-04-01', ${executiveId}, now())`;
        await tx`alter table price_list_items disable trigger price_list_items_log_change`;
        await tx`insert into price_list_items (id, price_list_id, item_id, price) values
                 (${modulePrice}, ${list}, ${IDS.module}, 12000.00),
                 (${cablePrice}, ${list}, ${IDS.cable}, 85.50)`;
        await tx`alter table price_list_items enable trigger price_list_items_log_change`;
      }
    }),
  );
}

const ROOFTOP = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 } as const;

/**
 * A lead of the rooftop line in one company owned by `owner`, found again by its owner, company
 * and contact name, and sized once; the customer is given the journeys' tier when `tier` is set.
 */
async function ensureSizedLead(
  owner: Principal,
  entityId: number,
  lead: { name: string; phone: string },
  tier: boolean,
): Promise<{ leadId: string; accountId: string }> {
  const [found] = await asMigrator(
    (m) => m<{ id: string; account_id: string }[]>`
      select o.id, o.account_id
        from opportunities o
        join account_contacts ac on ac.account_id = o.account_id
        join contacts c on c.id = ac.contact_id
       where o.owner_id = ${owner.id} and o.entity_id = ${entityId} and c.name = ${lead.name}
       limit 1`,
  );
  const scope = { entityIds: [entityId] };
  let leadId = found?.id;
  let accountId = found?.account_id;
  if (leadId === undefined || accountId === undefined) {
    const made = await executeCommand(owner, scope, createLead, {
      entityId,
      pipelineKey: 'residential_rooftop',
      contact: { name: lead.name, phone: lead.phone },
      account: { type: 'household' },
      site: { type: 'rooftop', village: 'Sanganer', pin: '302029' },
      sourceCode: 'walk_in',
    });
    leadId = made.id;
    accountId = made.account.id;
    await executeCommand(owner, scope, recordSizing, {
      entityId,
      opportunityId: leadId,
      sizing: { kind: 'rooftop', inputs: { ...ROOFTOP } },
    });
  }
  // The journeys set the tier themselves on Account 360, so it is cleared for every run.
  await executeCommand(owner, {}, setAccountTier, {
    entityId,
    accountId,
    tierId: tier ? IDS.tier : null,
  });
  return { leadId, accountId };
}

/** The quotation page printed from the snapshot quote with the real loader, for `print.spec.ts`. */
async function writeRealQuotePage(quoteId: string): Promise<void> {
  const worker = systemWorkersPrincipal(SNAPSHOT_COMPANY.entityId);
  const scope = { entityIds: [SNAPSHOT_COMPANY.entityId] };
  const quote = await executeQuery(worker, scope, (q) => loadQuoteForPrint(q, quoteId), {
    name: 'e2eQuotePrint',
  });
  const company = await executeQuery(
    worker,
    scope,
    (q) => loadCompanyForPrint(q, SNAPSHOT_COMPANY.entityId),
    { name: 'e2eQuoteCompany' },
  );
  const store = fileStore();
  if (store === undefined) throw new Error('no local file store for the printed quote');
  const printed = quotePrintOf(
    quote,
    await companyPrintOf(company, {
      store,
      cipher: undefined,
      entityId: SNAPSHOT_COMPANY.entityId,
    }),
  );
  mkdirSync(PRINT_PAGES_DIR, { recursive: true });
  writeFileSync(join(PRINT_PAGES_DIR, 'quote-real.html'), (await renderQuote(printed)).html);
}

/** Makes the quote fixtures once and answers what the journeys need of them. */
export async function ensureQuoteJourneys(executiveId: string): Promise<QuoteJourneySeed> {
  await ensureCatalogue(executiveId);
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });

  const snapshot = await ensureSizedLead(
    executive,
    SNAPSHOT_COMPANY.entityId,
    SNAPSHOT_QUOTE_LEAD,
    true,
  );
  const [quote] = await asMigrator(
    (m) => m<{ id: string; quote_no: string }[]>`
      select id, quote_no from quotes where opportunity_id = ${snapshot.leadId}
       order by created_at limit 1`,
  );
  let snapshotQuote: { id: string; quote_no: string } | undefined = quote;
  if (snapshotQuote === undefined) {
    const made = await executeCommand(
      executive,
      { entityIds: [SNAPSHOT_COMPANY.entityId] },
      createQuote,
      {
        entityId: SNAPSHOT_COMPANY.entityId,
        opportunityId: snapshot.leadId,
        lines: [
          { itemId: IDS.module, qty: '5' },
          { itemId: IDS.cable, qty: '20' },
        ],
      },
    );
    snapshotQuote = { id: made.id, quote_no: made.quoteNo };
  }
  await writeRealQuotePage(snapshotQuote.id);

  const journeyLeads = {} as QuoteJourneySeed['journeyLeads'];
  for (const project of PROJECTS) {
    const lead = QUOTE_JOURNEY_LEADS[project];
    const made = await ensureSizedLead(executive, QUOTE_JOURNEY_COMPANY.entityId, lead, false);
    journeyLeads[project] = { accountId: made.accountId, name: lead.name };
  }
  return {
    snapshotLeadId: snapshot.leadId,
    snapshotQuoteId: snapshotQuote.id,
    snapshotQuoteNo: snapshotQuote.quote_no,
    journeyLeads,
  };
}
