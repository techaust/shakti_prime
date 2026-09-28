import { newId } from '@shakti/contracts';
import { asMigrator, asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listItems, listItemsWithCost } from '../../src/queries/catalogue/list-items';
import { encodeCursor } from '../../src/queries/parse-input';

afterAll(closeDb);

const itemId = newId();
const tag = newId().slice(-12);
/** This run's items sit together in name order: every name starts with the prefix. */
const prefix = `list-items ${tag}`;
const MIN_ID = '00000000-0000-7000-8000-000000000000';
/**
 * A cursor just before this run's items: the suites never clean up, so the catalogue also holds
 * every earlier run's items, and reading starts where a page boundary would put it.
 */
const start = encodeCursor({ s: 'name.asc', v: prefix, id: MIN_ID });
/** Three items with one name, so only the id orders them. */
const twins = [newId(), newId(), newId()].sort();

beforeAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn) values
        (${itemId}, ${`T-${tag}`}, ${`${prefix} a`}, 'panel', '8541')`;
      for (const [i, id] of twins.entries()) {
        await tx`insert into items (id, sku, name, category, hsn) values
          (${id}, ${`T-${tag}-${String(i)}`}, ${`${prefix} twin`}, 'pump', '8413')`;
      }
      await tx`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of) values
        (${newId()}, ${itemId}, 1, 1234.5000, 1300.0000, '2026-09-01T00:00:00Z')`;
      await tx`insert into item_costs (id, item_id, entity_id, moving_avg_cost, last_purchase_rate, as_of) values
        (${newId()}, ${twins[0] ?? ''}, 2, 999.0000, 1000.0000, '2026-09-02T00:00:00Z')`;
    }),
  );
});

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Pages from `start` until a row past this run's items, or the end of the catalogue. */
async function mine<T extends { id: string; name: string }>(
  read: (cursor: string) => Promise<Page<T>>,
): Promise<{ rows: T[]; pages: number }> {
  const rows: T[] = [];
  let cursor: string | null = start;
  let pages = 0;
  while (cursor !== null && pages < 20) {
    const page: Page<T> = await read(cursor);
    pages += 1;
    rows.push(...page.items);
    if (page.items.some((i) => !i.name.startsWith(prefix))) break;
    cursor = page.nextCursor;
  }
  return { rows: rows.filter((i) => i.name.startsWith(prefix)), pages };
}

describe('listItems', () => {
  it('returns the catalogue without any cost field, for every reader', async () => {
    for (const roleKey of [
      'tele_caller_cc',
      'field_engineer',
      'accounts',
      'agent:sizing',
    ] as const) {
      const page = await asPrincipal(principalFor(roleKey, [1]), (ctx) =>
        listItems(ctx, { cursor: start }),
      );
      const item = page.items.find((i) => i.id === itemId);
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
        'sku',
        'unit',
        'updatedAt',
      ]);
    }
  });

  it('reads the catalogue a page at a time by name, items with one name in id order', async () => {
    const { rows, pages } = await mine((cursor) =>
      asPrincipal(principalFor('tele_caller_cc', [1]), (ctx) =>
        listItems(ctx, { cursor, limit: 2 }),
      ),
    );
    // Two pages or more: the twins straddle a page boundary and none is read twice or lost.
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(rows.map((i) => i.id)).toEqual([itemId, ...twins]);
  });

  it('bounds a page, 50 unless asked and never more than 200', async () => {
    const reader = principalFor('tele_caller_cc', [1]);
    const one = await asPrincipal(reader, (ctx) => listItems(ctx, { cursor: start, limit: 1 }));
    expect(one.items.map((i) => i.id)).toEqual([itemId]);
    expect(one.nextCursor).not.toBeNull();
    const standard = await asPrincipal(reader, (ctx) => listItems(ctx));
    expect(standard.items.length).toBeLessThanOrEqual(50);
    const most = await asPrincipal(reader, (ctx) => listItems(ctx, { limit: 10_000 }));
    expect(most.items.length).toBeLessThanOrEqual(200);
  });

  it('refuses a cursor that is not one it gave', async () => {
    const reader = principalFor('tele_caller_cc', [1]);
    await expect(
      asPrincipal(reader, (ctx) => listItems(ctx, { cursor: 'not a cursor' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const otherOrder = encodeCursor({ s: 'name.desc', v: prefix, id: MIN_ID });
    await expect(
      asPrincipal(reader, (ctx) => listItems(ctx, { cursor: otherOrder })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
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
    const page = await asPrincipal(principalFor('accounts', [1]), (ctx) =>
      listItemsWithCost(ctx, 1, { cursor: start }),
    );
    const item = page.items.find((i) => i.id === itemId);
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
      listItemsWithCost(ctx, 2, { cursor: start }),
    );
    expect(asExecForEntity2.items.find((i) => i.id === itemId)?.cost).toBeNull();
  });

  it('pages the same way, each item once, with only the asked company’s cost', async () => {
    const { rows } = await mine((cursor) =>
      asPrincipal(principalFor('accounts', [1]), (ctx) =>
        listItemsWithCost(ctx, 1, { cursor, limit: 2 }),
      ),
    );
    expect(rows.map((i) => i.id)).toEqual([itemId, ...twins]);
    // The first twin has a cost in company 2 only: company 1 never sees it.
    expect(rows.find((i) => i.id === twins[0])?.cost).toBeNull();
    expect(rows.every((i) => i.cost === null || i.cost.entityId === 1)).toBe(true);
  });
});
