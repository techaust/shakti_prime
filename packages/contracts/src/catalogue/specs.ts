import { z } from 'zod';
import type { ItemCategory } from './enums';

/**
 * The specifications of an item by category (INV-01), stored in `items.specs_json`. Sizing (C4),
 * quotes and board cards read them by key, so every key names its unit: `hp`, `kw`, `wp`,
 * `maxHeadM`, `outletMm`. A solar module's DCR mark and ALMM reference are item columns
 * (`is_dcr`, `almm_ref`), not specifications. Each schema is strict: a key outside it is refused.
 */

/** A decimal with at most `decimals` places, from `min` to `max` inclusive. */
const measure = (min: number, max: number, decimals: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(v * 10 ** decimals - Math.round(v * 10 ** decimals)) < 1e-6, {
      message: `at most ${decimals} decimal places`,
    });

export const PhaseSchema = z.enum(['single', 'three']);
export type Phase = z.infer<typeof PhaseSchema>;

export const PumpTypeSchema = z.enum(['surface', 'submersible']);
export type PumpType = z.infer<typeof PumpTypeSchema>;

const hp = measure(0.1, 1000, 2);
const kw = measure(0.01, 10_000, 2);

export const PumpSpecsSchema = z
  .object({
    hp,
    kw,
    phase: PhaseSchema,
    pumpType: PumpTypeSchema,
    outletMm: measure(1, 1000, 0),
    maxHeadM: measure(1, 2000, 1),
  })
  .strict();
export type PumpSpecs = z.infer<typeof PumpSpecsSchema>;

export const MotorSpecsSchema = z.object({ hp, kw, phase: PhaseSchema }).strict();
export type MotorSpecs = z.infer<typeof MotorSpecsSchema>;

export const SolarModuleSpecsSchema = z.object({ wp: measure(1, 2000, 0) }).strict();
export type SolarModuleSpecs = z.infer<typeof SolarModuleSpecsSchema>;

export const ControllerSpecsSchema = z
  .object({ kw, inputMinV: measure(1, 2000, 0), inputMaxV: measure(1, 2000, 0) })
  .strict()
  .refine((v) => v.inputMaxV > v.inputMinV, {
    message: 'the highest input voltage must be above the lowest',
    path: ['inputMaxV'],
  });
export type ControllerSpecs = z.infer<typeof ControllerSpecsSchema>;

const shortText = (max: number) => z.string().trim().min(1).max(max);

/**
 * The specifications stock needs to tell two items of a category apart (phase3 §6.1, C5): each of
 * them optional, so an item made before them stays valid.
 */
export const ConductorSchema = z.enum(['copper', 'aluminium']);
export type Conductor = z.infer<typeof ConductorSchema>;

export const StructureSpecsSchema = z
  .object({
    capacityKwp: measure(0.1, 1000, 2).optional(),
    material: shortText(40).optional(),
  })
  .strict();
export type StructureSpecs = z.infer<typeof StructureSpecsSchema>;

export const CableSpecsSchema = z
  .object({
    cores: measure(1, 61, 0).optional(),
    sizeMm2: measure(0.5, 1000, 2).optional(),
    conductor: ConductorSchema.optional(),
  })
  .strict();
export type CableSpecs = z.infer<typeof CableSpecsSchema>;

export const PipeSpecsSchema = z
  .object({
    nominalSizeMm: measure(1, 2000, 0),
    material: shortText(40),
    pipeClass: shortText(20).optional(),
    pieceLengthM: measure(0.1, 1000, 2).optional(),
  })
  .strict();
export type PipeSpecs = z.infer<typeof PipeSpecsSchema>;

export const InverterSpecsSchema = z
  .object({ kw, kva: kw.optional(), phase: PhaseSchema.optional() })
  .strict();
export type InverterSpecs = z.infer<typeof InverterSpecsSchema>;

export const BatterySpecsSchema = z
  .object({ ah: measure(1, 100_000, 0).optional(), voltageV: measure(1, 2000, 1).optional() })
  .strict();
export type BatterySpecs = z.infer<typeof BatterySpecsSchema>;

/** Categories with no specifications of their own yet: an empty object. */
export const NoSpecsSchema = z.object({}).strict();

export const ITEM_SPEC_SCHEMAS = {
  pump: PumpSpecsSchema,
  motor: MotorSpecsSchema,
  solar_module: SolarModuleSpecsSchema,
  controller: ControllerSpecsSchema,
  structure: StructureSpecsSchema,
  cable: CableSpecsSchema,
  pipe: PipeSpecsSchema,
  inverter: InverterSpecsSchema,
  battery: BatterySpecsSchema,
  other: NoSpecsSchema,
} as const satisfies Record<ItemCategory, z.ZodType>;

/** The specifications of one category, typed. */
export type ItemSpecsOf<C extends ItemCategory> = z.infer<(typeof ITEM_SPEC_SCHEMAS)[C]>;

/** Any category's specifications, as stored and as the item sheet shows them. */
export const ItemSpecsSchema = z.record(z.string(), z.union([z.number(), z.string()]));
export type ItemSpecs = z.infer<typeof ItemSpecsSchema>;

/** Checks `specs` against its category's schema; the issues name the specification's key. */
export function parseItemSpecs(category: ItemCategory, specs: unknown) {
  return ITEM_SPEC_SCHEMAS[category].safeParse(specs);
}

/**
 * The categories an item may be left out of stock in (`items.is_stocked` false): a service or
 * labour is filed under Other. The database's `items_stocked_check` holds the same list.
 */
export const NON_STOCK_CATEGORIES = ['other'] as const satisfies readonly ItemCategory[];

/** Whether an item of this category may be a service, which never reaches the stock ledger. */
export function mayBeUnstocked(category: ItemCategory): boolean {
  return (NON_STOCK_CATEGORIES as readonly ItemCategory[]).includes(category);
}

/**
 * How the item form asks for each specification, in the order it shows them. The browser keeps
 * a copy (`apps/web/src/screens/contract-values.ts`) that a test holds equal to this one. A field
 * marked `optional` may be left blank.
 */
export type SpecField =
  | { key: string; kind: 'number'; min: number; max: number; decimals: number; optional?: true }
  | { key: string; kind: 'choice'; options: readonly string[]; optional?: true }
  | { key: string; kind: 'text'; maxLength: number; optional?: true };

const HP: SpecField = { key: 'hp', kind: 'number', min: 0.1, max: 1000, decimals: 2 };
const KW: SpecField = { key: 'kw', kind: 'number', min: 0.01, max: 10_000, decimals: 2 };
const PHASE: SpecField = { key: 'phase', kind: 'choice', options: PhaseSchema.options };

export const ITEM_SPEC_FIELDS: Readonly<Record<ItemCategory, readonly SpecField[]>> = {
  pump: [
    HP,
    KW,
    PHASE,
    { key: 'pumpType', kind: 'choice', options: PumpTypeSchema.options },
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
    { key: 'conductor', kind: 'choice', options: ConductorSchema.options, optional: true },
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
