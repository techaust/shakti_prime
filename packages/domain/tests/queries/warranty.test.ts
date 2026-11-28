import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getWarrantyClaim,
  listClaimSerials,
  listWarrantyClaims,
  readWarrantyClaimCosts,
} from '../../src/queries/inventory/warranty';

afterAll(closeDb);

/**
 * R3's reads (docs/03-roadmap-appendix/phase3.md §7.5): a company's claims by state, newest
 * first, one claim's sheet and the customer's delivered serials, none with a cost; a claim's costs
 * only with finance.cost.read.
 */

const tag = newId().slice(-8).toUpperCase();
let exec: Principal;
const account = newId();
const item = newId();
const failed = newId();
const replacement = newId();
const vendor = newId();
const claims = [newId(), newId(), newId()];

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      // A company of its own for this file: company 4, so the lists hold only these claims.
      await tx`insert into accounts (id, type, name, created_by)
        values (${account}, 'farm', ${`Claims farm ${tag}`}, ${exec.id})`;
      await tx`insert into account_entities (id, account_id, entity_id, created_by)
        values (${newId()}, ${account}, 4, ${exec.id})`;
      await tx`insert into items (id, sku, name, category, hsn, unit, is_serial_tracked, is_active)
        values (${item}, ${`CP-${tag}`}, ${`Claims pump ${tag}`}, 'pump', '8413', 'nos', true, true)`;
      await tx`insert into serials (id, entity_id, item_id, serial_no, state, account_id, warranty_until, created_by) values
        (${failed}, 4, ${item}, ${`CF-${tag}`}, 'with_customer', ${account}, '2099-06-30', ${exec.id}),
        (${replacement}, 4, ${item}, ${`CR-${tag}`}, 'with_customer', ${account}, '2099-06-30', ${exec.id})`;
      await tx`insert into vendors (id, name, created_by) values (${vendor}, ${`Claims vendor ${tag}`}, ${exec.id})`;
      const [a, b, c] = claims;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, created_by, created_at)
        values (${a ?? ''}, 4, ${`CQ${tag}/1`}, ${account}, 'Motor hums', 'raised', ${exec.id}, now() - interval '2 days')`;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, item_id, serial_id, reported_fault, state,
                 replacement_serial_id, vendor_id, supplier_rma_ref, created_by, created_at)
        values (${b ?? ''}, 4, ${`CQ${tag}/2`}, ${account}, ${item}, ${failed}, 'No water', 'rma_raised',
                ${replacement}, ${vendor}, 'RMA-9', ${exec.id}, now() - interval '1 day')`;
      await tx`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, rejected_reason, created_by)
        values (${c ?? ''}, 4, ${`CQ${tag}/3`}, ${account}, 'Dropped', 'rejected', 'Physical damage', ${exec.id})`;
      await tx`insert into warranty_claim_costs (claim_id, entity_id, replacement_cost, supplier_credit_amount)
        values (${b ?? ''}, 4, 18500.00, 16250.50)`;
    }),
  );
});

