import { describe, expect, it } from 'vitest';
import { newId } from '../../ids';
import { CreateItemInput, CreateKitInput, SetPumpCurveInput } from './items';

const pump = {
  sku: 'sp-sub-5hp',
  name: 'Submersible pump 5 HP',
  category: 'pump',
  hsn: '84137010',
  unit: 'nos',
  specs: { hp: 5, kw: 3.7, phase: 'three', pumpType: 'submersible', outletMm: 65, maxHeadM: 90 },
};

describe('CreateItemInput stock and warranty (C5)', () => {
  const cable = {
    sku: 'CB-4C-2.5',
    name: 'Cable 4 core 2.5 sq mm',
    category: 'cable',
    hsn: '8544',
    unit: 'metre',
    specs: {},
  };

  it('leaves every new field unset by default, and the item in stock', () => {
    const parsed = CreateItemInput.parse(cable);
    expect(parsed).toMatchObject({
      warrantyMonths: null,
      supplierWarrantyMonths: null,
      barcode: null,
      purchaseUnit: null,
      purchaseUnitFactor: null,
      serialPattern: null,
      isStocked: true,
    });
  });

  it('holds warranty months from 0 to 360', () => {
    for (const months of [0, 12, 360]) {
      expect(CreateItemInput.safeParse({ ...cable, warrantyMonths: months }).success).toBe(true);
    }
    for (const months of [-1, 361, 1.5]) {
      expect(CreateItemInput.safeParse({ ...cable, supplierWarrantyMonths: months }).success).toBe(
        false,
      );
    }
  });

  it('takes a barcode of 4 to 64 printable characters without spaces', () => {
    for (const barcode of ['8901234567890', 'AB-12', '~!@#']) {
      expect(CreateItemInput.safeParse({ ...cable, barcode }).success).toBe(true);
    }
    for (const barcode of ['ABC', 'AB 123', 'A'.repeat(65), 'ÄBCD']) {
      expect(CreateItemInput.safeParse({ ...cable, barcode }).success).toBe(false);
    }
  });

  it('needs a factor of at least 1 for a purchase unit other than the stock unit', () => {
    const coil = { ...cable, purchaseUnit: 'nos', purchaseUnitFactor: '100' };
    expect(CreateItemInput.safeParse(coil).success).toBe(true);
    expect(CreateItemInput.safeParse({ ...coil, purchaseUnitFactor: null }).success).toBe(false);
    expect(CreateItemInput.safeParse({ ...coil, purchaseUnitFactor: '0.5' }).success).toBe(false);
    expect(CreateItemInput.safeParse({ ...coil, purchaseUnitFactor: '2.1234' }).success).toBe(
      false,
    );
    expect(CreateItemInput.safeParse({ ...coil, purchaseUnit: 'metre' }).success).toBe(false);
    expect(
      CreateItemInput.safeParse({ ...coil, purchaseUnit: 'metre', purchaseUnitFactor: '1' })
        .success,
    ).toBe(true);
    expect(
      CreateItemInput.safeParse({ ...coil, purchaseUnit: 'metre', purchaseUnitFactor: null })
        .success,
    ).toBe(true);
    expect(CreateItemInput.safeParse({ ...cable, purchaseUnitFactor: '10' }).success).toBe(false);
    expect(CreateItemInput.safeParse({ ...coil, purchaseUnit: 'roll' }).success).toBe(false);
  });

  it('keeps a serial pattern only on a serial-tracked item, and only one that is safe', () => {
    const tracked = { ...pump, isSerialTracked: true };
    expect(CreateItemInput.safeParse({ ...tracked, serialPattern: 'SP[0-9]{8}' }).success).toBe(
      true,
    );
    expect(CreateItemInput.safeParse({ ...pump, serialPattern: 'SP[0-9]{8}' }).success).toBe(false);
    for (const serialPattern of ['SP[0-9', '[0-9]*', '(a+)+', 'A'.repeat(201)]) {
      const parsed = CreateItemInput.safeParse({ ...tracked, serialPattern });
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0]?.path).toEqual(['serialPattern']);
    }
  });

  it('leaves only an Other item without serials out of stock', () => {
    const labour = { ...cable, category: 'other', unit: 'hour', isStocked: false };
    expect(CreateItemInput.safeParse(labour).success).toBe(true);
    expect(CreateItemInput.safeParse({ ...labour, isSerialTracked: true }).success).toBe(false);
    expect(CreateItemInput.safeParse({ ...cable, isStocked: false }).success).toBe(false);
  });
});

