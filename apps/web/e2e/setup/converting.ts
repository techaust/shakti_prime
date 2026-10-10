// The Lead Converter journeys' fixtures (`e2e/converting.spec.ts`), written by the seed on the host.
// Per project, one converter of company 2 of their own (so the boards never share) who is not a
// handover target, with three rooftop leads made afresh on every run, all at Qualified:
// - the first, with a callback that fell due three hours ago and no sizing, which the journey works;
// - the second, sized, with a sent quote that runs out in twelve hours;
// - the third, sized, with an order held for credit.
// The price tier, item and price list of company 2 that the quote is made from are test values for
// the journeys alone, never a client figure (PRICE-2, PRICE-4); the tier says so in its name.
import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { createLead, executeCommand, recordSizing, setAccountTier } from '@shakti/domain';
import { CONVERTING_ITEM, CONVERTING_LEADS, CONVERTING_TIER } from '../converting-fixtures';

// Shakti Motor Pumps, where the quote journeys work too: the security suite's fixtures own the
// quote series of company 1 and fail if a journey has numbered a quote there.
const ENTITY = 2;
const id = (n: number) => `0199e2e0-0000-7000-8000-0000000c1${n.toString(16).padStart(3, '0')}`;
const IDS = { tier: id(1), item: id(2), rate: id(3), list: id(4), price: id(5) };
const SEEDED_AT = '2026-04-01T00:00:00+05:30';
const HOUR = 3_600_000;
const ROOFTOP = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 } as const;

/** The tier, the item, its GST rate and the price list of company 2, made once and kept as they are. */
async function ensureCatalogue(executiveId: string): Promise<void> {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into price_tiers (id, code, name) values (${IDS.tier}, 'converting', ${CONVERTING_TIER})
               on conflict (id) do nothing`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_dcr, specs_json, created_at, updated_at)
               values (${IDS.item}, ${CONVERTING_ITEM.sku}, ${CONVERTING_ITEM.name}, 'solar_module', '8541',
                       'nos', true, ${tx.json({ wp: 540 })}, ${SEEDED_AT}, ${SEEDED_AT})
               on conflict (id) do nothing`;
      await tx`insert into tax_rates (id, item_id, rate_pct, effective_from, source_ref)
               values (${IDS.rate}, ${IDS.item}, 12.00, '2026-04-01', 'journeys')
               on conflict (id) do nothing`;
      const [found] = await tx<
        { n: number }[]
      >`select count(*)::int as n from price_lists where id = ${IDS.list}`;
      if ((found?.n ?? 0) > 0) return;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, approved_by, approved_at)
               values (${IDS.list}, ${IDS.tier}, ${ENTITY}, 1, '2026-04-01', ${executiveId}, now())`;
      await tx`alter table price_list_items disable trigger price_list_items_log_change`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price, created_at, updated_at)
               values (${IDS.price}, ${IDS.list}, ${IDS.item}, ${CONVERTING_ITEM.price}, ${SEEDED_AT}, ${SEEDED_AT})`;
      await tx`alter table price_list_items enable trigger price_list_items_log_change`;
    }),
  );
}

/** A mobile number no earlier run used, ending in the digits the lead keeps on every run. */
function phone(lastDigits: string): string {
  return `9${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}${lastDigits}`;
}

/** Sets earlier runs' leads of this converter aside, so every run starts from exactly these three. */
async function setAside(ownerId: string): Promise<void> {
  await asMigrator(
    (m) => m`update opportunities set archived_at = now()
              where owner_id = ${ownerId} and archived_at is null`,
  );
}