describe('listWarrantyClaims', () => {
  it('pages a company’s claims newest first, by state, with the count in each', async () => {
    const manager = principalFor('inventory_manager', [4]);
    const first = await asPrincipal(manager, (ctx) =>
      listWarrantyClaims(ctx, { entityId: 4, limit: 2 }),
    );
    const mine = (ids: { id: string }[]) =>
      ids.filter((x) => claims.includes(x.id)).map((x) => x.id);
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const rest = await asPrincipal(manager, (ctx) =>
      listWarrantyClaims(ctx, { entityId: 4, limit: 100, cursor: first.nextCursor ?? '' }),
    );
    const order = [...mine(first.items), ...mine(rest.items)];
    expect(order).toEqual([claims[2], claims[1], claims[0]]);
    expect(first.counts.rma_raised).toBeGreaterThanOrEqual(1);
    const awaiting = await asPrincipal(manager, (ctx) =>
      listWarrantyClaims(ctx, { entityId: 4, state: 'rma_raised' }),
    );
    const row = awaiting.items.find((x) => x.id === claims[1]);
    expect(row).toMatchObject({
      state: 'rma_raised',
      account: { id: account, name: `Claims farm ${tag}` },
      serial: { id: failed, serialNo: `CF-${tag}`, warrantyUntil: '2099-06-30' },
      replacementSerial: { id: replacement },
      vendor: { id: vendor },
      supplierRmaRef: 'RMA-9',
    });
    expect(awaiting.items.every((x) => x.state === 'rma_raised')).toBe(true);
    // No cost in the list, whoever reads it.
    const asExec = await asPrincipal(principalFor('executive', [4]), (ctx) =>
      listWarrantyClaims(ctx, { entityId: 4 }),
    );
    expect(JSON.stringify(asExec)).not.toMatch(/18500|16250|cost|credit/i);
  });

  it('pages past two claims raised within one millisecond, keeping both', async () => {
    const [newer, older] = [newId(), newId()];
    await asMigrator(
      (
        m,
      ) => m`insert into warranty_claims (id, entity_id, claim_no, account_id, reported_fault, state, created_by, created_at)
        values (${newer}, 4, ${`CQ${tag}/4`}, ${account}, 'Trips the breaker', 'raised', ${exec.id}, '2001-01-01 00:00:00.000400+00'),
               (${older}, 4, ${`CQ${tag}/5`}, ${account}, 'Trips the breaker', 'raised', ${exec.id}, '2001-01-01 00:00:00.000100+00')`,
    );
    const manager = principalFor('inventory_manager', [4]);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 500; pages += 1) {
      const page = await asPrincipal(manager, (ctx) =>
        listWarrantyClaims(ctx, {
          entityId: 4,
          limit: 1,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      );
      seen.push(...page.items.map((x) => x.id));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    expect(seen.filter((id) => id === newer || id === older)).toEqual([newer, older]);
  });

  it('is refused without inventory.stock.read or warranty.write, and for another company', async () => {
    for (const roleKey of ['tele_caller_cc', 'hr_admin'] as const) {
      await expect(
        asPrincipal(principalFor(roleKey, [4]), (ctx) => listWarrantyClaims(ctx, { entityId: 4 })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(
      asPrincipal(principalFor('inventory_manager', [1]), (ctx) =>
        listWarrantyClaims(ctx, { entityId: 4 }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('getWarrantyClaim and listClaimSerials', () => {
  it('read one claim, and the customer’s delivered serials with their open claim', async () => {
    const gm = principalFor('general_manager', [4]);
    const claim = await asPrincipal(gm, (ctx) =>
      getWarrantyClaim(ctx, { entityId: 4, claimId: claims[2] ?? '' }),
    );
    expect(claim).toMatchObject({ state: 'rejected', rejectedReason: 'Physical damage' });
    await expect(
      asPrincipal(gm, (ctx) => getWarrantyClaim(ctx, { entityId: 4, claimId: newId() })),
    ).rejects.toMatchObject({ code: 'not_found' });
    const { serials } = await asPrincipal(principalFor('inventory_manager', [4]), (ctx) =>
      listClaimSerials(ctx, { entityId: 4, accountId: account }),
    );
    expect(serials.map((s) => [s.id, s.openClaimId])).toEqual(
      expect.arrayContaining([
        [failed, claims[1]],
        [replacement, null],
      ]),
    );
  });
});

describe('readWarrantyClaimCosts', () => {
  it('answers a holder of finance.cost.read only', async () => {
    const costs = await asPrincipal(principalFor('accounts', [4]), (ctx) =>
      readWarrantyClaimCosts(ctx, { entityId: 4, claimId: claims[1] ?? '' }),
    );
    expect(costs).toEqual({
      claimId: claims[1],
      replacementCost: '18500.00',
      supplierCreditAmount: '16250.50',
    });
    for (const roleKey of ['inventory_manager', 'general_manager'] as const) {
      await expect(
        asPrincipal(principalFor(roleKey, [4]), (ctx) =>
          readWarrantyClaimCosts(ctx, { entityId: 4, claimId: claims[1] ?? '' }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
  });
});
