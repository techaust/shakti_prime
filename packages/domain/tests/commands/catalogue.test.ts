import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asOutboxPublisher,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { archiveItem, createItem, updateItem } from '../../src/commands/catalogue/items';
import { archiveKit, createKit, updateKit } from '../../src/commands/catalogue/kits';
import { setPumpCurve } from '../../src/commands/catalogue/pump-curve';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';

afterAll(closeDb);

// Items and kits are shared by every company and the suites never clean them, so every code this
// file writes carries the run's tag.
const tag = newId().slice(-8).toUpperCase();
let seq = 0;
const sku = (kind: string) => `T-${tag}-${kind}-${String((seq += 1))}`;

const pumpSpecs = {
  hp: 5,
  kw: 3.7,
  phase: 'three',
  pumpType: 'submersible',
  outletMm: 65,
  maxHeadM: 90,
};
const pumpInput = () => ({
  sku: sku('PUMP'),
  name: `Catalogue test pump ${tag}`,
  category: 'pump',
  hsn: '84137010',
  unit: 'nos',
  isSerialTracked: true,
  specs: pumpSpecs,
});
const cableInput = () => ({
  sku: sku('CABLE'),
  name: `Catalogue test cable ${tag}`,
  category: 'cable',
  hsn: '8544',
  unit: 'metre',
  specs: {},
});

let manager: Principal;

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager', [1]);
});

function run<T = Record<string, unknown>>(
  principal: Principal,
  command: AnyCommand,
  input: unknown,
): Promise<T> {
  return asPrincipal(principal, (context) =>
    runCommand(command, { context, audit, outbox }, input),
  ) as Promise<T>;
}

interface ItemOut {
  id: string;
  sku: string;
  category: string;
  specs: Record<string, unknown>;
  curve: { flowLph: string; headM: string }[];
  isActive: boolean;
}

