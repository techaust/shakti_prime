// The UAT journeys' fixtures (`e2e/uat.spec.ts`), written by the seed on the host: per project, a
// new dealer of the journeys' company each seed, priced from the journeys' tier, with no credit
// terms, so its first order is held until Accounts and an Executive act. The names carry the
// seed's time, so a run never meets an earlier run's dealer.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import {
  PROJECTS,
  QUOTE_JOURNEY_COMPANY,
  UAT_DEALERS,
  type UatJourneySeed,
} from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

export async function ensureUatJourneys(executiveId: string): Promise<UatJourneySeed> {
  const run = String(Date.now()).slice(-6);
  const dealers = {} as UatJourneySeed['dealers'];
  for (const project of PROJECTS) {
    const name = `${UAT_DEALERS[project]} ${run}`;
    const accountId = newId();
    await asMigrator((m) =>
      m.begin(async (tx) => {
        await tx`insert into accounts (id, type, name, tier_id, created_by)
                 values (${accountId}, 'dealer', ${name}, ${QUOTE_JOURNEY_IDS.tier}, ${executiveId})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
                 values (${newId()}, ${accountId}, ${QUOTE_JOURNEY_COMPANY.entityId}, ${executiveId},
                         ${executiveId})`;
      }),
    );
    dealers[project] = { accountId, name };
  }
  return { dealers };
}
