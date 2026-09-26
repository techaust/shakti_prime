import { newId } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runCommand } from '../../src/command/run-command';
import { setPrice } from '../../src/commands/pricing/set-price';

afterAll(closeDb);

const ids = {
  sharedList: newId(),
  entity2List: newId(),
  archivedList: newId(),
  item: newId(),
  inactiveItem: newId(),
  kit: newId(),
};
const version = () => Math.floor(Math.random() * 1_000_000_000);
const tag = newId().slice(-12);

beforeAll(async () => {
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, name_hi, category, hsn) values
        (${ids.item}, ${`T-${tag}-A`}, 'set-price item', 'set-price item hi', 'pump', '8413'),
        (${ids.inactiveItem}, ${`T-${tag}-B`}, 'set-price inactive', 'set-price inactive hi', 'pump', '8413')`;
      await tx`update items set is_active = false where id = ${ids.inactiveItem}`;
      await tx`insert into kits (id, sku, name, name_hi) values (${ids.kit}, ${`T-${tag}-K`}, 'set-price kit', 'set-price kit hi')`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from, archived_at) values
        (${ids.sharedList}, ${tierId('commercial')}, null, ${version()}, '2026-04-01', null),
        (${ids.entity2List}, ${tierId('commercial')}, 2, ${version()}, '2026-04-01', null),
        (${ids.archivedList}, ${tierId('commercial')}, null, ${version()}, '2026-04-01', now())`;
    }),
  );
});

const input = { priceListId: ids.sharedList, itemId: ids.item, price: '1500.00' };

describe('pricing.price.set', () => {
  it('is denied for a General Manager', async () => {
    const gm = await createTestPrincipal('general_manager', [1]);
    await expect(
      asPrincipal(gm, (context) => runCommand(setPrice, { context }, input)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('reports a list it cannot see, including one outside the entity scope', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, priceListId: newId() }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_list_missing' } });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, priceListId: ids.entity2List }),
      ),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'price_list_missing' } });
  });

  it('refuses a closed list, an inactive item and an ambiguous target', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, priceListId: ids.archivedList }),
      ),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'price_list_closed' } });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, itemId: ids.inactiveItem }),
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'price_item_missing' },
    });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, kitId: ids.kit }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      asPrincipal(exec, (context) =>
        runCommand(setPrice, { context }, { ...input, price: '0.00' }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('sets a price, logs every change with the previous value, audits and emits', async () => {
    const exec = await createTestPrincipal('executive', [1]);
    const onAudit = vi.fn();
    const onEmit = vi.fn();
    const first = await asPrincipal(exec, (context) =>
      runCommand(setPrice, { context, onAudit, onEmit }, input),
    );
    expect(first).toMatchObject({
      priceListId: ids.sharedList,
      entityId: null,
      tierCode: 'commercial',
      itemId: ids.item,
      kitId: null,
      price: '1500.00',
    });
    expect(Object.keys(first).sort()).toEqual([
      'entityId',
      'id',
      'itemId',
      'kitId',
      'price',
      'priceListId',
      'tierCode',
      'updatedAt',
    ]);
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ command: 'pricing.price.set' }));
    expect(onEmit).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'pricing.price.changed', aggregateId: first.id }),
    ]);

    const second = await asPrincipal(exec, (context) =>
      runCommand(setPrice, { context }, { ...input, price: '1550.00', reason: 'season change' }),
    );
    expect(second.id).toBe(first.id);
    expect(second.price).toBe('1550.00');

    const kitPrice = await asPrincipal(exec, (context) =>
      runCommand(
        setPrice,
        { context },
        { priceListId: ids.sharedList, kitId: ids.kit, price: '9000.00' },
      ),
    );
    expect(kitPrice.kitId).toBe(ids.kit);
    expect(kitPrice.itemId).toBeNull();

    const log = await asPrincipal(exec, async ({ tx }) => {
      const rows = (await tx.execute(sql`
        select old_price, new_price, reason, changed_by from price_change_log
        where price_list_item_id = ${first.id} order by created_at, new_price
      `)) as unknown as {
        old_price: string | null;
        new_price: string;
        reason: string | null;
        changed_by: string;
      }[];
      return rows;
    });
    expect(log).toEqual([
      { old_price: null, new_price: '1500.00', reason: null, changed_by: exec.id },
      { old_price: '1500.00', new_price: '1550.00', reason: 'season change', changed_by: exec.id },
    ]);
  });

  it('is visible to price readers and hidden from roles without pricing.read', async () => {
    const seen = (p: Parameters<typeof asPrincipal>[0]) =>
      asPrincipal(p, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`select id from price_list_items where price_list_id = ${ids.sharedList}`,
        )) as unknown as { id: string }[];
        return rows.length;
      });
    expect(await seen(principalFor('tele_caller_cc', [2]))).toBe(2);
    expect(await seen(principalFor('field_engineer', [1]))).toBe(0);
  });
});
