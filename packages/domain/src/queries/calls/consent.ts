import type { RequestTx } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether a contact of the customer has withdrawn consent to calls and given none since (CRM-10):
 * such a customer is marked in the queue and cannot be logged as called (PRD CRM-10, TEL-01).
 * Read under the caller's policies: consents are read with the customer, which whoever reads one
 * of its leads reads (0057). `consents_contact_idx` serves both lookups.
 */
export function callConsentWithdrawnSql(accountId: SQL | string): SQL<boolean> {
  return sql<boolean>`exists (
    select 1
      from account_contacts ac
      join consents w on w.contact_id = ac.contact_id
     where ac.account_id = ${accountId}
       and w.channel = 'call'
       and w.withdrawn_at is not null
       and not exists (
         select 1 from consents g
          where g.contact_id = w.contact_id
            and g.channel = 'call'
            and g.withdrawn_at is null
            and g.given_at > w.withdrawn_at))`;
}

export async function callConsentWithdrawn(tx: RequestTx, accountId: string): Promise<boolean> {
  const [row] = (await tx.execute(
    sql`select ${callConsentWithdrawnSql(sql`${accountId}::uuid`)} as withdrawn`,
  )) as unknown as { withdrawn: boolean }[];
  return row?.withdrawn === true;
}

/**
 * Whether the customer may not be called by the rule a dial is checked against (`app.dial_facts()`,
 * design phase2 §5.2, decision 3): a contact of the customer, or anyone holding a number of the
 * customer's contacts on another customer, withdrew consent to calls and gave none since. The
 * Cold Caller queue, the leads list and Account 360's call links read it (Show number reads the
 * same rule through `app.dial_facts()`); a caller reads no other customer's consents, so
 * `app.call_opt_out()` answers the one boolean, and refuses (42501) a caller without
 * `crm.lead.read`, `crm.account.read` or `calls.log`, or a customer of no company of the request.
 */
export function callOptOutSql(accountId: SQL): SQL<boolean> {
  return sql<boolean>`app.call_opt_out(${accountId})`;
}

export async function callOptOut(tx: RequestTx, accountId: string): Promise<boolean> {
  const [row] = (await tx.execute(
    sql`select ${callOptOutSql(sql`${accountId}::uuid`)} as opted_out`,
  )) as unknown as { opted_out: boolean }[];
  return row?.opted_out === true;
}
