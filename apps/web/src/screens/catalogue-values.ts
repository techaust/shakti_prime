import type { ItemCategory, SpecField } from '@shakti/contracts';

// The catalogue screens' copies of the contracts' values (the item form's specifications and its
// stock and warranty limits), apart from `contract-values.ts` so only the catalogue's pages carry
// them; `contract-values.test.ts` keeps them equal to the contracts.

const HP: SpecField = { key: 'hp', kind: 'number', min: 0.1, max: 1000, decimals: 2 };
const KW: SpecField = { key: 'kw', kind: 'number', min: 0.01, max: 10_000, decimals: 2 };
const PHASE: SpecField = { key: 'phase', kind: 'choice', options: ['single', 'three'] };

/** How the item form asks for each category's specifications (`ITEM_SPEC_FIELDS`). */
export const ITEM_SPEC_FIELDS: Readonly<Record<ItemCategory, readonly SpecField[]>> = {
  pump: [
    HP,
    KW,
    PHASE,
    { key: 'pumpType', kind: 'choice', options: ['surface', 'submersible'] },
    { key: 'outletMm', kind: 'number', min: 1, max: 1000, decimals: 0 },
    { key: 'maxHeadM', kind: 'number', min: 1, max: 2000, decimals: 1 },
  ],
  motor: [HP, KW, PHASE],
  solar_module: [{ key: 'wp', kind: 'number', min: 1, max: 2000, decimals: 0 }],
  controller: [
    KW,
    { key: 'inputMinV', kind: 'number', min: 1, max: 2000, decimals: 0 },
    { key: 'inputMaxV', kind: 'number', min: 1, max: 2000, decimals: 0 },
  ],
  structure: [
    { key: 'capacityKwp', kind: 'number', min: 0.1, max: 1000, decimals: 2, optional: true },
    { key: 'material', kind: 'text', maxLength: 40, optional: true },
  ],
  cable: [
    { key: 'cores', kind: 'number', min: 1, max: 61, decimals: 0, optional: true },
    { key: 'sizeMm2', kind: 'number', min: 0.5, max: 1000, decimals: 2, optional: true },
    { key: 'conductor', kind: 'choice', options: ['copper', 'aluminium'], optional: true },
  ],
  pipe: [
    { key: 'nominalSizeMm', kind: 'number', min: 1, max: 2000, decimals: 0 },
    { key: 'material', kind: 'text', maxLength: 40 },
    { key: 'pipeClass', kind: 'text', maxLength: 20, optional: true },
    { key: 'pieceLengthM', kind: 'number', min: 0.1, max: 1000, decimals: 2, optional: true },
  ],
  inverter: [
    KW,
    { key: 'kva', kind: 'number', min: 0.01, max: 10_000, decimals: 2, optional: true },
    { ...PHASE, optional: true },
  ],
  battery: [
    { key: 'ah', kind: 'number', min: 1, max: 100_000, decimals: 0, optional: true },
    { key: 'voltageV', kind: 'number', min: 1, max: 2000, decimals: 1, optional: true },
  ],
  other: [],
};

/** Stock and warranty on the item form (C5): `NON_STOCK_CATEGORIES`, the months, the pattern. */
export const NON_STOCK_CATEGORIES = ['other'] as const satisfies readonly ItemCategory[];
export const WARRANTY_MONTHS_MAX = 360;
export const SERIAL_PATTERN_MAX = 200;
export const BARCODE_MAX_LENGTH = 64;

/** Every specification key, and those measured in numbers (each has a unit on screen). */
export const SPEC_KEYS = [
  'hp',
  'kw',
  'phase',
  'pumpType',
  'outletMm',
  'maxHeadM',
  'wp',
  'inputMinV',
  'inputMaxV',
  'nominalSizeMm',
  'material',
  'capacityKwp',
  'cores',
  'sizeMm2',
  'conductor',
  'pipeClass',
  'pieceLengthM',
  'kva',
  'ah',
  'voltageV',
] as const;
export type SpecKey = (typeof SPEC_KEYS)[number];
export const NUMERIC_SPEC_KEYS = [
  'hp',
  'kw',
  'outletMm',
  'maxHeadM',
  'wp',
  'inputMinV',
  'inputMaxV',
  'nominalSizeMm',
  'capacityKwp',
  'cores',
  'sizeMm2',
  'pieceLengthM',
  'kva',
  'ah',
  'voltageV',
] as const satisfies readonly SpecKey[];
export type NumericSpecKey = (typeof NUMERIC_SPEC_KEYS)[number];
