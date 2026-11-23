import { describe, expect, it } from 'vitest';
import { planItemRow, readItemRow, type ExistingItem } from './items';

const mapping = {
  columns: {
    sku: 'Code',
    itemName: 'Name',
    category: 'Category',
    hsn: 'HSN',
    unit: 'Unit',
    purchaseUnit: 'Buy unit',
    purchaseUnitFactor: 'Factor',
    isSerialTracked: 'Serial',
    isDcr: 'DCR',
    warrantyMonths: 'Warranty',
    barcode: 'Barcode',
    serialPattern: 'Pattern',
  },
  defaults: {},
};

const row = (cells: Record<string, string>) => readItemRow(cells, mapping);

describe('readItemRow', () => {
  it('reads the words people write for categories, units, yes and no, and grouped HSN codes', () => {
    const read = row({
      Code: ' cb-4c ',
      Name: 'Cable  4 core',
      Category: 'Solar Panel',
      HSN: '8541.40.11',
      Unit: 'Pcs',
      'Buy unit': 'Mtrs',
      Factor: '1,000',
      Serial: 'Y',
      DCR: 'no',
      Warranty: '60',
    });
    expect(read).toEqual({
      state: 'valid',
      errors: [],
      input: {
        sku: 'CB-4C',
        given: {
          name: 'Cable 4 core',
          category: 'solar_module',
          hsn: '85414011',
          unit: 'nos',
          purchaseUnit: 'metre',
          purchaseUnitFactor: '1000',
          isSerialTracked: true,
          isDcr: false,
          warrantyMonths: 60,
        },
      },
    });
  });

  it('gives nothing for a blank cell, and needs only the code', () => {
    expect(row({ Code: 'A1' })).toEqual({
      state: 'valid',
      errors: [],
      input: { sku: 'A1', given: {} },
    });
    expect(row({ Name: 'No code' })).toMatchObject({
      state: 'invalid',
      errors: [{ field: 'sku', code: 'required' }],
    });
  });

  it('refuses each value outside its list with its own reason', () => {
    const read = row({
      Code: 'A1',
      Category: 'Gadget',
      HSN: '84137',
      Unit: 'Furlong',
      Serial: 'maybe',
      Warranty: '400',
      Pattern: '(a+)+',
      Barcode: 'XXXXXXXX6789',
    });
    expect(read.errors).toEqual([
      { field: 'category', code: 'category_unknown' },
      { field: 'hsn', code: 'hsn_invalid' },
      { field: 'unit', code: 'unit_unknown' },
      { field: 'isSerialTracked', code: 'invalid' },
      { field: 'warrantyMonths', code: 'invalid' },
      { field: 'barcode', code: 'barcode_hidden' },
      { field: 'serialPattern', code: 'serial_pattern_invalid' },
    ]);
  });

  it('refuses a malformed barcode or factor through the row contract', () => {
    expect(row({ Code: 'A1', Barcode: 'AB 12' }).errors).toEqual([
      { field: 'barcode', code: 'invalid' },
    ]);
    expect(row({ Code: 'A1', Factor: '0.5' }).errors).toEqual([
      { field: 'purchaseUnitFactor', code: 'invalid' },
    ]);
  });
});

const existing: ExistingItem = {
  id: '01990000-0000-7000-8000-00000000c501',
  sku: 'A1',
  name: 'Existing cable',
  category: 'cable',
  hsn: '8544',
  unit: 'metre',
  isSerialTracked: false,
  isDcr: false,
  almmRef: null,
  specsJson: { cores: 2 },
  warrantyMonths: 6,
  supplierWarrantyMonths: null,
  barcode: 'OLD1',
  purchaseUnit: null,
  purchaseUnitFactor: null,
  serialPattern: null,
  isStocked: true,
  archivedAt: null,
};

describe('planItemRow', () => {
  it('changes a known item with the fields given over what it has', () => {
    const plan = planItemRow({ sku: 'A1', given: { warrantyMonths: 12 } }, existing);
    expect(plan).toMatchObject({
      kind: 'update',
      input: {
        itemId: existing.id,
        name: 'Existing cable',
        warrantyMonths: 12,
        barcode: 'OLD1',
        specs: { cores: 2 },
      },
    });
  });

  it('needs the name, category, HSN code and unit of a new item', () => {
    expect(planItemRow({ sku: 'NEW', given: { name: 'New cable' } }, undefined)).toEqual({
      kind: 'refused',
      errors: [
        { field: 'category', code: 'required' },
        { field: 'hsn', code: 'required' },
        { field: 'unit', code: 'required' },
      ],
    });
  });

  it('sends a category with required details to the item sheet, new or changed', () => {
    const pump = { name: 'Pump', category: 'pump', hsn: '8413', unit: 'nos' } as const;
    expect(planItemRow({ sku: 'NEW', given: pump }, undefined)).toEqual({
      kind: 'refused',
      errors: [{ field: 'category', code: 'item_details_needed' }],
    });
    expect(planItemRow({ sku: 'A1', given: { category: 'pump' } }, existing)).toEqual({
      kind: 'refused',
      errors: [{ field: 'category', code: 'item_details_needed' }],
    });
  });

  it('refuses an item no longer sold, and a pattern on an untracked item', () => {
    expect(planItemRow({ sku: 'A1', given: {} }, { ...existing, archivedAt: new Date() })).toEqual({
      kind: 'refused',
      errors: [{ field: 'sku', code: 'item_archived' }],
    });
    expect(planItemRow({ sku: 'A1', given: { serialPattern: 'C[0-9]+' } }, existing)).toEqual({
      kind: 'refused',
      errors: [{ field: 'serialPattern', code: 'serial_pattern_invalid' }],
    });
  });
});
