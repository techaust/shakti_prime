import { newId, type Principal } from '@shakti/contracts';
import {
  asMigrator,
  asPrincipal,
  closeDb,
  createTestPrincipal,
  principalFor,
} from '@shakti/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseAuditSink as audit, memoryAuditSink } from '../../src/audit/sink';
import type { AnyCommand } from '../../src/command/define-command';
import { runCommand } from '../../src/command/run-command';
import { verhoeffCheckDigit } from '../../src/privacy/verhoeff';
import { createItem, updateItem } from '../../src/commands/catalogue/items';
import { databaseOutboxSink as outbox, memoryOutboxSink } from '../../src/outbox/sink';

// The stock and warranty terms of an item (phase3 §6.1, C5). Items are shared and never cleaned,
// so every code and barcode this file writes carries the run's tag.
afterAll(closeDb);

const tag = newId().slice(-8).toUpperCase();
let seq = 0;
const next = () => String((seq += 1));
const sku = () => `T-${tag}-C5-${next()}`;
const barcode = () => `BC${tag}${next()}`;

const cableInput = () => ({
  sku: sku(),
  name: `Stock test cable ${tag}`,
  category: 'cable',
  hsn: '8544',
  unit: 'metre',
  specs: { cores: 4, sizeMm2: 2.5, conductor: 'copper' },
});

const stockTerms = () => ({
  warrantyMonths: 12,
  supplierWarrantyMonths: 18,
  barcode: barcode(),
  purchaseUnit: 'nos',
  purchaseUnitFactor: '100',
});

interface ItemOut {
  id: string;
  sku: string;
  barcode: string | null;
  warrantyMonths: number | null;
  supplierWarrantyMonths: number | null;
  purchaseUnit: string | null;
  purchaseUnitFactor: string | null;
  serialPattern: string | null;
  isStocked: boolean;
  specs: Record<string, unknown>;
}

let manager: Principal;

