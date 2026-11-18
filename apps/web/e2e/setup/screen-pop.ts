import { newId } from '@shakti/contracts';
import { asMigrator, principalFor } from '@shakti/db/testing';
import { createLead, executeCommand, setEntityChannel } from '@shakti/domain';
import { POP_CUSTOMERS, POP_DIAL_PHONES, POP_IVR } from '../screen-pop-fixtures';
import { PROJECTS, type ProjectName } from '../support/users';

/** The caller's customer of this name in company 1, made once with this number. */
async function ownCustomer(ownerId: string, name: string, phone: string): Promise<string> {
  const find = () =>
    asMigrator(
      (m) => m<{ contact_id: string }[]>`
        select c.id as contact_id
          from opportunities o
          join account_contacts ac on ac.account_id = o.account_id
          join contacts c on c.id = ac.contact_id
         where o.owner_id = ${ownerId} and o.entity_id = 1 and c.name = ${name}
         limit 1`,
    );
  const [found] = await find();
  if (found !== undefined) return found.contact_id;
  await executeCommand(principalFor('tele_caller_cc', [1], { id: ownerId }), {}, createLead, {
    entityId: 1,
    pipelineKey: 'farmer_pumps',
    contact: { name, phone },
    account: { type: 'farm' },
    site: { type: 'borewell', village: 'Kishangarh', pin: '305801' },
    consent: { channel: 'whatsapp', purpose: 'service', source: 'walk_in_form', textVersion: 'v1' },
    sourceCode: 'walk_in',
  });
  const [made] = await find();
  if (made === undefined) throw new Error(`the screen-pop customer ${name} was not made`);
  return made.contact_id;
}

/**
 * The screen-pop journeys (screen-pop.spec.ts, docs/03-roadmap-appendix/phase2.md §7.4): company 1's
 * incoming calls number, set as an Executive sets it; each project's caller's own phone for calls
 * (the number the IVR rings), kept away so no lead is handed to them; and their customers: one with
 * a number of its own, and two sharing a number (the second given it beside its own, as a family
 * shares a phone).
 */
export async function ensureScreenPopJourneys(
  executiveId: string,
  callerIds: Record<ProjectName, string>,
): Promise<void> {
  const executive = principalFor('executive', [1, 2, 3, 4], { id: executiveId });
  await executeCommand(executive, { entityIds: [1] }, setEntityChannel, {
    entityId: 1,
    channel: 'ivr',
    number: POP_IVR.e164,
    verified: true,
  });
  for (const project of PROJECTS) {
    const callerId = callerIds[project];
    const dialPhone = POP_DIAL_PHONES[project];
    await asMigrator(
      (m) => m`insert into caller_profiles (id, user_id, entity_id, presence, dial_phone_e164)
                 values (${newId()}, ${callerId}, 1, 'away', ${dialPhone})
               on conflict (user_id, entity_id) do update
                 set presence = 'away', dial_phone_e164 = ${dialPhone}`,
    );
    const customers = POP_CUSTOMERS[project];
    await ownCustomer(callerId, customers.one.name, customers.one.phone);
    const [first, second] = customers.shared.names;
    await ownCustomer(callerId, first, customers.shared.phone);
    const contactId = await ownCustomer(callerId, second, customers.shared.ownPhone);
    const shared = `+91${customers.shared.phone.replace(/\D/g, '')}`;
    await asMigrator(
      (
        m,
      ) => m`insert into contact_phones (id, contact_id, e164, is_primary, is_whatsapp, created_by)
               select ${newId()}, ${contactId}, ${shared}, false, false, ${callerId}
                where not exists (select 1 from contact_phones
                                   where contact_id = ${contactId} and e164 = ${shared})`,
    );
  }
}
