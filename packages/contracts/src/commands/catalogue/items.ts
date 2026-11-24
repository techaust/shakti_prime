import { z } from 'zod';
import { HsnSchema, ItemCategorySchema, ItemUnitSchema } from '../../catalogue/enums';
import { serialPatternProblem } from '../../catalogue/serial-pattern';
import { mayBeUnstocked, parseItemSpecs } from '../../catalogue/specs';
import { IdSchema } from '../../ids';
import { QuantitySchema } from '../../tax/engine';

/** A stock-keeping code: capitals, digits and `-`, `_`, `/` or `.`, as the group prints them. */
export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9\-_/.]{0,39}$/);

const ItemName = z.string().trim().min(2).max(120);

/** Months of a warranty: 0 to 30 years. */
export const WarrantyMonthsSchema = z.number().int().min(0).max(360);

/** A supplier's barcode as a scanner sends it: 4 to 64 printable characters, no spaces. */
export const BarcodeSchema = z
  .string()
  .trim()
  .regex(/^[!-~]{4,64}$/);

/** Stock units in one purchase unit (`numeric(12,3)`): at least 1, up to three decimals. */
export const PurchaseUnitFactorSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/)
  .refine((v) => Number(v) >= 1, { message: 'at least 1' });

/** The longest serial pattern an item keeps. */
export const SERIAL_PATTERN_MAX = 200;

/** The fields of an item a person edits; the create and update inputs share them. */
const itemFields = {
  sku: SkuSchema,
  name: ItemName,
  category: ItemCategorySchema,
  hsn: HsnSchema,
  unit: ItemUnitSchema,
  isSerialTracked: z.boolean().default(false),
  /** Made in India cells (DCR), for solar modules only. */
  isDcr: z.boolean().default(false),
  /** The module's ALMM listing, for solar modules only. */
  almmRef: z.string().trim().min(1).max(60).optional(),
  specs: z.record(z.string(), z.unknown()),
  ...stockFields(),
};

/**
 * Stock and warranty (phase3 §6.1, C5), each null when not set. The database holds the same rules
 * (`items_*_check`): months from 0 to 360, a barcode of 4 to 64 printable characters without
 * spaces, a purchase unit from the unit list with its factor of at least 1, a serial pattern of at
 * most 200 characters on a serial-tracked item only, and only an Other item left out of stock.
 */
function stockFields() {
  return {
    warrantyMonths: WarrantyMonthsSchema.nullable().default(null),
    supplierWarrantyMonths: WarrantyMonthsSchema.nullable().default(null),
    barcode: BarcodeSchema.nullable().default(null),
    purchaseUnit: ItemUnitSchema.nullable().default(null),
    purchaseUnitFactor: PurchaseUnitFactorSchema.nullable().default(null),
    serialPattern: z.string().trim().min(1).max(SERIAL_PATTERN_MAX).nullable().default(null),
    isStocked: z.boolean().default(true),
  };
}

interface ItemFields {
  category: z.infer<typeof ItemCategorySchema>;
  unit: z.infer<typeof ItemUnitSchema>;
  isSerialTracked: boolean;
  isDcr: boolean;
  almmRef?: string | undefined;
  specs: Record<string, unknown>;
  purchaseUnit: z.infer<typeof ItemUnitSchema> | null;
  purchaseUnitFactor: string | null;
  serialPattern: string | null;
  isStocked: boolean;
}

/**
 * The stock rules across fields, as `items_purchase_factor_check`, `items_serial_pattern_check`
 * and `items_stocked_check` hold them: a factor only with a purchase unit, required when that
 * unit differs from the stock unit and 1 when it is the same; a pattern that compiles, never
 * matches an empty serial, and belongs to a serial-tracked item; only an Other item without
 * serials left out of stock.
 */
function checkStock(value: ItemFields, ctx: z.RefinementCtx): void {
  const { purchaseUnit, purchaseUnitFactor: factor } = value;
  if (purchaseUnit === null && factor !== null) {
    ctx.addIssue({
      code: 'custom',
      message: 'a factor needs a purchase unit',
      path: ['purchaseUnitFactor'],
    });
  }
  if (purchaseUnit !== null && purchaseUnit !== value.unit && factor === null) {
    ctx.addIssue({ code: 'custom', message: 'a factor is required', path: ['purchaseUnitFactor'] });
  }
  if (
    purchaseUnit !== null &&
    purchaseUnit === value.unit &&
    factor !== null &&
    Number(factor) !== 1
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'the same unit has a factor of 1',
      path: ['purchaseUnitFactor'],
    });
  }
  if (value.serialPattern !== null) {
    if (!value.isSerialTracked) {
      ctx.addIssue({
        code: 'custom',
        message: 'a pattern needs serial tracking',
        path: ['serialPattern'],
      });
    }
    const problem = serialPatternProblem(value.serialPattern);
    if (problem !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `serial pattern ${problem}`,
        path: ['serialPattern'],
      });
    }
  }
  if (!value.isStocked && (!mayBeUnstocked(value.category) || value.isSerialTracked)) {
    ctx.addIssue({
      code: 'custom',
      message: 'only an Other item without serials',
      path: ['isStocked'],
    });
  }
}

