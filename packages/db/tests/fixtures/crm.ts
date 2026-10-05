// Synthetic CRM rows for the security suite, written with the migrator connection. Fixed ids
// so the fixture is re-creatable; names are labels, not product copy.
import type { Principal } from '@shakti/contracts';
import { asMigrator, principalFor, stageId, PIPELINE_SEED } from '../../src/testing/index';

const P = '01990000-0000-7000-8000-0000000f'; // prefix for fixture ids (8 hex chars follow)
const id = (n: number): string => `${P}${n.toString(16).padStart(4, '0')}`;

export interface CrmFixture {
  teams: { t1: string; t2: string; t3: string };
  /** CC A and B in entity 1 team T1; CC C in entity 1 team T2; lead L over T1; GM of entity 1; CC D in entity 2. */
  principals: {
    a: Principal;
    b: Principal;
    c: Principal;
    l: Principal;
    gm: Principal;
    d: Principal;
  };
  /** Opportunity ids by owner. */
  leads: { a: string[]; b: string[]; c: string[]; d: string[] };
  accounts: { a: string[]; b: string[]; c: string[]; d: string[] };
  contacts: { a: string[]; b: string[]; c: string[]; d: string[] };
}

interface LeadSpec {
  owner: 'a' | 'b' | 'c' | 'd';
  n: number;
  entityId: number;
  teamId: string;
  principalId: string;
}

export async function crmFixture(): Promise<CrmFixture> {
  const teams = { t1: id(0x0101), t2: id(0x0102), t3: id(0x0103) };
  const pid = {
    a: id(0x0201),
    b: id(0x0202),
    c: id(0x0203),
    l: id(0x0204),
    gm: id(0x0205),
    d: id(0x0206),
  };
  const principals = {
    a: principalFor('tele_caller_cc', [1], { id: pid.a, teamId: teams.t1 }),
    b: principalFor('tele_caller_cc', [1], { id: pid.b, teamId: teams.t1 }),
    c: principalFor('tele_caller_cc', [1], { id: pid.c, teamId: teams.t2 }),
    l: principalFor('sales_team_lead', [1], { id: pid.l, teamId: teams.t1 }),
    gm: principalFor('general_manager', [1], { id: pid.gm }),
    d: principalFor('tele_caller_cc', [2], { id: pid.d, teamId: teams.t3 }),
  };

  const specs: LeadSpec[] = [
    { owner: 'a', n: 0, entityId: 1, teamId: teams.t1, principalId: pid.a },
    { owner: 'a', n: 1, entityId: 1, teamId: teams.t1, principalId: pid.a },
    { owner: 'b', n: 2, entityId: 1, teamId: teams.t1, principalId: pid.b },
    { owner: 'c', n: 3, entityId: 1, teamId: teams.t2, principalId: pid.c },
    { owner: 'd', n: 4, entityId: 2, teamId: teams.t3, principalId: pid.d },
  ];
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  const firstStage = stageId(1, 1);

  const leads = { a: [] as string[], b: [] as string[], c: [] as string[], d: [] as string[] };
  const accounts = { a: [] as string[], b: [] as string[], c: [] as string[], d: [] as string[] };
  const contacts = { a: [] as string[], b: [] as string[], c: [] as string[], d: [] as string[] };

  await asMigrator(async (m) => {
    await m.begin(async (tx) => {
      // Remove a previous run in dependency order.
      // Sizings are append-only children of the leads (sizings.test.ts writes them).
      await tx`alter table sizings disable trigger sizings_append_only`;
      await tx`delete from sizings where opportunity_id::text like ${`${P}%`}`;
      await tx`alter table sizings enable trigger sizings_append_only`;
      await tx`delete from consents where id::text like ${`${P}%`}`;
      await tx`delete from opportunities where id::text like ${`${P}%`}`;
      await tx`delete from customer_sites where id::text like ${`${P}%`}`;
      await tx`delete from account_contacts where account_id::text like ${`${P}%`}`;
      await tx`delete from account_entities where account_id::text like ${`${P}%`}`;
      await tx`delete from contact_phones where id::text like ${`${P}%`}`;
      await tx`delete from accounts where id::text like ${`${P}%`}`;
      await tx`delete from contacts where id::text like ${`${P}%`}`;
      await tx`delete from teams where id::text like ${`${P}%`}`;
      await tx`delete from pin_codes where id::text like ${`${P}%`}`;
      await tx`delete from principals where id::text like ${`${P}%`}`;

      for (const [key, principalId] of Object.entries(pid)) {
        await tx`insert into principals (id, kind, display_name) values (${principalId}, 'user', ${`fixture ${key}`})`;
      }
      await tx`insert into teams (id, entity_id, name, lead_principal_id) values
        (${teams.t1}, 1, 'fixture team 1', ${pid.l}), (${teams.t2}, 1, 'fixture team 2', null), (${teams.t3}, 2, 'fixture team 3', null)`;

      for (const s of specs) {
        const base = 0x1000 + s.n * 0x10;
        const contactId = id(base + 1);
        const phoneId = id(base + 2);
        const accountId = id(base + 3);
        const siteId = id(base + 4);
        const consentId = id(base + 5);
        const oppId = id(base + 6);
        const e164 = `+9198000${(10000 + s.n).toString()}`;
        const membershipId = id(base + 7);
        await tx`insert into contacts (id, name, created_by)
          values (${contactId}, ${`fixture contact ${s.n}`}, ${s.principalId})`;
        await tx`insert into contact_phones (id, contact_id, e164, is_primary, is_whatsapp, created_by)
          values (${phoneId}, ${contactId}, ${e164}, true, true, ${s.principalId})`;
        await tx`insert into accounts (id, type, name, created_by)
          values (${accountId}, 'farm', ${`fixture account ${s.n}`}, ${s.principalId})`;
        await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
          values (${membershipId}, ${accountId}, ${s.entityId}, ${s.principalId}, ${s.teamId}, ${s.principalId})`;
        await tx`insert into account_contacts (account_id, contact_id, role, created_by)
          values (${accountId}, ${contactId}, 'owner', ${s.principalId})`;
        await tx`insert into customer_sites (id, account_id, type, village, created_by)
          values (${siteId}, ${accountId}, 'borewell', ${`fixture village ${s.n}`}, ${s.principalId})`;
        await tx`insert into consents (id, contact_id, channel, purpose, source, text_version, given_at, created_by)
          values (${consentId}, ${contactId}, 'whatsapp', 'service', 'walk_in_form', 'v1', now(), ${s.principalId})`;
        await tx`insert into opportunities (id, entity_id, account_id, site_id, pipeline_id, stage_id, owner_id, team_id, created_by)
          values (${oppId}, ${s.entityId}, ${accountId}, ${siteId}, ${pipeline.id}, ${firstStage}, ${s.principalId}, ${s.teamId}, ${s.principalId})`;
        leads[s.owner].push(oppId);
        accounts[s.owner].push(accountId);
        contacts[s.owner].push(contactId);
      }
      // One office of the shared PIN code master, so its reads have a row to find.
      await tx`insert into pin_codes (id, pin, office_name, district, created_by)
        values (${id(0x0e01)}, '999901', 'fixture office', 'fixture district', ${pid.a})`;
      // The shared customer: account 0 (owned by A in entity 1) also deals with entity 2, owned by D.
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${id(0x0f01)}, ${accounts.a[0] ?? ''}, 2, ${pid.d}, ${teams.t3}, ${pid.d})`;
    });
  });

  return { teams, principals, leads, accounts, contacts };
}
