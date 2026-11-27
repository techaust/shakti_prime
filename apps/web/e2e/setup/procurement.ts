// U1's journey fixtures (`e2e/procurement.spec.ts`), written by the seed on the host: two vendors
// of the group with a person and the journeys' cable and module as items supplied, and their
// quotes in the snapshot company: a live quote from each vendor for the cable, and for the module
// a live quote from one and, from the other, a cheaper one that ended long ago, so the comparison
// shows the lowest live rate marked and an expired quote never marked.
// Every rate here is a test value for the journeys alone, never a client figure. Made once with
// fixed ids and dates; only the live quotes' end is moved forward each run, so they stay live.
import { asMigrator } from '@shakti/db/testing';
import { SNAPSHOT_COMPANY, SNAPSHOT_VENDORS } from '../support/users';
import { QUOTE_JOURNEY_IDS } from './quotes';

const id = (n: number) => `0199e2e0-0000-7000-8000-00000000e${n.toString(16).padStart(3, '0')}`;

export const PROCUREMENT_IDS = {
  cables: id(0x001),
  solar: id(0x002),
  cablesPerson: id(0x003),
  cablesCable: id(0x004),
  cablesModule: id(0x005),
  solarCable: id(0x006),
  solarModule: id(0x007),
  quotes: [id(0x010), id(0x011), id(0x012), id(0x013)],
  // Review M1: on the vendor the General Manager and the Store Manager open, a quote to the whole
  // group and one to company 1, which they act in: the rates their check says they never see.
  groupQuote: id(0x014),
  companyOneQuote: id(0x015),
};

/** The day the fixtures are stamped with, so no screenshot shows the day the seed ran. */
const SEEDED_AT = '2026-04-01T00:00:00+05:30';

/** A year from today, in IST: the live quotes' end, moved forward on every run. */
function aYearOn(): string {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 + 365 * 86400 * 1000);
  return ist.toISOString().slice(0, 10);
}

export async function ensureProcurementJourneys(executiveId: string): Promise<void> {
  const ids = PROCUREMENT_IDS;
  const until = aYearOn();
  const company = SNAPSHOT_COMPANY.entityId;
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into vendors (id, name, address_json, payment_terms_days, lead_time_days, created_by, created_at, updated_at) values
        (${ids.cables}, ${SNAPSHOT_VENDORS.cables}, ${tx.json({ city: 'Jodhpur' })}, 30, 7, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ids.solar}, ${SNAPSHOT_VENDORS.solar}, ${tx.json({ city: 'Jaipur' })}, 15, 10, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      await tx`insert into vendor_contacts (id, vendor_id, name, role, position, created_by, created_at, updated_at) values
        (${ids.cablesPerson}, ${ids.cables}, 'Sales desk', 'Orders', 1, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      await tx`insert into item_vendors (id, item_id, vendor_id, vendor_item_code, is_preferred, created_by, created_at, updated_at) values
        (${ids.cablesCable}, ${QUOTE_JOURNEY_IDS.cable}, ${ids.cables}, 'MC-4SQ', true, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ids.cablesModule}, ${QUOTE_JOURNEY_IDS.module}, ${ids.cables}, null, false, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ids.solarCable}, ${QUOTE_JOURNEY_IDS.cable}, ${ids.solar}, null, false, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ids.solarModule}, ${QUOTE_JOURNEY_IDS.module}, ${ids.solar}, 'MST-540', true, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do nothing`;
      const [cableA, cableB, moduleB, ended] = ids.quotes;
      await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, moq, lead_time_days, valid_from, valid_until, recorded_by, created_at, updated_at) values
        (${cableA ?? ''}, ${ids.cables}, ${QUOTE_JOURNEY_IDS.cable}, ${company}, 72.5000, 500, 7, '2026-04-01', ${until}, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${cableB ?? ''}, ${ids.solar}, ${QUOTE_JOURNEY_IDS.cable}, ${company}, 70.2500, 1000, 10, '2026-04-01', ${until}, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${moduleB ?? ''}, ${ids.solar}, ${QUOTE_JOURNEY_IDS.module}, ${company}, 11250.0000, 20, 10, '2026-04-01', ${until}, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ended ?? ''}, ${ids.cables}, ${QUOTE_JOURNEY_IDS.module}, ${company}, 10900.0000, 20, 10, '2026-04-01', '2026-04-30', ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do update set valid_until = excluded.valid_until`;
      // The cable from the cables vendor, dearer than its quote to the snapshot company, so the
      // snapshot company's comparison marks the same cells lowest whatever these add.
      await tx`insert into vendor_quotes (id, vendor_id, item_id, entity_id, rate, moq, lead_time_days, valid_from, valid_until, recorded_by, created_at, updated_at) values
        (${ids.groupQuote}, ${ids.cables}, ${QUOTE_JOURNEY_IDS.cable}, null, 74.0000, 500, 7, '2026-04-01', ${until}, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT}),
        (${ids.companyOneQuote}, ${ids.cables}, ${QUOTE_JOURNEY_IDS.cable}, 1, 71.0000, 500, 7, '2026-04-01', ${until}, ${executiveId}, ${SEEDED_AT}, ${SEEDED_AT})
        on conflict (id) do update set valid_until = excluded.valid_until`;
    }),
  );
}
