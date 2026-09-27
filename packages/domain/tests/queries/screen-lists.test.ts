import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  PIPELINE_SEED,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listLeadSources, listPipelines } from '../../src/queries/crm/list-pipelines';
import { listPriceLists, listPrices } from '../../src/queries/pricing/list-prices';

afterAll(closeDb);

// This run's own list and items, so a parallel fixture rebuild never changes what is read.
const openList = newId();
const endedList = newId();
const pricedItem = newId();
const unpricedItem = newId();
const archivedItem = newId();
const tag = newId().slice(-10);
const version = 100_000 + Math.floor(Math.random() * 1_000_000_000);

beforeAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn, unit, archived_at) values
        (${pricedItem}, ${`SL-A-${tag}`}, ${`screen-lists a ${tag}`}, 'pump', '8413', 'nos', null),
        (${unpricedItem}, ${`SL-B-${tag}`}, ${`screen-lists b ${tag}`}, 'cable', '8544', 'metre', null),
        (${archivedItem}, ${`SL-C-${tag}`}, ${`screen-lists c ${tag}`}, 'cable', '8544', 'metre', now())`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, effective_to) values
        (${openList}, ${tierId('dealer')}, 1, ${version}, '2026-04-01', null),
        (${endedList}, ${tierId('dealer')}, 1, ${version + 1}, '2025-04-01', '2025-10-01')`;
      // The history row the database writes for a first price is signed by whoever set it.
      const signer = newId();
      await tx`insert into principals (id, kind, display_name) values (${signer}, 'user', 'screen-lists signer')`;
      await tx`insert into price_list_items (id, price_list_id, item_id, price, created_by) values
        (${newId()}, ${openList}, ${pricedItem}, 24750.00, ${signer})`;
    }),
  );
});

describe('listPipelines and listLeadSources', () => {
  it('answer the active pipelines with their stages in order, and the lead sources', async () => {
    const pipelines = await asPrincipal(principalFor('tele_caller_cc', [1]), listPipelines);
    const keys = pipelines.map((p) => p.key);
    for (const seeded of PIPELINE_SEED) expect(keys).toContain(seeded.key);
    const farmer = pipelines.find((p) => p.key === 'farmer_pumps');
    expect(farmer?.stages.map((s) => s.key)).toEqual([
      'new',
      'contacted',
      'qualified',
      'quoted',
      'won',
      'lost',
    ]);
    const sources = await asPrincipal(principalFor('tele_caller_cc', [1]), listLeadSources);
    expect(sources.length).toBeGreaterThan(0);
    expect(Object.keys(sources[0] ?? {}).sort()).toEqual(['code', 'name']);
  });
});

describe('listPriceLists', () => {
  it('is refused without pricing.read', async () => {
    await expect(
      asPrincipal(principalFor('field_engineer', [1]), (ctx) => listPriceLists(ctx)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shows a company’s own lists only to requests for that company, and marks ended ones', async () => {
    const forOne = await asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
      listPriceLists(ctx, new Date('2026-09-27T06:00:00Z')),
    );
    expect(forOne.find((l) => l.id === openList)).toMatchObject({
      tierCode: 'dealer',
      entityId: 1,
      open: true,
      effectiveFrom: '2026-04-01',
    });
    expect(forOne.find((l) => l.id === endedList)?.open).toBe(false);
    const forTwo = await asPrincipal(principalFor('tele_caller_cc', [2]), (ctx) =>
      listPriceLists(ctx),
    );
    expect(forTwo.map((l) => l.id)).not.toContain(openList);
  });
});

describe('listPrices', () => {
  it('lists active items with their selling price on the list and never a cost', async () => {
    const rows = await asPrincipal(principalFor('accounts', [1]), (ctx) =>
      listPrices(ctx, { priceListId: openList }),
    );
    const mineOnly = rows.filter((r) => r.sku.endsWith(tag));
    expect(mineOnly.map((r) => [r.itemId, r.price])).toEqual([
      [pricedItem, '24750.00'],
      [unpricedItem, null],
    ]);
    expect(Object.keys(mineOnly[0] ?? {}).sort()).toEqual([
      'category',
      'itemId',
      'name',
      'price',
      'sku',
      'unit',
      'updatedAt',
    ]);
  });

  it('answers not found for a list of another company', async () => {
    await expect(
      asPrincipal(principalFor('accounts', [2]), (ctx) =>
        listPrices(ctx, { priceListId: openList }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_list_missing' } });
  });

  it('is refused without pricing.read', async () => {
    await expect(
      asPrincipal(principalFor('field_engineer', [1]), (ctx) =>
        listPrices(ctx, { priceListId: openList }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