/** The specifications must fit the category, and DCR and ALMM belong to solar modules. */
function checkItem(value: ItemFields, ctx: z.RefinementCtx): void {
  checkStock(value, ctx);
  const parsed = parseItemSpecs(value.category, value.specs);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['specs', ...issue.path] });
    }
  }
  if (value.category !== 'solar_module' && (value.isDcr || value.almmRef !== undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'DCR and ALMM apply to solar modules only',
      path: ['isDcr'],
    });
  }
}

/** Keeps the specifications as their schema parsed them (trimmed text, no stray keys). */
function withParsedSpecs<T extends ItemFields>(value: T): T {
  const parsed = parseItemSpecs(value.category, value.specs);
  return parsed.success ? { ...value, specs: parsed.data } : value;
}

/**
 * `catalogue.item.create` (INV-01): an item of the one catalogue every company sells from. The
 * code is unique; the HSN code has 4, 6 or 8 digits.
 */
export const CreateItemInput = z
  .object(itemFields)
  .strict()
  .superRefine(checkItem)
  .transform(withParsedSpecs);
export type CreateItemInput = z.input<typeof CreateItemInput>;

/** `catalogue.item.update`: every editable field of an item, sent as the item sheet shows it. */
export const UpdateItemInput = z
  .object({ itemId: IdSchema, ...itemFields })
  .strict()
  .superRefine(checkItem)
  .transform(withParsedSpecs);
export type UpdateItemInput = z.input<typeof UpdateItemInput>;

/**
 * `catalogue.item.archive`: the item leaves the catalogue; quotes already made keep it. An item
 * inside a kit that is still sold is refused until the kit changes.
 */
export const ArchiveItemInput = z.object({ itemId: IdSchema }).strict();
export type ArchiveItemInput = z.infer<typeof ArchiveItemInput>;

const KitComponents = z
  .array(z.object({ itemId: IdSchema, qty: QuantitySchema }).strict())
  .min(1)
  .max(50)
  .refine((rows) => new Set(rows.map((r) => r.itemId)).size === rows.length, {
    message: 'each item appears once',
  });

/** `catalogue.kit.create` (INV-03): a bundle sold as one line, with its items and quantities. */
export const CreateKitInput = z
  .object({ sku: SkuSchema, name: ItemName, components: KitComponents })
  .strict();
export type CreateKitInput = z.input<typeof CreateKitInput>;

/** `catalogue.kit.update`: the kit's code, name and its components, replaced as a set. */
export const UpdateKitInput = z
  .object({ kitId: IdSchema, sku: SkuSchema, name: ItemName, components: KitComponents })
  .strict();
export type UpdateKitInput = z.input<typeof UpdateKitInput>;

/** `catalogue.kit.archive`: the kit is no longer sold. */
export const ArchiveKitInput = z.object({ kitId: IdSchema }).strict();
export type ArchiveKitInput = z.infer<typeof ArchiveKitInput>;

/** Head in metres (`numeric(8,2)`) and flow in litres an hour (`numeric(12,2)`). */
export const HeadMSchema = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/);
export const FlowLphSchema = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

export const PumpCurvePointSchema = z
  .object({ flowLph: FlowLphSchema, headM: HeadMSchema })
  .strict();
export type PumpCurvePoint = z.infer<typeof PumpCurvePointSchema>;

/**
 * `catalogue.pump_curve.set` (SAL-04): a pump's curve as 2 to 30 points, replacing the one
 * before. In the order sent, flow rises and head falls at every step.
 */
export const SetPumpCurveInput = z
  .object({ itemId: IdSchema, points: z.array(PumpCurvePointSchema).min(2).max(30) })
  .strict()
  .superRefine((value, ctx) => {
    value.points.forEach((point, i) => {
      const before = value.points[i - 1];
      if (before === undefined) return;
      if (Number(point.flowLph) <= Number(before.flowLph)) {
        ctx.addIssue({
          code: 'custom',
          message: 'flow must rise from one point to the next',
          path: ['points', i, 'flowLph'],
        });
      }
      if (Number(point.headM) >= Number(before.headM)) {
        ctx.addIssue({
          code: 'custom',
          message: 'head must fall from one point to the next',
          path: ['points', i, 'headM'],
        });
      }
    });
  });
export type SetPumpCurveInput = z.infer<typeof SetPumpCurveInput>;
