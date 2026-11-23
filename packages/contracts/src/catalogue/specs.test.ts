import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { ItemCategorySchema, type ItemCategory } from './enums';
import {
  ITEM_SPEC_FIELDS,
  ITEM_SPEC_SCHEMAS,
  mayBeUnstocked,
  NON_STOCK_CATEGORIES,
  parseItemSpecs,
} from './specs';

const pump = {
  hp: 5,
  kw: 3.7,
  phase: 'three',
  pumpType: 'submersible',
  outletMm: 65,
  maxHeadM: 90,
};

describe('item specifications', () => {
  it('describes every key of every category, in the schema and the form alike', () => {
    for (const category of ItemCategorySchema.options) {
      const schema: z.ZodObject = ITEM_SPEC_SCHEMAS[category];
      expect({ category, keys: ITEM_SPEC_FIELDS[category].map((f) => f.key).sort() }).toEqual({
        category,
        keys: Object.keys(schema.shape).sort(),
      });
    }
  });

  it('accepts a complete pump and refuses a missing or unknown key', () => {
    expect(parseItemSpecs('pump', pump).success).toBe(true);
    const noHead: Record<string, unknown> = { ...pump };
    delete noHead.maxHeadM;
    expect(parseItemSpecs('pump', noHead).success).toBe(false);
    expect(parseItemSpecs('pump', { ...pump, colour: 'blue' }).success).toBe(false);
  });

  it('holds each measure to its range and decimal places', () => {
    expect(parseItemSpecs('pump', { ...pump, hp: 0.1 }).success).toBe(true);
    expect(parseItemSpecs('pump', { ...pump, hp: 0.09 }).success).toBe(false);
    expect(parseItemSpecs('pump', { ...pump, hp: 1000 }).success).toBe(true);
    expect(parseItemSpecs('pump', { ...pump, hp: 1000.01 }).success).toBe(false);
    expect(parseItemSpecs('pump', { ...pump, kw: 0.37 }).success).toBe(true);
    expect(parseItemSpecs('pump', { ...pump, kw: 0.375 }).success).toBe(false);
    expect(parseItemSpecs('pump', { ...pump, outletMm: 65.5 }).success).toBe(false);
    expect(parseItemSpecs('pump', { ...pump, maxHeadM: 90.5 }).success).toBe(true);
    expect(parseItemSpecs('pump', { ...pump, phase: 'two' }).success).toBe(false);
    expect(parseItemSpecs('solar_module', { wp: 545 }).success).toBe(true);
    expect(parseItemSpecs('solar_module', { wp: 545.5 }).success).toBe(false);
  });

  it('needs a controller input range that rises, and an empty object for plain categories', () => {
    expect(parseItemSpecs('controller', { kw: 3, inputMinV: 200, inputMaxV: 800 }).success).toBe(
      true,
    );
    expect(parseItemSpecs('controller', { kw: 3, inputMinV: 800, inputMaxV: 800 }).success).toBe(
      false,
    );
    expect(parseItemSpecs('structure', {}).success).toBe(true);
    expect(parseItemSpecs('structure', { wp: 1 }).success).toBe(false);
    expect(parseItemSpecs('pipe', { nominalSizeMm: 63, material: '  ' }).success).toBe(false);
  });

  it('takes the stock specifications of C5, each optional, in range', () => {
    expect(parseItemSpecs('cable', {}).success).toBe(true);
    expect(parseItemSpecs('cable', { cores: 4, sizeMm2: 2.5, conductor: 'copper' }).success).toBe(
      true,
    );
    expect(parseItemSpecs('cable', { cores: 3.5 }).success).toBe(false);
    expect(parseItemSpecs('cable', { conductor: 'silver' }).success).toBe(false);
    expect(parseItemSpecs('pipe', { nominalSizeMm: 63, material: 'HDPE' }).success).toBe(true);
    expect(
      parseItemSpecs('pipe', {
        nominalSizeMm: 63,
        material: 'HDPE',
        pipeClass: 'PN 6',
        pieceLengthM: 6,
      }).success,
    ).toBe(true);
    expect(
      parseItemSpecs('pipe', { nominalSizeMm: 63, material: 'HDPE', pieceLengthM: 0 }).success,
    ).toBe(false);
    expect(parseItemSpecs('inverter', { kw: 5 }).success).toBe(true);
    expect(parseItemSpecs('inverter', { kw: 5, kva: 6.25, phase: 'single' }).success).toBe(true);
    expect(parseItemSpecs('inverter', { kva: 6 }).success).toBe(false);
    expect(parseItemSpecs('battery', { ah: 150, voltageV: 51.2 }).success).toBe(true);
    expect(parseItemSpecs('battery', { voltageV: 51.25 }).success).toBe(false);
    expect(
      parseItemSpecs('structure', { capacityKwp: 3.3, material: 'Galvanised iron' }).success,
    ).toBe(true);
  });

  it('marks only optional fields optional on the form, and only Other as a possible service', () => {
    for (const [category, fields] of Object.entries(ITEM_SPEC_FIELDS)) {
      const empty = parseItemSpecs(category as ItemCategory, {});
      const required = fields.filter((f) => f.optional !== true);
      expect({ category, emptyAccepted: empty.success }).toEqual({
        category,
        emptyAccepted: required.length === 0,
      });
    }
    expect(NON_STOCK_CATEGORIES).toEqual(['other']);
    expect(mayBeUnstocked('other')).toBe(true);
    expect(mayBeUnstocked('cable')).toBe(false);
  });
});
