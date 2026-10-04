import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
  tierId,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit } from '../../src/audit/sink';
import { runCommand } from '../../src/command/run-command';
import { setPrice } from '../../src/commands/pricing/set-price';
import { databaseOutboxSink as outbox } from '../../src/outbox/sink';
import { getItem, getKit, listKits } from '../../src/queries/catalogue/catalogue-queries';
import { listItems } from '../../src/queries/catalogue/list-items';
import { listKitPrices, listPriceChanges } from '../../src/queries/pricing/price-history';
import { readTaxSettings } from '../../src/queries/tax/tax-settings';

afterAll(closeDb);

// The catalogue is shared and never cleaned, so this run's rows carry a tag in their code and
// name, and each list is read with a filter on the tag.
const tag = newId().slice(-8).toUpperCase();
const ids = {
  pumpA: newId(),
  pumpB: newId(),
  cable: newId(),
  archived: newId(),
  kit: newId(),
  kitArchived: newId(),
  sharedList: newId(),
  entity2List: newId(),
};
const PUMP_SPECS = {
  hp: 5,
  kw: 3.7,
  phase: 'three',
  pumpType: 'submersible',
  outletMm: 65,
  maxHeadM: 90,
};
const version = () => Math.floor(Math.random() * 1_000_000_000);
let exec: Principal;

beforeAll(async () => {
  exec = await createTestPrincipal('executive');
  await asMigrator((m) =>
    m.begin(async (tx) => {
      await tx`insert into items (id, sku, name, category, hsn, unit, specs_json) values
        (${ids.pumpA}, ${`Q-${tag}-B`}, ${`${tag} alpha pump`}, 'pump', '8413', 'nos',
          ${tx.json(PUMP_SPECS)}),
        (${ids.pumpB}, ${`Q-${tag}-A`}, ${`${tag} beta pump`}, 'pump', '8413', 'nos', '{}'),
        (${ids.cable}, ${`Q-${tag}-C`}, ${`${tag} cable`}, 'cable', '8544', 'metre', '{}')`;
      await tx`insert into items (id, sku, name, category, hsn, archived_at, is_active) values
        (${ids.archived}, ${`Q-${tag}-Z`}, ${`${tag} old pump`}, 'pump', '8413', now(), false)`;
      await tx`insert into pump_curves (id, item_id, head_m, flow_lph) values
        (${newId()}, ${ids.pumpA}, 90.00, 0.00), (${newId()}, ${ids.pumpA}, 45.50, 6000.00)`;
      await tx`insert into kits (id, sku, name) values (${ids.kit}, ${`Q-${tag}-K`}, ${`${tag} kit`})`;
      await tx`insert into kits (id, sku, name, archived_at, is_active) values
        (${ids.kitArchived}, ${`Q-${tag}-KZ`}, ${`${tag} old kit`}, now(), false)`;
      await tx`insert into kit_components (id, kit_id, item_id, qty) values
        (${newId()}, ${ids.kit}, ${ids.pumpA}, 1.000), (${newId()}, ${ids.kit}, ${ids.cable}, 30.500)`;
      await tx`insert into price_lists (id, tier_id, entity_id, version, effective_from) values
        (${ids.sharedList}, ${tierId('dealer')}, null, ${version()}, '2026-04-01'),
        (${ids.entity2List}, ${tierId('dealer')}, 2, ${version()}, '2026-04-01')`;
    }),
  );
  for (const [priceListId, price] of [
    [ids.sharedList, '1000.00'],
    [ids.sharedList, '1200.00'],
    [ids.entity2List, '900.00'],
  ] as const) {
    await asPrincipal(exec, (context) =>
      runCommand(
        setPrice,
        { context, audit, outbox },
        { priceListId, itemId: ids.pumpA, price, reason: `${tag} change` },
      ),
    );
  }
  await asPrincipal(exec, (context) =>
    runCommand(
      setPrice,
      { context, audit, outbox },
      { priceListId: ids.sharedList, kitId: ids.kit, price: '9000.00' },
    ),
  );
});

afterAll(async () => {
  await asMigrator(
    (m) =>
      m`update price_lists set archived_at = now() where id in (${ids.sharedList}, ${ids.entity2List})`,
  );
});

const reader = () => principalFor('tele_caller_cc', [1]);

