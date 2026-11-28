// J2 customer loans: the loan journeys' fixtures (`e2e/loans.spec.ts`), written by the seed on the
// host. Per project, a dealer of the journeys' company on the journeys' tier and a fresh draft order
// of it each run, priced from that company's list, so every run records its loan from the start;
// the snapshot company's lists, which other journeys picture, stay as they were. Every figure is a test value for the journeys alone.
import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { createSalesOrder, executeCommand } from '@shakti/domain';
import {
  LOAN_DEALERS,
  PROJECTS,
  QUOTE_JOURNEY_COMPANY,
  type LoanJourneySeed,
} from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

/** A dealer of the journeys' company on the journeys' tier, made once and found again by name. */
async function ensureLoanDealer(executiveId: string, name: string): Promise<string> {
  const entityId = QUOTE_JOURNEY_COMPANY.entityId;
  const [found] = await asMigrator(
    (m) => m<{ id: string }[]>`
      select a.id from accounts a
        join account_entities ae on ae.account_id = a.id and ae.entity_id = ${entityId}
       where a.type = 'dealer' and a.name = ${name} and a.archived_at is null
       limit 1`,
  );
  if (found) return found.id;
  const accountId = newId();
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into accounts (id, type, name, tier_id, created_by)
               values (${accountId}, 'dealer', ${name}, ${QUOTE_JOURNEY_IDS.tier}, ${executiveId})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
               values (${newId()}, ${accountId}, ${entityId}, ${executiveId}, ${executiveId})`;
    }),
  );
  return accountId;
}

/** Makes each project's dealer and a fresh draft order of it, and answers their ids. */
export async function ensureLoanJourneys(executiveId: string): Promise<LoanJourneySeed> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  const scope = { entityIds: [QUOTE_JOURNEY_COMPANY.entityId] };
  const orders = {} as LoanJourneySeed['orders'];
  for (const project of PROJECTS) {
    const dealer = LOAN_DEALERS[project];
    const accountId = await ensureLoanDealer(executiveId, dealer);
    const made = await executeCommand(executive, scope, createSalesOrder, {
      entityId: QUOTE_JOURNEY_COMPANY.entityId,
      accountId,
      lines: [{ itemId: QUOTE_JOURNEY_IDS.module, qty: '4' }],
    });
    orders[project] = { accountId, orderId: made.id, dealer };
  }
  return { orders };
}