beforeAll(async () => {
  manager = await createTestPrincipal('inventory_manager');
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

async function itemRow(id: string) {
  const [row] = await asMigrator(
    (m) => m<{ warranty: number | null; barcode: string | null; stocked: boolean }[]>`
      select warranty_months as warranty, barcode, is_stocked as stocked from items where id = ${id}`,
  );
  return row;
}

describe('catalogue.item.create and .update with stock and warranty (C5)', () => {
  it('is denied to a role without catalogue.write and to an agent, and the item stays', async () => {
    const item = await run<ItemOut>(manager, createItem, { ...cableInput(), ...stockTerms() });
    for (const roleKey of ['store_manager', 'accounts', 'agent:sizing'] as const) {
      const who = principalFor(roleKey, [1]);
      await expect(
        run(who, createItem, { ...cableInput(), ...stockTerms() }),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        run(who, updateItem, { ...cableInput(), itemId: item.id, warrantyMonths: 60 }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    expect((await itemRow(item.id))?.warranty).toBe(12);
  });

  it('refuses an Inventory Manager acting for one company, and the item stays as it was', async () => {
    const item = await run<ItemOut>(manager, createItem, { ...cableInput(), ...stockTerms() });
    for (const entityIds of [[1], [2]]) {
      const one = await createTestPrincipal('inventory_manager', entityIds);
      await expect(
        run(one, updateItem, {
          ...cableInput(),
          itemId: item.id,
          warrantyMonths: 60,
          barcode: barcode(),
        }),
      ).rejects.toMatchObject({
        code: 'forbidden',
        details: { reason: 'catalogue_needs_all_companies' },
      });
      await expect(run(one, createItem, cableInput())).rejects.toMatchObject({
        details: { reason: 'catalogue_needs_all_companies' },
      });
    }
    expect(await itemRow(item.id)).toMatchObject({ warranty: 12, barcode: item.barcode });
  });

  it('creates and changes the terms, and audits each of them before and after', async () => {
    const recorded = memoryAuditSink();
    const emitted = memoryOutboxSink();
    const terms = stockTerms();
    const input = { ...cableInput(), ...terms };
    const created = await asPrincipal(manager, (context) =>
      runCommand(createItem, { context, audit: recorded, outbox: emitted }, input),
    );
    expect(created).toMatchObject({
      ...terms,
      serialPattern: null,
      isStocked: true,
      specs: { cores: 4, sizeMm2: 2.5, conductor: 'copper' },
    });
    expect(recorded.records[0]?.after).toMatchObject({
      warrantyMonths: 12,
      supplierWarrantyMonths: 18,
      barcode: terms.barcode,
      purchaseUnit: 'nos',
      purchaseUnitFactor: '100.000',
      serialPattern: null,
      isStocked: true,
    });

    const changed = await asPrincipal(manager, (context) =>
      runCommand(
        updateItem,
        { context, audit: recorded, outbox: emitted },
        {
          ...input,
          itemId: created.id,
          category: 'pump',
          unit: 'nos',
          isSerialTracked: true,
          specs: {
            hp: 1,
            kw: 0.75,
            phase: 'single',
            pumpType: 'surface',
            outletMm: 25,
            maxHeadM: 30,
          },
          warrantyMonths: 24,
          barcode: null,
          purchaseUnit: null,
          purchaseUnitFactor: null,
          serialPattern: 'SP[0-9]{8}',
        },
      ),
    );
    expect(changed).toMatchObject({
      warrantyMonths: 24,
      supplierWarrantyMonths: 18,
      barcode: null,
      purchaseUnit: null,
      purchaseUnitFactor: null,
      serialPattern: 'SP[0-9]{8}',
    });
    const update = recorded.records[1];
    expect(update?.command).toBe('catalogue.item.update');
    expect(update?.before).toMatchObject({
      warrantyMonths: 12,
      barcode: terms.barcode,
      serialPattern: null,
    });
    expect(update?.after).toMatchObject({
      warrantyMonths: 24,
      barcode: null,
      purchaseUnit: null,
      serialPattern: 'SP[0-9]{8}',
    });
  });

  it('writes the audit row on the database with the terms (no field left undeclared)', async () => {
    const created = await run<ItemOut>(manager, createItem, { ...cableInput(), ...stockTerms() });
    const [row] = await asMigrator(
      (m) => m<{ after: Record<string, unknown> }[]>`
        select after_json as after from audit_logs
         where aggregate_type = 'item' and aggregate_id = ${created.id}
           and command = 'catalogue.item.create'`,
    );
    expect(row?.after).toMatchObject({ warrantyMonths: 12, purchaseUnit: 'nos' });
  });

  it('refuses a barcode another item has with item_barcode_taken', async () => {
    const terms = stockTerms();
    const first = await run<ItemOut>(manager, createItem, { ...cableInput(), ...terms });
    await expect(
      run(manager, createItem, { ...cableInput(), barcode: terms.barcode }),
    ).rejects.toMatchObject({ code: 'conflict', details: { reason: 'item_barcode_taken' } });
    const other = await run<ItemOut>(manager, createItem, cableInput());
    await expect(
      run(manager, updateItem, { ...cableInput(), itemId: other.id, barcode: terms.barcode }),
    ).rejects.toMatchObject({ details: { reason: 'item_barcode_taken' } });
    // The item keeps its own barcode on a change of anything else.
    await expect(
      run(manager, updateItem, { ...cableInput(), ...terms, itemId: first.id, warrantyMonths: 6 }),
    ).resolves.toMatchObject({ barcode: terms.barcode, warrantyMonths: 6 });
  });

  it('keeps a twelve-digit barcode whole, though its check digit is an identity number', async () => {
    // Eleven digits from the run's time, starting 2 to 9, and their Verhoeff check digit: the
    // runner would mask such a number in any field not declared a long number by design.
    const body = `9${String(Date.now()).slice(-10)}`;
    const code = `${body}${verhoeffCheckDigit(body)}`;
    const created = await run<ItemOut>(manager, createItem, { ...cableInput(), barcode: code });
    expect(created.barcode).toBe(code);
    expect((await itemRow(created.id))?.barcode).toBe(code);
  });

  it('refuses a serial pattern that does not compile, matches nothing, or sits on an untracked item', async () => {
    for (const serialPattern of ['SP[0-9', '[0-9]*', '(a+)+$']) {
      await expect(
        run(manager, createItem, {
          ...cableInput(),
          category: 'pump',
          unit: 'nos',
          isSerialTracked: true,
          specs: {
            hp: 1,
            kw: 0.75,
            phase: 'single',
            pumpType: 'surface',
            outletMm: 25,
            maxHeadM: 30,
          },
          serialPattern,
        }),
      ).rejects.toMatchObject({ code: 'validation_failed' });
    }
    await expect(
      run(manager, createItem, { ...cableInput(), serialPattern: 'C[0-9]+' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('leaves an Other item out of stock, and refuses any other category', async () => {
    const labour = await run<ItemOut>(manager, createItem, {
      ...cableInput(),
      name: `Installation labour ${tag}`,
      category: 'other',
      hsn: '9954',
      unit: 'hour',
      specs: {},
      isStocked: false,
    });
    expect(labour.isStocked).toBe(false);
    expect((await itemRow(labour.id))?.stocked).toBe(false);
    await expect(
      run(manager, createItem, { ...cableInput(), isStocked: false }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('the database holds every stock rule by itself (C5)', () => {
  let itemId: string;

  beforeAll(async () => {
    const item = await run<ItemOut>(manager, createItem, cableInput());
    itemId = item.id;
  });

  const refusedBy = (constraint: string, set: string) =>
    expect(
      asMigrator((m) => m.unsafe(`update items set ${set} where id = $1`, [itemId])),
    ).rejects.toMatchObject({ constraint_name: constraint });

  it('refuses warranty months outside 0 to 360', async () => {
    await refusedBy('items_warranty_months_check', 'warranty_months = 361');
    await refusedBy('items_warranty_months_check', 'supplier_warranty_months = -1');
  });

  it('refuses a barcode too short, too long or with a space', async () => {
    await refusedBy('items_barcode_check', `barcode = 'ABC'`);
    await refusedBy('items_barcode_check', `barcode = '${'A'.repeat(65)}'`);
    await refusedBy('items_barcode_check', `barcode = 'AB 1234'`);
  });

  it('refuses a purchase unit outside the list, and a factor without its rules', async () => {
    await refusedBy(
      'items_purchase_unit_check',
      `purchase_unit = 'coil', purchase_unit_factor = 100`,
    );
    await refusedBy(
      'items_purchase_factor_check',
      `purchase_unit = 'nos', purchase_unit_factor = null`,
    );
    await refusedBy(
      'items_purchase_factor_check',
      `purchase_unit = 'nos', purchase_unit_factor = 0.5`,
    );
    await refusedBy(
      'items_purchase_factor_check',
      `purchase_unit = null, purchase_unit_factor = 10`,
    );
    await refusedBy(
      'items_purchase_factor_check',
      `purchase_unit = 'metre', purchase_unit_factor = 2`,
    );
  });

  it('refuses a serial pattern on an untracked item, or longer than 200 characters', async () => {
    await refusedBy('items_serial_pattern_check', `serial_pattern = 'C[0-9]+'`);
    await refusedBy(
      'items_serial_pattern_check',
      `is_serial_tracked = true, serial_pattern = '${'A'.repeat(201)}'`,
    );
  });

  it('refuses a cable left out of stock', async () => {
    await refusedBy('items_stocked_check', 'is_stocked = false');
  });

  it('keeps one barcode to one item', async () => {
    const code = barcode();
    await run(manager, createItem, { ...cableInput(), barcode: code });
    await expect(
      asMigrator((m) => m`update items set barcode = ${code} where id = ${itemId}`),
    ).rejects.toMatchObject({ constraint_name: 'items_barcode_unique' });
  });
});
