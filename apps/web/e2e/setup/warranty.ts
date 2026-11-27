// R3's warranty journey fixtures (`e2e/warranty.spec.ts`), written by the seed on the host as the
// table owner: per project, a customer of company 1 with a site, a pump and two serials delivered
// to that customer (one in warranty, one whose warranty ended), made once and found again by
// their codes; a claim with the supplier, made again whenever the last one was settled; and a
// closed claim with its costs, made once. Every date, amount and number is a test value.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { PROJECTS, WARRANTY_JOURNEY, warrantyJourneyOf } from '../support/users';

type Sql = Parameters<Parameters<typeof asMigrator>[0]>[0];

const ENTITY = WARRANTY_JOURNEY.entityId;

async function ensureAccount(m: Sql, name: string, village: string, by: string) {
  const [found] = await m<{ id: string; site: string }[]>`
    select a.id, s.id as site from accounts a
      join customer_sites s on s.account_id = a.id
     where a.name = ${name} limit 1`;
  if (found) return found;
  const id = newId();
  const site = newId();
  await m`insert into accounts (id, type, name, created_by) values (${id}, 'farm', ${name}, ${by})`;
  await m`insert into account_entities (id, account_id, entity_id, owner_id, created_by)
          values (${newId()}, ${id}, ${ENTITY}, ${by}, ${by})`;
  await m`insert into customer_sites (id, account_id, type, village, created_by)
          values (${site}, ${id}, 'borewell', ${village}, ${by})`;
  return { id, site };
}

async function ensureItem(m: Sql, sku: string, name: string): Promise<string> {
  const [item] = await m<{ id: string }[]>`select id from items where sku = ${sku}`;
  if (item) return item.id;
  const id = newId();
  await m`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, warranty_months)
          values (${id}, ${sku}, ${name}, 'pump', '8413', 'nos', true, 24)`;
  return id;
}

async function ensureSerial(
  m: Sql,
  itemId: string,
  serialNo: string,
  owner: { id: string; site: string },
  warrantyUntil: string,
  by: string,
): Promise<string> {
  const [serial] = await m<{ id: string }[]>`
    select id from serials where item_id = ${itemId} and serial_no = ${serialNo}`;
  if (serial) return serial.id;
  const id = newId();
  await m`insert into serials (id, entity_id, item_id, serial_no, state, account_id, site_id,
                               delivered_at, warranty_until, created_by)
          values (${id}, ${ENTITY}, ${itemId}, ${serialNo}, 'with_customer', ${owner.id}, ${owner.site},
                  now() - interval '200 days', ${warrantyUntil}, ${by})`;
  return id;
}

/** Makes the warranty fixtures. */
export async function ensureWarrantyJourneys(executiveId: string): Promise<void> {
  await asMigrator(async (m) => {
    const [vendor] = await m<{ id: string }[]>`
      select id from vendors where name = 'Journey pump supplier' limit 1`;
    const vendorId = vendor?.id ?? newId();
    if (!vendor) {
      await m`insert into vendors (id, name, created_by)
              values (${vendorId}, 'Journey pump supplier', ${executiveId})`;
    }
    for (const project of PROJECTS) {
      const j = warrantyJourneyOf(project);
      const owner = await ensureAccount(m, j.farm, j.village, executiveId);
      const itemId = await ensureItem(m, j.sku, j.pump);
      await ensureSerial(m, itemId, j.validSerial, owner, WARRANTY_JOURNEY.validUntil, executiveId);
      await ensureSerial(
        m,
        itemId,
        j.expiredSerial,
        owner,
        WARRANTY_JOURNEY.expiredOn,
        executiveId,
      );

      // A claim with the supplier for this run to settle: made again once the last one is closed.
      // Its failed and replacement serials are its own, already with the supplier and the customer.
      const [waiting] = await m<{ id: string }[]>`
        select c.id from warranty_claims c
         where c.entity_id = ${ENTITY} and c.account_id = ${owner.id} and c.state = 'rma_raised'`;
      if (!waiting) {
        const run = newId().slice(-6).toUpperCase();
        const failed = await ensureSerial(
          m,
          itemId,
          `JWS-${run}-F`,
          owner,
          WARRANTY_JOURNEY.validUntil,
          executiveId,
        );
        const replacement = await ensureSerial(
          m,
          itemId,
          `JWS-${run}-R`,
          owner,
          WARRANTY_JOURNEY.validUntil,
          executiveId,
        );
        await m`update serials set state = 'with_supplier' where id = ${failed}`;
        await m`insert into warranty_claims (id, entity_id, claim_no, account_id, site_id, item_id, serial_id,
                   reported_fault, state, replacement_serial_id, vendor_id, supplier_rma_ref, created_by)
                values (${newId()}, ${ENTITY}, ${`JRN/WC/${run}`}, ${owner.id}, ${owner.site}, ${itemId},
                        ${failed}, 'The pump runs but gives no water', 'rma_raised', ${replacement},
                        ${vendorId}, ${`RMA-${run}`}, ${executiveId})`;
      }

      // The closed claim with its costs, made once.
      const [closed] = await m<{ id: string }[]>`
        select id from warranty_claims where entity_id = ${ENTITY} and claim_no = ${j.closedClaimNo}`;
      if (!closed) {
        const failed = await ensureSerial(
          m,
          itemId,
          `${j.validSerial}-C1`,
          owner,
          WARRANTY_JOURNEY.validUntil,
          executiveId,
        );
        const replacement = await ensureSerial(
          m,
          itemId,
          `${j.validSerial}-C2`,
          owner,
          WARRANTY_JOURNEY.validUntil,
          executiveId,
        );
        await m`update serials set state = 'with_supplier' where id = ${failed}`;
        const id = newId();
        await m`insert into warranty_claims (id, entity_id, claim_no, account_id, site_id, item_id, serial_id,
                   reported_fault, state, state_changed_at, replacement_serial_id, vendor_id, supplier_rma_ref,
                   settlement, created_by, created_at)
                values (${id}, ${ENTITY}, ${j.closedClaimNo}, ${owner.id}, ${owner.site}, ${itemId}, ${failed},
                        'The motor hums and the pump does not start', 'closed', '2026-11-02T04:30:00Z',
                        ${replacement}, ${vendorId}, 'RMA-CLOSED', 'credit', ${executiveId},
                        '2026-10-20T04:30:00Z')`;
        await m`insert into warranty_claim_costs (claim_id, entity_id, replacement_cost, supplier_credit_amount)
                values (${id}, ${ENTITY}, ${WARRANTY_JOURNEY.closedCosts.replacement},
                        ${WARRANTY_JOURNEY.closedCosts.credit})`;
      }
    }
  });
}