/** Makes the converter's three leads, at Qualified, with the facts described above. */
async function freshLeads(ownerId: string, executiveId: string): Promise<void> {
  const owner = principalFor('tele_caller_lc', [ENTITY], { id: ownerId });
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  await setAside(ownerId);
  const made = {} as Record<keyof typeof CONVERTING_LEADS, { leadId: string; accountId: string }>;
  for (const [key, lead] of Object.entries(CONVERTING_LEADS) as [
    keyof typeof CONVERTING_LEADS,
    (typeof CONVERTING_LEADS)[keyof typeof CONVERTING_LEADS],
  ][]) {
    const created = await executeCommand(owner, { entityIds: [ENTITY] }, createLead, {
      entityId: ENTITY,
      pipelineKey: 'residential_rooftop',
      contact: { name: lead.name, phone: phone(lead.lastDigits) },
      account: { type: 'household' },
      site: { type: 'rooftop', village: 'Sanganer', pin: '302029' },
      sourceCode: 'walk_in',
    });
    made[key] = { leadId: created.id, accountId: created.account.id };
    // The customer is on the journeys' tier, so the quote form has a price list.
    await executeCommand(executive, {}, setAccountTier, {
      entityId: ENTITY,
      accountId: created.account.id,
      tierId: IDS.tier,
    });
    // At Qualified, as the handover leaves a lead. Set directly: moving it through the stage command
    // would ask for a handover, which would take the lead from this converter.
    await asMigrator(
      (m) => m`update opportunities o set stage_id = ps.id
                 from pipeline_stages ps
                where o.id = ${created.id} and ps.pipeline_id = o.pipeline_id
                  and ps.key = 'qualified' and ps.archived_at is null`,
    );
  }

  // The first lead: a callback that fell due three hours ago, and no sizing.
  await asMigrator(
    (
      m,
    ) => m`insert into tasks (id, entity_id, opportunity_id, account_id, assignee_id, kind, due_at, created_by)
             values (${newId()}, ${ENTITY}, ${made.work.leadId}, ${made.work.accountId}, ${ownerId},
                     'callback', ${new Date(Date.now() - 3 * HOUR).toISOString()}, ${ownerId})`,
  );

  // The second and third: sized, each with a quote; the second runs out in twelve hours, the
  // third has days left and an order the credit check holds.
  for (const lead of [made.expiring, made.held]) {
    await executeCommand(owner, { entityIds: [ENTITY] }, recordSizing, {
      entityId: ENTITY,
      opportunityId: lead.leadId,
      sizing: { kind: 'rooftop', inputs: { ...ROOFTOP } },
    });
  }
  const quoteFor = async (lead: { leadId: string; accountId: string }, validForMs: number) => {
    const quoteId = newId();
    await asMigrator(
      (m) => m`insert into quotes (id, entity_id, quote_no, fy, opportunity_id, account_id, tier_id,
                                  price_list_id, scheme, place_of_supply_state, supply_kind, valid_until,
                                  state, subtotal, cgst, sgst, igst, tax_total, round_off, grand_total,
                                  created_by)
               values (${quoteId}, ${ENTITY}, ${`CNV/Q/${newId()}`}, '2026-27', ${lead.leadId}, ${lead.accountId},
                       ${IDS.tier}, ${IDS.list}, 'none', '08', 'intra',
                       ${new Date(Date.now() + validForMs).toISOString()}, 'sent',
                       60000.00, 3600.00, 3600.00, 0, 7200.00, 0, 67200.00, ${ownerId})`,
    );
    return quoteId;
  };
  await quoteFor(made.expiring, 12 * HOUR);
  const heldQuote = await quoteFor(made.held, 10 * 24 * HOUR);
  await asMigrator(
    (
      m,
    ) => m`insert into sales_orders (id, entity_id, so_no, fy, quote_id, opportunity_id, account_id,
                                      tier_id, price_list_id, place_of_supply_state, supply_kind, state,
                                      credit_held_at, credit_hold_reason, credit_hold_json, subtotal,
                                      cgst, sgst, igst, tax_total, round_off, grand_total, created_by)
             values (${newId()}, ${ENTITY}, ${`CNV/SO/${newId()}`}, '2026-27', ${heldQuote},
                     ${made.held.leadId}, ${made.held.accountId}, ${IDS.tier}, ${IDS.list}, '08',
                     'intra', 'draft', ${new Date(Date.now() - 2 * HOUR).toISOString()},
                     'credit_limit_missing', '{}'::jsonb, 60000.00, 3600.00, 3600.00, 0, 7200.00, 0,
                     67200.00, ${ownerId})`,
  );
}

/** Makes the converters' fixtures; `ownerIds` are the people the seed made, `executiveId` approves the price list. */
export async function ensureConvertingJourneys(
  ownerIds: readonly string[],
  executiveId: string,
): Promise<void> {
  await ensureCatalogue(executiveId);
  for (const ownerId of ownerIds) await freshLeads(ownerId, executiveId);
}