describe('listItems (Catalogue › Items)', () => {
  it('filters by part of the name or code and by category, leaving archived items out unless asked', async () => {
    const page = await asPrincipal(reader(), (ctx) => listItems(ctx, { q: tag }));
    expect(page.items.map((i) => i.id)).toEqual([ids.pumpA, ids.pumpB, ids.cable]);
    const pumps = await asPrincipal(reader(), (ctx) =>
      listItems(ctx, { q: tag, category: 'pump', includeArchived: true }),
    );
    expect(pumps.items.map((i) => i.id)).toEqual([ids.pumpA, ids.pumpB, ids.archived]);
    const byCode = await asPrincipal(reader(), (ctx) => listItems(ctx, { q: `q-${tag}-c` }));
    expect(byCode.items.map((i) => i.id)).toEqual([ids.cable]);
  });

  it('sorts on the server by any column, a page at a time without loss', async () => {
    const bySku = await asPrincipal(reader(), (ctx) =>
      listItems(ctx, { q: tag, sort: { column: 'sku', direction: 'desc' }, limit: 2 }),
    );
    expect(bySku.items.map((i) => i.sku)).toEqual([`Q-${tag}-C`, `Q-${tag}-B`]);
    const rest = await asPrincipal(reader(), (ctx) =>
      listItems(ctx, {
        q: tag,
        sort: { column: 'sku', direction: 'desc' },
        cursor: bySku.nextCursor ?? undefined,
      }),
    );
    expect(rest.items.map((i) => i.sku)).toEqual([`Q-${tag}-A`]);
    expect(rest.nextCursor).toBeNull();
    await expect(
      asPrincipal(reader(), (ctx) =>
        listItems(ctx, {
          q: tag,
          sort: { column: 'hsn', direction: 'asc' },
          cursor: bySku.nextCursor ?? undefined,
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('item and kit sheets', () => {
  it('reads an item with its specifications and its curve by rising flow', async () => {
    const item = await asPrincipal(reader(), (ctx) => getItem(ctx, { itemId: ids.pumpA }));
    expect(item).toMatchObject({
      specs: { hp: 5, maxHeadM: 90 },
      curve: [
        { flowLph: '0', headM: '90' },
        { flowLph: '6000', headM: '45.5' },
      ],
    });
    await expect(
      asPrincipal(reader(), (ctx) => getItem(ctx, { itemId: newId() })),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'catalogue_item_missing' } });
  });

  it('lists kits with their component count and reads a kit with its components', async () => {
    const kits = await asPrincipal(reader(), (ctx) => listKits(ctx, { q: tag }));
    expect(kits.items).toEqual([
      expect.objectContaining({ id: ids.kit, componentCount: 2, isActive: true }),
    ]);
    const all = await asPrincipal(reader(), (ctx) =>
      listKits(ctx, { q: tag, includeArchived: true, sort: { column: 'sku', direction: 'desc' } }),
    );
    expect(all.items.map((k) => k.id)).toEqual([ids.kitArchived, ids.kit]);
    const kit = await asPrincipal(reader(), (ctx) => getKit(ctx, { kitId: ids.kit }));
    expect(kit.components.map((c) => [c.itemId, c.qty])).toEqual([
      [ids.pumpA, '1'],
      [ids.cable, '30.5'],
    ]);
  });
});

describe('listKitPrices and listPriceChanges (Price Master)', () => {
  it('lists the kits still sold with their price on one list, a kit not priced with none', async () => {
    const page = await asPrincipal(reader(), (ctx) =>
      listKitPrices(ctx, { priceListId: ids.sharedList, limit: 200 }),
    );
    const mine = page.items.filter((k) => k.name.startsWith(tag));
    expect(mine).toEqual([expect.objectContaining({ kitId: ids.kit, price: '9000.00' })]);
    await expect(
      asPrincipal(principalFor('field_engineer', [1]), (ctx) =>
        listKitPrices(ctx, { priceListId: ids.sharedList }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('shows an item’s changes newest first, only on the lists the reader can see', async () => {
    const all = await asPrincipal(principalFor('tele_caller_cc', [1, 2]), (ctx) =>
      listPriceChanges(ctx, { itemId: ids.pumpA }),
    );
    expect(all.items.map((c) => [c.oldPrice, c.newPrice])).toEqual([
      [null, '900.00'],
      ['1000.00', '1200.00'],
      [null, '1000.00'],
    ]);
    expect(all.items[0]).toMatchObject({
      entityId: 2,
      reason: `${tag} change`,
      changedByName: 'test executive',
    });
    const one = await asPrincipal(reader(), (ctx) =>
      listPriceChanges(ctx, { itemId: ids.pumpA, limit: 1 }),
    );
    expect(one.items.map((c) => c.newPrice)).toEqual(['1200.00']);
    const next = await asPrincipal(reader(), (ctx) =>
      listPriceChanges(ctx, { itemId: ids.pumpA, cursor: one.nextCursor ?? undefined }),
    );
    expect(next.items.map((c) => c.newPrice)).toEqual(['1000.00']);
    const kit = await asPrincipal(reader(), (ctx) => listPriceChanges(ctx, { kitId: ids.kit }));
    expect(kit.items.map((c) => c.newPrice)).toEqual(['9000.00']);
    await expect(
      asPrincipal(principalFor('field_engineer', [1]), (ctx) =>
        listPriceChanges(ctx, { itemId: ids.pumpA }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('readTaxSettings (Settings › Tax)', () => {
  it('reads rates with their item and composite rules, for any reader with a context', async () => {
    const settings = await asPrincipal(principalFor('accounts', [1]), (ctx) =>
      readTaxSettings(ctx),
    );
    expect(Array.isArray(settings.rates)).toBe(true);
    expect(Array.isArray(settings.compositeRules)).toBe(true);
    expect(settings.coversAllCompanies).toBe(false);
    const all = await asPrincipal(principalFor('accounts'), (ctx) => readTaxSettings(ctx));
    expect(all.coversAllCompanies).toBe(true);
    for (const rate of settings.rates) {
      expect(rate.hsn === null).toBe(rate.itemId !== null);
    }
  });
});
