// The order journeys' fixtures (`e2e/orders.spec.ts`), written by the seed on the host. Every
// price, credit limit and outstanding figure here is a test value for the journeys alone, never a
// client figure (SALE-4, SALE-6): the dealers are priced from the journeys' own tier (`QUOTE_TIER`).
// Per project, a fresh sized lead in the journeys' company whose quote the journey makes, accepts
// and confirms; a dealer there with a small limit, whose orders are always held; and a dealer of
// company 1 for Accounts. In the snapshot company, one dealer with terms, an outstanding entry and
// one draft order, made once, for the screenshots.
import { newId, type Principal } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import {
  createLead,
  createSalesOrder,
  executeCommand,
  recordDealerOutstanding,
  recordSizing,
  setAccountTier,
  setDealerTerms,
} from '@shakti/domain';
import {
  CREDIT_DEALERS,
  HELD_DEALERS,
  ORDER_JOURNEY_LEADS,
  PROJECTS,
  QUOTE_JOURNEY_COMPANY,
  SNAPSHOT_COMPANY,
  SNAPSHOT_DEALER,
  type OrderJourneySeed,
} from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

/** A dealer of one company on the journeys' tier, made once and found again by its name. */
async function ensureDealer(
  executive: Principal,
  entityId: number,
  name: string,
): Promise<{ accountId: string; made: boolean }> {
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select a.id from accounts a
        join account_entities ae on ae.account_id = a.id and ae.entity_id = ${entityId}
       where a.type = 'dealer' and a.name = ${name} and a.archived_at is null
       limit 1`,
  );
  if (found) return { accountId: found.id, made: false };
  const accountId = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, tier_id, created_by)
               values (${accountId}, 'dealer', ${name}, ${QUOTE_JOURNEY_IDS.tier}, ${executive.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               values (${newId()}, ${accountId}, ${entityId}, ${executive.id}, ${executive.id})`;
    }),
  );
  return { accountId, made: true };
}

/** A sized rooftop lead of the journeys' company on the journeys' tier, made afresh each run. */
async function freshSizedLead(
  executive: Principal,
  name: string,
): Promise<{ leadId: string; accountId: string }> {
  const entityId = QUOTE_JOURNEY_COMPANY.entityId;
  const scope = { entityIds: [entityId] };
  // A number of its own each run, so the enquiry never joins an earlier run's lead.
  const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const lead = await executeCommand(executive, scope, createLead, {
    entityId,
    pipelineKey: 'residential_rooftop',
    contact: { name, phone },
    account: { type: 'household' },
    site: { type: 'rooftop', village: 'Sanganer', pin: '302029' },
    sourceCode: 'walk_in',
  });
  await executeCommand(executive, scope, recordSizing, {
    entityId,
    opportunityId: lead.id,
    sizing: {
      kind: 'rooftop',
      inputs: { monthlyUnitsKwh: 300, roofAreaSqm: 40, sanctionedLoadKw: 5 },
    },
  });
  await executeCommand(executive, {}, setAccountTier, {
    entityId,
    accountId: lead.account.id,
    tierId: QUOTE_JOURNEY_IDS.tier,
  });
  return { leadId: lead.id, accountId: lead.account.id };
}

/** Makes the order fixtures and answers what the journeys need of them. */
export async function ensureOrderJourneys(executiveId: string): Promise<OrderJourneySeed> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });

  const acceptLeads = {} as OrderJourneySeed['acceptLeads'];
  const heldDealers = {} as OrderJourneySeed['heldDealers'];
  const creditDealers = {} as OrderJourneySeed['creditDealers'];
  for (const project of PROJECTS) {
    const name = ORDER_JOURNEY_LEADS[project];
    acceptLeads[project] = { ...(await freshSizedLead(executive, name)), name };

    const held = await ensureDealer(
      executive,
      QUOTE_JOURNEY_COMPANY.entityId,
      HELD_DEALERS[project],
    );
    if (held.made) {
      // A limit below any order of the journeys' prices, so every run's order is held.
      await executeCommand(
        executive,
        { entityIds: [QUOTE_JOURNEY_COMPANY.entityId] },
        setDealerTerms,
        {
          entityId: QUOTE_JOURNEY_COMPANY.entityId,
          accountId: held.accountId,
          creditLimit: '1000.00',
          creditDays: 30,
        },
      );
    }
    heldDealers[project] = { accountId: held.accountId, name: HELD_DEALERS[project] };

    const credit = await ensureDealer(executive, 1, CREDIT_DEALERS[project]);
    creditDealers[project] = { accountId: credit.accountId, name: CREDIT_DEALERS[project] };
  }

  const snapshotScope = { entityIds: [SNAPSHOT_COMPANY.entityId] };
  const snapshot = await ensureDealer(executive, SNAPSHOT_COMPANY.entityId, SNAPSHOT_DEALER);
  if (snapshot.made) {
    await executeCommand(executive, snapshotScope, setDealerTerms, {
      entityId: SNAPSHOT_COMPANY.entityId,
      accountId: snapshot.accountId,
      creditLimit: '200000.00',
      creditDays: 30,
    });
    await executeCommand(executive, snapshotScope, recordDealerOutstanding, {
      entityId: SNAPSHOT_COMPANY.entityId,
      accountId: snapshot.accountId,
      outstanding: '45000.00',
      oldestOverdueDays: null,
      oldestOverdueInvoiceNo: null,
      asOf: '2026-09-30',
    });
  }
  const [order] = await asMigrator(
    (m) => m<{ id: string; so_no: string }[]>`
      select id, so_no from sales_orders where account_id = ${snapshot.accountId}
       order by created_at limit 1`,
  );
  let snapshotOrder: { id: string; so_no: string } | undefined = order;
  if (snapshotOrder === undefined) {
    const made = await executeCommand(executive, snapshotScope, createSalesOrder, {
      entityId: SNAPSHOT_COMPANY.entityId,
      accountId: snapshot.accountId,
      lines: [
        { itemId: QUOTE_JOURNEY_IDS.module, qty: '3' },
        { itemId: QUOTE_JOURNEY_IDS.cable, qty: '20' },
      ],
    });
    snapshotOrder = { id: made.id, so_no: made.soNo };
  }
  return {
    acceptLeads,
    heldDealers,
    creditDealers,
    snapshotDealerId: snapshot.accountId,
    snapshotOrderId: snapshotOrder.id,
    snapshotOrderNo: snapshotOrder.so_no,
  };
}
