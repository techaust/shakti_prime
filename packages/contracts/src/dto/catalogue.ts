import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema, MoneySchema } from '../catalogue/enums';
import { ItemSpecsSchema } from '../catalogue/specs';
import { FlowLphSchema, HeadMSchema } from '../commands/catalogue/items';
import { EntityIdSchema, IdSchema } from '../ids';
import { CompositeRuleRowSchema, TaxRateRowSchema } from '../tax/engine';
import { ItemDto } from './item';
import { KitSortSchema, ItemSortSchema, KitPriceSortSchema } from './list-sort';

/** One point of a pump's curve, flow in litres an hour and head in metres. */
export const PumpCurvePointDto = z.object({ flowLph: FlowLphSchema, headM: HeadMSchema }).strict();
export type PumpCurvePointDto = z.infer<typeof PumpCurvePointDto>;

/** The item sheet: an item with its specifications and, for a pump, its curve by rising flow. */
export const ItemDetailDto = ItemDto.extend({
  specs: ItemSpecsSchema,
  curve: z.array(PumpCurvePointDto),
}).strict();
export type ItemDetailDto = z.infer<typeof ItemDetailDto>;

/** A kit as the kits grid shows it. */
export const KitDto = z
  .object({
    id: IdSchema,
    sku: z.string(),
    name: z.string(),
    isActive: z.boolean(),
    componentCount: z.number().int().min(0),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type KitDto = z.infer<typeof KitDto>;

/** One item of a kit and how many of it the kit holds. */
export const KitComponentDto = z
  .object({
    itemId: IdSchema,
    sku: z.string(),
    name: z.string(),
    category: ItemCategorySchema,
    unit: ItemUnitSchema,
    qty: z.string(),
    /** False once the item has been archived: the kit must change before it is sold again. */
    itemActive: z.boolean(),
  })
  .strict();
export type KitComponentDto = z.infer<typeof KitComponentDto>;

/** The kit sheet: a kit with its components by item name. */
export const KitDetailDto = KitDto.extend({ components: z.array(KitComponentDto) }).strict();
export type KitDetailDto = z.infer<typeof KitDetailDto>;

const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() }).strict();

export const ItemPageDto = page(ItemDto);
export type ItemPageDto = z.infer<typeof ItemPageDto>;

export const KitPageDto = page(KitDto);
export type KitPageDto = z.infer<typeof KitPageDto>;

/** Catalogue › Items: a page of the catalogue, by name unless another order is asked for. */
export const ListItemsInput = z
  .object({
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: ItemSortSchema.optional(),
    category: ItemCategorySchema.optional(),
    /** Part of the name or the code. */
    q: z.string().trim().min(1).max(80).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict();
export type ListItemsInput = z.input<typeof ListItemsInput>;

/** Catalogue › Kits: a page of kits, by name unless another order is asked for. */
export const ListKitsInput = z
  .object({
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: KitSortSchema.optional(),
    q: z.string().trim().min(1).max(80).optional(),
    includeArchived: z.boolean().default(false),
  })
  .strict();
export type ListKitsInput = z.input<typeof ListKitsInput>;

export const GetItemInput = z.object({ itemId: IdSchema }).strict();
export type GetItemInput = z.infer<typeof GetItemInput>;

export const GetKitInput = z.object({ kitId: IdSchema }).strict();
export type GetKitInput = z.infer<typeof GetKitInput>;

/** One active kit and its price on one list. Selling prices only. */
export const KitPriceRowDto = z
  .object({
    kitId: IdSchema,
    sku: z.string(),
    name: z.string(),
    price: MoneySchema.nullable(),
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type KitPriceRowDto = z.infer<typeof KitPriceRowDto>;

export const KitPricePageDto = page(KitPriceRowDto);
export type KitPricePageDto = z.infer<typeof KitPricePageDto>;

/** Price Master › Kits: one list's kits, by kit name unless another order is asked for. */
export const ListKitPricesInput = z
  .object({
    priceListId: IdSchema,
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    sort: KitPriceSortSchema.optional(),
  })
  .strict();
export type ListKitPricesInput = z.input<typeof ListKitPricesInput>;

/** One change of an item's or kit's price on one list, as the change log shows it. */
export const PriceChangeDto = z
  .object({
    id: IdSchema,
    priceListId: IdSchema,
    tierName: z.string(),
    /** Null for a list shared by every company. */
    entityId: EntityIdSchema.nullable(),
    version: z.number().int(),
    oldPrice: MoneySchema.nullable(),
    newPrice: MoneySchema,
    reason: z.string().nullable(),
    /** The person's name, or null when the reader cannot see who it was. */
    changedByName: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type PriceChangeDto = z.infer<typeof PriceChangeDto>;

export const PriceChangePageDto = page(PriceChangeDto);
export type PriceChangePageDto = z.infer<typeof PriceChangePageDto>;

/** The price changes of one item or one kit on every list the caller reads, newest first. */
export const ListPriceChangesInput = z
  .object({
    itemId: IdSchema.optional(),
    kitId: IdSchema.optional(),
    cursor: z.string().max(2048).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine((v) => (v.itemId === undefined) !== (v.kitId === undefined), {
    message: 'exactly one of itemId or kitId',
    path: ['itemId'],
  });
export type ListPriceChangesInput = z.input<typeof ListPriceChangesInput>;

/** One GST rate as Settings › Tax lists it: the HSN code or the item, with its source. */
export const TaxRateListRowDto = TaxRateRowSchema.extend({
  sourceRef: z.string().nullable(),
  itemSku: z.string().nullable(),
  itemName: z.string().nullable(),
}).strict();
export type TaxRateListRowDto = z.infer<typeof TaxRateListRowDto>;

/** Settings › Tax: every GST rate and every composite-supply rule, newest period first. */
export const TaxSettingsDto = z
  .object({
    rates: z.array(TaxRateListRowDto),
    compositeRules: z.array(CompositeRuleRowSchema),
    /** Whether the request acts for every active company, as a change to either table needs. */
    coversAllCompanies: z.boolean(),
  })
  .strict();
export type TaxSettingsDto = z.infer<typeof TaxSettingsDto>;
