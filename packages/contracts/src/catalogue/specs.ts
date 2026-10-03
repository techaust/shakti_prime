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

export const PipeSpecsSchema = z
  .object({ nominalSizeMm: measure(1, 2000, 0), material: z.string().trim().min(1).max(40) })
  .strict();
export type PipeSpecs = z.infer<typeof PipeSpecsSchema>;

export const InverterSpecsSchema = z.object({ kw }).strict();
export type InverterSpecs = z.infer<typeof InverterSpecsSchema>;

/** Categories with no specifications of their own yet: an empty object. */
export const NoSpecsSchema = z.object({}).strict();

export const ITEM_SPEC_SCHEMAS = {
  pump: PumpSpecsSchema,
  motor: MotorSpecsSchema,
  solar_module: SolarModuleSpecsSchema,
  controller: ControllerSpecsSchema,
  structure: NoSpecsSchema,
  cable: NoSpecsSchema,
  pipe: PipeSpecsSchema,
  inverter: InverterSpecsSchema,
  battery: NoSpecsSchema,
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
 * How the item form asks for each specification, in the order it shows them. The browser keeps
 * a copy (`apps/web/src/screens/contract-values.ts`) that a test holds equal to this one.
 */
export type SpecField =
  | { key: string; kind: 'number'; min: number; max: number; decimals: number }
  | { key: string; kind: 'choice'; options: readonly string[] }
  | { key: string; kind: 'text'; maxLength: number };

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
  structure: [],
  cable: [],
  pipe: [
    { key: 'nominalSizeMm', kind: 'number', min: 1, max: 2000, decimals: 0 },
    { key: 'material', kind: 'text', maxLength: 40 },
  ],
  inverter: [KW],
  battery: [],
  other: [],
};
