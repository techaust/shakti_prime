import { z } from 'zod';
import { HsnSchema, ItemCategorySchema, ItemUnitSchema } from '../../catalogue/enums';
import { parseItemSpecs } from '../../catalogue/specs';
import { IdSchema } from '../../ids';
import { QuantitySchema } from '../../tax/engine';

/** A stock-keeping code: capitals, digits and `-`, `_`, `/` or `.`, as the group prints them. */
export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9\-_/.]{0,39}$/);

const ItemName = z.string().trim().min(2).max(120);

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
};

interface ItemFields {
  category: z.infer<typeof ItemCategorySchema>;
  isDcr: boolean;
  almmRef?: string | undefined;
  specs: Record<string, unknown>;
}

/** The specifications must fit the category, and DCR and ALMM belong to solar modules. */
function checkItem(value: ItemFields, ctx: z.RefinementCtx): void {
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