describe('catalogue.item.create / update / archive', () => {
  it('is denied to a role without catalogue.write, and to an agent', async () => {
    for (const roleKey of [
      'tele_caller_cc',
      'accounts',
      'sales_team_lead',
      'agent:sizing',
    ] as const) {
      await expect(run(principalFor(roleKey, [1]), createItem, pumpInput())).rejects.toMatchObject({
        code: 'forbidden',
      });
    }
  });

  it('creates an item for every company: audited for no one company, the event filed under the caller', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const input = pumpInput();
    const gm = await createTestPrincipal('general_manager', [2]);
    const item = await asPrincipal(gm, (context) =>
      runCommand(createItem, { context, audit: recorded, outbox: emitted }, input),
    );
    expect(item).toMatchObject({
      sku: input.sku,
      category: 'pump',
      hsn: '84137010',
      specs: pumpSpecs,
      curve: [],
      isActive: true,
    });
    expect(recorded.records).toEqual([
      expect.objectContaining({
        command: 'catalogue.item.create',
        aggregateType: 'item',
        aggregateId: item.id,
        entityId: null,
      }),
    ]);
    expect(emitted.records).toEqual([
      expect.objectContaining({
        type: 'catalogue.item.created',
        entityId: 2,
        aggregateId: item.id,
        payload: { category: 'pump', v: 1 },
      }),
    ]);
    // Shared: a reader acting for another company sees it.
    const seen = await asPrincipal(principalFor('tele_caller_cc', [4]), async ({ tx }) => {
      const rows = (await tx.execute(
        sql`select id from items where id = ${item.id}`,
      )) as unknown as { id: string }[];
      return rows.length;
    });
    expect(seen).toBe(1);
  });

  it('refuses a code already in use with item_sku_taken', async () => {
    const input = pumpInput();
    await run(manager, createItem, input);
    await expect(
      run(manager, createItem, { ...input, sku: input.sku.toLowerCase() }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'item_sku_taken' } });
  });

  it('refuses specifications that do not fit the category', async () => {
    await expect(
      run(manager, createItem, { ...pumpInput(), specs: { wp: 540 } }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(run(manager, createItem, { ...cableInput(), isDcr: true })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('updates every field, and a pump that becomes another category loses its curve', async () => {
    const item = await run<ItemOut>(manager, createItem, pumpInput());
    await run(manager, setPumpCurve, {
      itemId: item.id,
      points: [
        { flowLph: '0', headM: '95' },
        { flowLph: '6000', headM: '40' },
      ],
    });
    const renamed = await run<ItemOut>(manager, updateItem, {
      ...pumpInput(),
      itemId: item.id,
      specs: { ...pumpSpecs, maxHeadM: 100.5 },
    });
    expect(renamed.specs.maxHeadM).toBe(100.5);
    expect(renamed.curve).toHaveLength(2);
    const motor = await run<ItemOut>(manager, updateItem, {
      ...pumpInput(),
      itemId: item.id,
      category: 'motor',
      specs: { hp: 5, kw: 3.7, phase: 'three' },
    });
    expect(motor.category).toBe('motor');
    expect(motor.curve).toEqual([]);
    const points = await asMigrator(
      (m) => m`select count(*)::int as n from pump_curves where item_id = ${item.id}`,
    );
    expect(points[0]?.n).toBe(0);
  });

  it('archives an item, then refuses to change it again; an item in a kit still sold is refused', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    const cable = await run<ItemOut>(manager, createItem, cableInput());
    await run(manager, createKit, {
      sku: sku('KIT'),
      name: `Archive guard kit ${tag}`,
      components: [{ itemId: pump.id, qty: '1' }],
    });
    await expect(run(manager, archiveItem, { itemId: pump.id })).rejects.toMatchObject({
      code: 'conflict',
      details: { reason: 'item_in_kit' },
    });
    const archived = await run<ItemOut>(manager, archiveItem, { itemId: cable.id });
    expect(archived.isActive).toBe(false);
    await expect(
      run(manager, updateItem, { ...cableInput(), itemId: cable.id }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'catalogue_item_missing' } });
    await expect(run(manager, archiveItem, { itemId: cable.id })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('the database refuses an item written by a role without catalogue.write', async () => {
    const caller = principalFor('tele_caller_cc', [1]);
    await expect(
      asPrincipal(caller, ({ tx }) =>
        tx.execute(sql`insert into items (id, sku, name, category, hsn)
          values (${newId()}, ${sku('RAW')}, 'raw insert', 'other', '8413')`),
      ),
    ).rejects.toThrow();
  });
});

describe('catalogue.kit.create / update / archive', () => {
  it('is denied to a role without catalogue.write', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    await expect(
      run(principalFor('store_manager', [1]), createKit, {
        sku: sku('KIT'),
        name: 'Refused kit',
        components: [{ itemId: pump.id, qty: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('creates a kit, replaces its components as a set and archives it, audited each time', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    const cable = await run<ItemOut>(manager, createItem, cableInput());
    const recorded = memoryAuditSink();
    const kit = await asPrincipal(manager, (context) =>
      runCommand(
        createKit,
        { context, audit: recorded, outbox },
        {
          sku: sku('KIT'),
          name: `Solar pump kit ${tag}`,
          components: [
            { itemId: pump.id, qty: '1' },
            { itemId: cable.id, qty: '30.5' },
          ],
        },
      ),
    );
    expect(kit.componentCount).toBe(2);
    expect(kit.components.find((c) => c.itemId === cable.id)).toMatchObject({
      qty: '30.5',
      unit: 'metre',
      itemActive: true,
    });
    expect(recorded.records).toEqual([
      expect.objectContaining({ command: 'catalogue.kit.create', entityId: null }),
    ]);

    const updated = await run<{ components: { itemId: string; qty: string }[] }>(
      manager,
      updateKit,
      {
        kitId: kit.id,
        sku: kit.sku,
        name: kit.name,
        components: [{ itemId: pump.id, qty: '2' }],
      },
    );
    expect(updated.components).toEqual([expect.objectContaining({ itemId: pump.id, qty: '2' })]);
    const rows = await asMigrator(
      (m) => m`select item_id, qty::text from kit_components where kit_id = ${kit.id}`,
    );
    expect(rows).toEqual([{ item_id: pump.id, qty: '2.000' }]);

    const archived = await run<{ isActive: boolean }>(manager, archiveKit, { kitId: kit.id });
    expect(archived.isActive).toBe(false);
    await expect(
      run(manager, updateKit, {
        kitId: kit.id,
        sku: kit.sku,
        name: kit.name,
        components: [{ itemId: pump.id, qty: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'catalogue_kit_missing' } });
    // With the kit archived, its pump may leave the catalogue.
    await expect(run(manager, archiveItem, { itemId: pump.id })).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('refuses an archived or unknown component and a code already in use', async () => {
    const cable = await run<ItemOut>(manager, createItem, cableInput());
    await run(manager, archiveItem, { itemId: cable.id });
    const kitSku = sku('KIT');
    await expect(
      run(manager, createKit, {
        sku: kitSku,
        name: 'Kit with an archived item',
        components: [{ itemId: cable.id, qty: '1' }],
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'kit_item_archived' },
    });
    await expect(
      run(manager, createKit, {
        sku: kitSku,
        name: 'Kit with an unknown item',
        components: [{ itemId: newId(), qty: '1' }],
      }),
    ).rejects.toMatchObject({ details: { reason: 'kit_item_archived' } });
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    await run(manager, createKit, {
      sku: kitSku,
      name: 'First kit',
      components: [{ itemId: pump.id, qty: '1' }],
    });
    await expect(
      run(manager, createKit, {
        sku: kitSku,
        name: 'Second kit',
        components: [{ itemId: pump.id, qty: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'kit_sku_taken' } });
  });

  it('the database lets only catalogue.write delete a component', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    const kit = await run<{ id: string }>(manager, createKit, {
      sku: sku('KIT'),
      name: 'Delete guard kit',
      components: [{ itemId: pump.id, qty: '1' }],
    });
    const deleted = (principal: Principal) =>
      asPrincipal(principal, async ({ tx }) => {
        const rows = (await tx.execute(
          sql`delete from kit_components where kit_id = ${kit.id} returning id`,
        )) as unknown as { id: string }[];
        return rows.length;
      });
    expect(await deleted(principalFor('tele_caller_cc', [1]))).toBe(0);
    expect(await deleted(principalFor('accounts', [1]))).toBe(0);
  });
});

describe('catalogue.pump_curve.set', () => {
  const curve = [
    { flowLph: '0', headM: '95' },
    { flowLph: '3000', headM: '80.5' },
    { flowLph: '6000', headM: '40' },
  ];

  it('is denied to a role without catalogue.write', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    await expect(
      run(principalFor('field_engineer', [1]), setPumpCurve, { itemId: pump.id, points: curve }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('replaces the curve as a set, by rising flow, audited and announced', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    const first = await run<ItemOut>(manager, setPumpCurve, { itemId: pump.id, points: curve });
    expect(first.curve).toEqual(curve);
    const emitted = memoryOutboxSink();
    const recorded = memoryAuditSink();
    const second = await asPrincipal(manager, (context) =>
      runCommand(
        setPumpCurve,
        { context, audit: recorded, outbox: emitted },
        { itemId: pump.id, points: curve.slice(1) },
      ),
    );
    expect(second.curve).toEqual(curve.slice(1));
    expect(recorded.records).toEqual([
      expect.objectContaining({
        command: 'catalogue.pump_curve.set',
        aggregateId: pump.id,
        entityId: null,
      }),
    ]);
    expect(emitted.records).toEqual([
      expect.objectContaining({ type: 'catalogue.pump_curve.set', payload: { points: 2, v: 1 } }),
    ]);
  });

  it('refuses an item that is not a pump, one not in the catalogue, and a curve that rises', async () => {
    const cable = await run<ItemOut>(manager, createItem, cableInput());
    await expect(
      run(manager, setPumpCurve, { itemId: cable.id, points: curve }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      details: { reason: 'pump_curve_not_pump' },
    });
    await expect(
      run(manager, setPumpCurve, { itemId: newId(), points: curve }),
    ).rejects.toMatchObject({ code: 'not_found', details: { reason: 'catalogue_item_missing' } });
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    await expect(
      run(manager, setPumpCurve, {
        itemId: pump.id,
        points: [
          { flowLph: '0', headM: '40' },
          { flowLph: '100', headM: '41' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('stores the events with ids and counts only', async () => {
    const pump = await run<ItemOut>(manager, createItem, pumpInput());
    await run(manager, setPumpCurve, { itemId: pump.id, points: curve });
    const events = await asOutboxPublisher(
      (m) => m<{ type: string; payload_json: Record<string, unknown> }[]>`
        select type, payload_json from outbox_events
         where aggregate_id = ${pump.id} order by created_at, type`,
    );
    expect(events.map((e) => e.type).sort()).toEqual([
      'catalogue.item.created',
      'catalogue.pump_curve.set',
    ]);
    for (const e of events) expect(JSON.stringify(e.payload_json)).not.toContain(tag);
  });
});
