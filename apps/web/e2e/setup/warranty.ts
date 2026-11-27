// R3's warranty journey fixtures (`e2e/warranty.spec.ts`), written by the seed on the host as the
// table owner: a quarantine bin in the stock journeys' godown; per project, a customer of company
// 1 with a site, a pump with one serial in stock at a test cost (its moving average), a serial
// whose warranty ended, and a serial in warranty no claim has named, made again once a run has
// used it; and a closed claim with its costs, made once. Every date, amount and number is a test
// value.
import { newId } from '@shakti/contracts';
import { asMigrator } from '@shakti/db/testing';
import { PROJECTS, STOCK_JOURNEY, WARRANTY_JOURNEY, warrantyJourneyOf } from '../support/users';

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
    // The stock journeys' godown and first bin, and a quarantine bin beside them.
    const [hub] = await m<{ id: string }[]>`
      select id from warehouses where code = ${STOCK_JOURNEY.hub.code}`;
    if (!hub) throw new Error('the stock journeys make the godown first');
    const [first] = await m<{ id: string }[]>`
      select id from bins where warehouse_id = ${hub.id} and code = ${STOCK_JOURNEY.bins[0]}`;
    const storage = first?.id ?? '';
    const [q] = await m<{ id: string }[]>`
      select id from bins where warehouse_id = ${hub.id} and code = ${WARRANTY_JOURNEY.quarantineBin}`;
    if (!q) {
      await m`insert into bins (id, warehouse_id, code, kind, created_by)
              values (${newId()}, ${hub.id}, ${WARRANTY_JOURNEY.quarantineBin}, 'quarantine', ${executiveId})`;
    }
    for (const project of PROJECTS) {
      const j = warrantyJourneyOf(project);
      const owner = await ensureAccount(m, j.farm, j.village, executiveId);
      const itemId = await ensureItem(m, j.sku, j.pump);
      // A serial in warranty no claim has named yet, made again once a run has used the last one.
      const [fresh] = await m<{ id: string }[]>`
        select s.id from serials s
         where s.item_id = ${itemId} and s.account_id = ${owner.id} and s.state = 'with_customer'
           and s.serial_no like ${`${j.validSerial}-%`}
           and not exists (select 1 from warranty_claims c
                            where s.id in (c.serial_id, c.replacement_serial_id, c.supplier_serial_id))`;
      if (!fresh) {
        const run = newId().slice(-6).toUpperCase();
        await ensureSerial(
          m,
          itemId,
          `${j.validSerial}-${run}`,
          owner,
          WARRANTY_JOURNEY.validUntil,
          executiveId,
        );
      }
      await ensureSerial(
        m,
        itemId,
        j.expiredSerial,
        owner,
        WARRANTY_JOURNEY.expiredOn,
        executiveId,
      );

      // The pump's moving average in company 1, from one serial in stock at a test cost, so a
      // replacement the journey adds without a cost leaves stock at it.
      const [costed] = await m<{ n: number }[]>`
        select count(*)::int as n from item_costs where entity_id = ${ENTITY} and item_id = ${itemId}`;
      if ((costed?.n ?? 0) === 0) {
        await m.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${executiveId}, true),
                          set_config('app.entity_ids', ${`{${String(ENTITY)}}`}, true),
                          set_config('app.permissions', 'inventory.stock.adjust:entity', true)`;
          await tx`select app.stock_move(${tx.json([
            {
              reason: 'adjust_gain',
              entity_id: ENTITY,
              item_id: itemId,
              to_bin_id: storage,
              qty: '1',
              serial_no: `JWR-${WARRANTY_JOURNEY.projects[project].tag}-SEED`,
              unit_cost: WARRANTY_JOURNEY.replacementCost,
              note: 'Journey warranty stock',
            },
          ])})`;
        });
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
