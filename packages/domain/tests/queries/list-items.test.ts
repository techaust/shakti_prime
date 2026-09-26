import { newId } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listItems, listItemsWithCost } from '../../src/queries/catalogue/list-items';

afterAll(closeDb);

const itemId = newId();
const tag = newId().slice(-12);

beforeAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, name_hi, category, hsn) values
        (${itemId}, ${`T-${tag}`}, 'list-items item', 'list-items item hi', 'panel', '8541')`;
      await tx`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of) values
        (${newId()}, ${itemId}, 1, 1234.5000, 1300.0000, '2026-09-01T00:00:00Z')`;
    }),
  );
});

describe('listItems', () => {
  it('returns the catalogue without any cost field, for every reader', async () => {
    for (const roleKey of [
      'tele_caller_cc',
      'field_engineer',
      'accounts',
      'agent:sizing',
    ] as const) {
      const items = await asPrincipal(principalFor(roleKey, [1]), listItems);
      const item = items.find((i) => i.id === itemId);
      expect(item).toBeDefined();
      expect(Object.keys(item ?? {}).sort()).toEqual([
        'almmRef',
        'category',
        'hsn',
        'id',
        'isActive',
        'isDcr',
        'isSerialTracked',
        'name',
        'nameHi',
        'sku',
        'unit',
        'updatedAt',
      ]);
    }
  });
});

describe('listItemsWithCost', () => {
  it('is forbidden without finance.cost.read, before any query runs', async () => {
    await expect(
      asPrincipal(principalFor('general_manager', [1]), (ctx) => listItemsWithCost(ctx, 1)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      asPrincipal(principalFor('inventory_manager', [1]), (ctx) => listItemsWithCost(ctx, 1)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an entity outside the request scope', async () => {
    await expect(
      asPrincipal(principalFor('accounts', [1]), (ctx) => listItemsWithCost(ctx, 2)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('returns the cost side for Accounts and the Executive, null where none is recorded', async () => {
    const items = await asPrincipal(principalFor('accounts', [1]), (ctx) =>
      listItemsWithCost(ctx, 1),
    );
    const item = items.find((i) => i.id === itemId);
    expect(item?.cost).toEqual({
      entityId: 1,
      movingAvgCost: '1234.5000',
      lastPurchaseRate: '1300.0000',
      asOf: '2026-09-01T00:00:00.000Z',
    });
    expect(Object.keys(item?.cost ?? {}).sort()).toEqual([
      'asOf',
      'entityId',
      'lastPurchaseRate',
      'movingAvgCost',
    ]);
    const asExecForEntity2 = await asPrincipal(principalFor('executive', [2]), (ctx) =>
      listItemsWithCost(ctx, 2),
    );
    expect(asExecForEntity2.find((i) => i.id === itemId)?.cost).toBeNull();
  });
});
