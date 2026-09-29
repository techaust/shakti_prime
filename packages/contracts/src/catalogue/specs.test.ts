import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ItemCategorySchema } from './enums';
import { ITEM_SPEC_FIELDS, ITEM_SPEC_SCHEMAS, parseItemSpecs } from './specs';

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
    const { maxHeadM: _dropped, ...noHead } = pump;
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
});
