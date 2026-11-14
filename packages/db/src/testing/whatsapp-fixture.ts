// Synthetic WhatsApp rows for the suites on real Postgres (docs/03-roadmap-appendix/phase2.md
// §6.1), written with the migrator connection: a company's WhatsApp number, and a customer of the
// company with a contact, a phone and an open lead, owned by a caller in a team. Every customer,
// phone and person is new on each call (the suites never clean the CRM tables), so two calls never
// meet; the company's number is shared, since a company has one active number per channel. Values
// are test data, never copy.
import { newId, type Principal, type RoleKey } from '@shakti/contracts';
import { PIPELINE_SEED, stageId } from '../../seeds/pipelines';
import { asMigrator, createTestPrincipal } from './index';
import { testPhone } from './phone';

/** The company's active WhatsApp number and how Meta names it (`provider_ref`). */
export interface WhatsAppChannelFixture {
  channelId: string;
  phoneNumberId: string;
}

/**
 * The company's active WhatsApp number, given a provider reference when it has none: the one the
 * suites deliver Meta's test messages to.
 */
export async function whatsappChannel(entityId: number): Promise<WhatsAppChannelFixture> {
  const owner = await createTestPrincipal('executive', [entityId]);
  const phoneNumberId = `10900000000${entityId.toString()}`;
  return asMigrator((m) =>
    m.begin(async (tx) => {
      const [current] = await tx<{ id: string; provider_ref: string | null }[]>`
        select id, provider_ref from entity_channels
         where entity_id = ${entityId} and channel = 'whatsapp' and is_active
         for update`;
      if (current) {
        if (current.provider_ref !== null) {
          return { channelId: current.id, phoneNumberId: current.provider_ref };
        }
        await tx`update entity_channels set provider_ref = ${phoneNumberId} where id = ${current.id}`;
        return { channelId: current.id, phoneNumberId };
      }
      const id = newId();
      await tx`insert into entity_channels (id, entity_id, channel, number_e164, provider_ref, created_by)
        values (${id}, ${entityId}, 'whatsapp', ${`+9190000000${entityId.toString().padStart(2, '0')}`},
                ${phoneNumberId}, ${owner.id})`;
      return { channelId: id, phoneNumberId };
    }),
  );
}

/** A customer of one company with one number and an open lead, and the caller who owns both. */
export interface WhatsAppCustomerFixture {
  entityId: number;
  owner: Principal;
  teamId: string;
  accountId: string;
  contactId: string;
  phoneId: string;
  /** The customer's number in E.164 (`+91…`) and as WhatsApp names it (`91…`). */
  e164: string;
  waId: string;
  opportunityId: string;
}

/**
 * A new customer of the company, owned with its lead by a new caller of `role` in a new team.
 * `e164` gives the customer a number another customer already holds.
 */
export async function whatsappCustomer(
  entityId: number,
  options: { role?: RoleKey; e164?: string } = {},
): Promise<WhatsAppCustomerFixture> {
  const teamId = newId();
  await asMigrator(
    (m) => m`insert into teams (id, entity_id, name) values (${teamId}, ${entityId}, 'whatsapp team')`,
  );
  const owner = await createTestPrincipal(options.role ?? 'tele_caller_cc', [entityId], { teamId });
  const accountId = newId();
  const contactId = newId();
  const phoneId = newId();
  const opportunityId = newId();
  const e164 = options.e164 ?? `+91${testPhone()}`;
  const pipeline = PIPELINE_SEED[0];
  if (!pipeline) throw new Error('pipeline seed missing');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into contacts (id, name, created_by) values (${contactId}, 'whatsapp contact', ${owner.id})`;
      await tx`insert into contact_phones (id, contact_id, e164, is_primary, is_whatsapp, created_by)
        values (${phoneId}, ${contactId}, ${e164}, true, true, ${owner.id})`;
      await tx`insert into accounts (id, type, name, created_by) values (${accountId}, 'farm', 'whatsapp account', ${owner.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, owner_id, team_id, created_by)
        values (${newId()}, ${accountId}, ${entityId}, ${owner.id}, ${teamId}, ${owner.id})`;
      await tx`insert into account_contacts (account_id, contact_id, role, created_by)
        values (${accountId}, ${contactId}, 'owner', ${owner.id})`;
      await tx`insert into opportunities (id, entity_id, account_id, pipeline_id, stage_id, owner_id, team_id, created_by)
        values (${opportunityId}, ${entityId}, ${accountId}, ${pipeline.id}, ${stageId(1, 1)}, ${owner.id}, ${teamId}, ${owner.id})`;
    }),
  );
  return {
    entityId,
    owner,
    teamId,
    accountId,
    contactId,
    phoneId,
    e164,
    waId: e164.slice(1),
    opportunityId,
  };
}
