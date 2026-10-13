// The Lead Converter journeys' fixtures (`e2e/converting.spec.ts`), written by the seed on the host.
// Per project, one converter of company 2 of their own (so the boards never share) who is not a
// handover target, with three rooftop leads made afresh on every run, all at Qualified:
// - the first, with a callback that fell due three hours ago and no sizing, which the journey works;
// - the second, sized, with a sent quote that runs out in twelve hours;
// - the third, sized, with an order held for credit.
// The customers are on the quote journeys' tier, whose company 2 price list (`./quotes.ts`, made
// before this) holds the module the quote is made from: test values for the journeys alone, never a
// client figure (PRICE-2, PRICE-4). No catalogue item of this journey's own is made, so the
// catalogue, GST rates and price list screenshots do not show one.
import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { createLead, executeCommand, recordSizing, setAccountTier } from '@shakti/domain';
import { CONVERTING_LEADS } from '../converting-fixtures';
import { QUOTE_JOURNEY_COMPANY } from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

// Shakti Motor Pumps, where the quote journeys work too: the security suite's fixtures own the
// quote series of company 1 and fail if a journey has numbered a quote there.
const ENTITY = QUOTE_JOURNEY_COMPANY.entityId;
const SEEDED = { tier: QUOTE_JOURNEY_IDS.tier, list: QUOTE_JOURNEY_IDS.journeyList };
const HOUR = 3_600_000;
const ROOFTOP = { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 } as const;

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
      tierId: SEEDED.tier,
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
                       ${SEEDED.tier}, ${SEEDED.list}, 'none', '08', 'intra',
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
                     ${made.held.leadId}, ${made.held.accountId}, ${SEEDED.tier}, ${SEEDED.list}, '08',
                     'intra', 'draft', ${new Date(Date.now() - 2 * HOUR).toISOString()},
                     'credit_limit_missing', '{}'::jsonb, 60000.00, 3600.00, 3600.00, 0, 7200.00, 0,
                     67200.00, ${ownerId})`,
  );
}

/** Makes the converters' fixtures; `ownerIds` are the people the seed made, `executiveId` sets the customers' tier. */
export async function ensureConvertingJourneys(
  ownerIds: readonly string[],
  executiveId: string,
): Promise<void> {
  for (const ownerId of ownerIds) await freshLeads(ownerId, executiveId);
}