describe('CreateItemInput', () => {
  it('takes a pump with its specifications and writes the code in capitals', () => {
    const parsed = CreateItemInput.parse(pump);
    expect(parsed.sku).toBe('SP-SUB-5HP');
    expect(parsed.isDcr).toBe(false);
  });

  it('takes an HSN code of 4, 6 or 8 digits only', () => {
    for (const hsn of ['8413', '841370', '84137010']) {
      expect(CreateItemInput.safeParse({ ...pump, hsn }).success).toBe(true);
    }
    for (const hsn of ['841', '84137', '8413701', '841370101', '84a3']) {
      expect(CreateItemInput.safeParse({ ...pump, hsn }).success).toBe(false);
    }
  });

  it('refuses specifications of another category, and DCR or ALMM outside solar modules', () => {
    const wrong = CreateItemInput.safeParse({ ...pump, specs: { wp: 540 } });
    expect(wrong.success).toBe(false);
    expect(wrong.error?.issues[0]?.path[0]).toBe('specs');
    expect(CreateItemInput.safeParse({ ...pump, isDcr: true }).success).toBe(false);
    expect(
      CreateItemInput.safeParse({
        ...pump,
        category: 'solar_module',
        specs: { wp: 540 },
        isDcr: true,
        almmRef: 'ALMM-2024-17',
      }).success,
    ).toBe(true);
  });

  it('refuses a unit outside the fixed list and a code with spaces', () => {
    expect(CreateItemInput.safeParse({ ...pump, unit: 'box' }).success).toBe(false);
    expect(CreateItemInput.safeParse({ ...pump, sku: 'SP 5' }).success).toBe(false);
  });
});

describe('CreateKitInput', () => {
  const itemId = newId();
  it('needs at least one component, each item once, each quantity above zero', () => {
    expect(
      CreateKitInput.safeParse({ sku: 'KIT-1', name: 'Pump kit', components: [] }).success,
    ).toBe(false);
    expect(
      CreateKitInput.safeParse({
        sku: 'KIT-1',
        name: 'Pump kit',
        components: [
          { itemId, qty: '1' },
          { itemId, qty: '2' },
        ],
      }).success,
    ).toBe(false);
    expect(
      CreateKitInput.safeParse({
        sku: 'KIT-1',
        name: 'Pump kit',
        components: [{ itemId, qty: '0.000' }],
      }).success,
    ).toBe(false);
    expect(
      CreateKitInput.safeParse({
        sku: 'KIT-1',
        name: 'Pump kit',
        components: [{ itemId, qty: '12.5' }],
      }).success,
    ).toBe(true);
  });
});

describe('SetPumpCurveInput', () => {
  const itemId = newId();
  const points = (pairs: [string, string][]) =>
    pairs.map(([flowLph, headM]) => ({ flowLph, headM }));

  it('takes 2 to 30 points with flow rising and head falling', () => {
    expect(
      SetPumpCurveInput.safeParse({
        itemId,
        points: points([
          ['0', '90'],
          ['6000', '10'],
        ]),
      }).success,
    ).toBe(true);
    expect(SetPumpCurveInput.safeParse({ itemId, points: points([['0', '90']]) }).success).toBe(
      false,
    );
    const many = Array.from({ length: 31 }, (_, i): [string, string] => [
      String(i * 100),
      String(310 - i * 10),
    ]);
    expect(SetPumpCurveInput.safeParse({ itemId, points: points(many) }).success).toBe(false);
    expect(SetPumpCurveInput.safeParse({ itemId, points: points(many.slice(0, 30)) }).success).toBe(
      true,
    );
  });

  it('refuses flow that stays level or head that rises, naming the point', () => {
    const level = SetPumpCurveInput.safeParse({
      itemId,
      points: points([
        ['1000', '80'],
        ['1000', '70'],
      ]),
    });
    expect(level.error?.issues[0]?.path).toEqual(['points', 1, 'flowLph']);
    const rising = SetPumpCurveInput.safeParse({
      itemId,
      points: points([
        ['1000', '80'],
        ['2000', '80.5'],
      ]),
    });
    expect(rising.error?.issues[0]?.path).toEqual(['points', 1, 'headM']);
  });
});

describe('the specifications an item stores', () => {
  it('are the parsed ones: text trimmed', () => {
    const pipe = CreateItemInput.parse({
      sku: 'PIPE-63',
      name: 'HDPE pipe 63 mm',
      category: 'pipe',
      hsn: '3917',
      unit: 'metre',
      specs: { nominalSizeMm: 63, material: '  HDPE  ' },
    });
    expect(pipe.specs).toEqual({ nominalSizeMm: 63, material: 'HDPE' });
  });
});
