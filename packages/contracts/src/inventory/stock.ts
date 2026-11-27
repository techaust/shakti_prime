import { z } from 'zod';
import { ItemCategorySchema, ItemUnitSchema, MoneySchema, RateSchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { QuantitySchema } from '../tax/engine';
import {
  BinKindSchema,
  EditableBinKindSchema,
  SerialStateSchema,
  StockReasonSchema,
  WarehouseKindSchema,
} from './enums';

/**
 * Hubs, bins and the stock ledger's commands and reads (H1, docs/03-roadmap-appendix/phase3.md
 * §5, §6.2). No DTO here carries a cost except the valuation's, read only with `finance.cost.read`.
 */

/** A hub's or bin's code: capitals, digits and `-`, as the labels print them. */
const Code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{0,${String(max - 1)}}$`));
export const HubCodeSchema = Code(20);
export const BinCodeSchema = Code(41);

const HubName = z.string().trim().min(2).max(80);
const Address = z.string().trim().min(1).max(300);
const StateCode = z.string().regex(/^[0-9]{2}$/);
const PinCode = z.string().regex(/^[1-9][0-9]{5}$/);

/** A serial number as scanned or typed: trimmed, 1 to 100 characters. */
export const SerialNoSchema = z.string().trim().min(1).max(100);

/** Up to 100 serials in one movement form, each once (in any case). */
const SerialNos = z
  .array(SerialNoSchema)
  .min(1)
  .max(100)
  .refine((list) => new Set(list.map((s) => s.toLowerCase())).size === list.length, {
    message: 'each serial once',
  });

const siteFields = {
  address: Address.nullable().default(null),
  stateCode: StateCode.nullable().default(null),
  pinCode: PinCode.nullable().default(null),
};

/**
 * The PIN codes a hub serves first (H2): an order whose site's PIN code is listed reserves from
 * this hub before the others. Each once, at most 2,000.
 */
export const HubPinCodesSchema = z
  .array(PinCode)
  .max(2000)
  .refine((list) => new Set(list).size === list.length, { message: 'each PIN code once' });

export const CreateHubInput = z
  .object({
    code: HubCodeSchema,
    name: HubName,
    kind: WarehouseKindSchema,
    ...siteFields,
    // H2: the PIN codes the hub serves first.
    pinCodes: HubPinCodesSchema.default([]),
  })
  .strict()
  .refine((v) => v.kind === 'transit' || (v.stateCode !== null && v.pinCode !== null), {
    message: 'a godown or factory has its state and PIN code',
    path: ['pinCode'],
  });
export type CreateHubInput = z.input<typeof CreateHubInput>;

export const UpdateHubInput = z
  .object({
    hubId: IdSchema,
    code: HubCodeSchema,
    name: HubName,
    ...siteFields,
    // H2: left out, the hub keeps the PIN codes it has.
    pinCodes: HubPinCodesSchema.optional(),
  })
  .strict();
export type UpdateHubInput = z.input<typeof UpdateHubInput>;

export const ArchiveHubInput = z.object({ hubId: IdSchema }).strict();
export type ArchiveHubInput = z.input<typeof ArchiveHubInput>;

export const CreateBinInput = z
  .object({ hubId: IdSchema, code: BinCodeSchema, kind: EditableBinKindSchema })
  .strict();
export type CreateBinInput = z.input<typeof CreateBinInput>;

export const UpdateBinInput = z
  .object({ binId: IdSchema, code: BinCodeSchema, kind: EditableBinKindSchema.optional() })
  .strict();
export type UpdateBinInput = z.input<typeof UpdateBinInput>;

export const ArchiveBinInput = z.object({ binId: IdSchema }).strict();
export type ArchiveBinInput = z.input<typeof ArchiveBinInput>;

/** What moves: a quantity of an untracked item, or the serials of a tracked one. */
const what = {
  qty: QuantitySchema.optional(),
  serialNos: SerialNos.optional(),
};
const oneOfWhat = (v: { qty?: string | undefined; serialNos?: string[] | undefined }) =>
  (v.qty === undefined) !== (v.serialNos === undefined);

/** Move between bins of one hub (`inventory.stock.move`). */
export const TransferStockInput = z
  .object({
    entityId: EntityIdSchema,
    itemId: IdSchema,
    fromBinId: IdSchema,
    toBinId: IdSchema,
    ...what,
  })
  .strict()
  .refine(oneOfWhat, { message: 'a quantity or serials', path: ['qty'] })
  .refine((v) => v.fromBinId !== v.toBinId, { message: 'two bins', path: ['toBinId'] });
export type TransferStockInput = z.input<typeof TransferStockInput>;

export const STOCK_ADJUSTMENTS = ['gain', 'loss', 'damage'] as const;
export const StockAdjustmentSchema = z.enum(STOCK_ADJUSTMENTS);
export type StockAdjustment = z.infer<typeof StockAdjustmentSchema>;

/** A gain, loss or damage in one bin, with why (`inventory.stock.adjust`). */
export const AdjustStockInput = z
  .object({
    entityId: EntityIdSchema,
    itemId: IdSchema,
    binId: IdSchema,
    adjustment: StockAdjustmentSchema,
    note: z.string().trim().min(3).max(300),
    ...what,
  })
  .strict()
  .refine(oneOfWhat, { message: 'a quantity or serials', path: ['qty'] });
export type AdjustStockInput = z.input<typeof AdjustStockInput>;

/** Undo a movement made in error, within the reversal window (`inventory.stock.adjust`). */
export const ReverseStockInput = z
  .object({
    entityId: EntityIdSchema,
    movementId: IdSchema,
    note: z.string().trim().min(3).max(300).optional(),
  })
  .strict();
export type ReverseStockInput = z.input<typeof ReverseStockInput>;

export const BinDto = z
  .object({
    id: IdSchema,
    hubId: IdSchema,
    code: z.string(),
    kind: BinKindSchema,
    pairHubIds: z.tuple([IdSchema, IdSchema]).nullable(),
    archivedAt: z.string().nullable(),
  })
  .strict();
export type BinDto = z.infer<typeof BinDto>;

export const HubDto = z
  .object({
    id: IdSchema,
    code: z.string(),
    name: z.string(),
    kind: WarehouseKindSchema,
    address: z.string().nullable(),
    stateCode: z.string().nullable(),
    pinCode: z.string().nullable(),
    /** H2: the PIN codes the hub serves first. */
    pinCodes: z.array(z.string()),
    archivedAt: z.string().nullable(),
    bins: z.array(BinDto),
  })
  .strict();
export type HubDto = z.infer<typeof HubDto>;

export const HubListDto = z.object({ hubs: z.array(HubDto) }).strict();
export type HubListDto = z.infer<typeof HubListDto>;

export const ListHubsInput = z.object({ includeArchived: z.boolean().default(false) }).strict();
export type ListHubsInput = z.input<typeof ListHubsInput>;

/** What a stock command answers: the movements it posted, in order, never a cost. */
export const StockMovedDto = z.object({ movementIds: z.array(IdSchema).min(1) }).strict();
export type StockMovedDto = z.infer<typeof StockMovedDto>;

/** A quantity as the ledger keeps it: up to nine digits and three decimals, never negative. */
export const StockQtySchema = z.string().regex(/^\d{1,9}\.\d{3}$/);

export const StockBalanceRowDto = z
  .object({
    hubId: IdSchema,
    hubCode: z.string(),
    hubName: z.string(),
    binId: IdSchema,
    binCode: z.string(),
    binKind: BinKindSchema,
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    unit: ItemUnitSchema,
    category: ItemCategorySchema,
    isSerialTracked: z.boolean(),
    onHand: StockQtySchema,
    reserved: StockQtySchema,
    /** On hand less reserved, in a storage bin; null in any other bin, which holds no free stock. */
    free: StockQtySchema.nullable(),
  })
  .strict();
export type StockBalanceRowDto = z.infer<typeof StockBalanceRowDto>;

export const StockBalancePageDto = z
  .object({ items: z.array(StockBalanceRowDto), nextCursor: z.string().nullable() })
  .strict();
export type StockBalancePageDto = z.infer<typeof StockBalancePageDto>;

/** `/inventory/stock`: one company's balances above zero, by hub, bin and item. */
export const ListStockBalancesInput = z
  .object({
    entityId: EntityIdSchema,
    hubId: IdSchema.optional(),
    binId: IdSchema.optional(),
    itemId: IdSchema.optional(),
    category: ItemCategorySchema.optional(),
    /** The start of a stock code, or words of the item's name. */
    search: z.string().trim().min(1).max(80).optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListStockBalancesInput = z.input<typeof ListStockBalancesInput>;

const BinRef = z.object({ id: IdSchema, code: z.string(), hubCode: z.string() }).strict();

export const StockMovementRowDto = z
  .object({
    id: IdSchema,
    movedAt: z.string(),
    reason: StockReasonSchema,
    qty: StockQtySchema,
    from: BinRef.nullable(),
    to: BinRef.nullable(),
    serialId: IdSchema.nullable(),
    serialNo: z.string().nullable(),
    movedBy: z.string(),
    /** Why a person moved it: an adjustment's or a reversal's reason. */
    note: z.string().nullable(),
    reversesId: IdSchema.nullable(),
    /** The reversal that undid it, if any. */
    reversedById: IdSchema.nullable(),
    /** Whether the caller may reverse it now: a reason a person reverses, in the window, undone. */
    reversible: z.boolean(),
  })
  .strict();
export type StockMovementRowDto = z.infer<typeof StockMovementRowDto>;

export const StockItemDto = z
  .object({
    id: IdSchema,
    sku: z.string(),
    name: z.string(),
    unit: ItemUnitSchema,
    category: ItemCategorySchema,
    isSerialTracked: z.boolean(),
    isActive: z.boolean(),
  })
  .strict();
export type StockItemDto = z.infer<typeof StockItemDto>;

export const StockCardDto = z
  .object({
    entityId: EntityIdSchema,
    item: StockItemDto,
    /** What the company holds of the item in each hub. */
    byHub: z.array(
      z
        .object({
          hubId: IdSchema,
          hubCode: z.string(),
          hubName: z.string(),
          onHand: StockQtySchema,
          reserved: StockQtySchema,
        })
        .strict(),
    ),
    movements: z.array(StockMovementRowDto),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type StockCardDto = z.infer<typeof StockCardDto>;

/** An item's stock card: its movements in one company, newest first, optionally in one hub. */
export const GetStockCardInput = z
  .object({
    entityId: EntityIdSchema,
    itemId: IdSchema,
    hubId: IdSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type GetStockCardInput = z.input<typeof GetStockCardInput>;

export const SerialDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    item: StockItemDto,
    serialNo: z.string(),
    state: SerialStateSchema,
    bin: BinRef.nullable(),
    deliveredAt: z.string().nullable(),
    warrantyUntil: z.string().nullable(),
    supplierWarrantyUntil: z.string().nullable(),
    movements: z.array(StockMovementRowDto),
  })
  .strict();
export type SerialDto = z.infer<typeof SerialDto>;

export const GetSerialInput = z.object({ entityId: EntityIdSchema, serialId: IdSchema }).strict();
export type GetSerialInput = z.input<typeof GetSerialInput>;

/** `/inventory/valuation` (`finance.cost.read`): quantity, average cost and value at a date. */
export const ReadStockValuationInput = z
  .object({
    entityId: EntityIdSchema,
    /** The calendar date in India the stock is valued at, at its close. */
    asOf: z.iso.date(),
  })
  .strict();
export type ReadStockValuationInput = z.input<typeof ReadStockValuationInput>;

export const StockValuationRowDto = z
  .object({
    hubId: IdSchema,
    hubCode: z.string(),
    hubName: z.string(),
    category: ItemCategorySchema,
    qty: StockQtySchema,
    avgCost: RateSchema,
    value: MoneySchema,
  })
  .strict();
export type StockValuationRowDto = z.infer<typeof StockValuationRowDto>;

export const StockValuationDto = z
  .object({
    entityId: EntityIdSchema,
    asOf: z.string(),
    rows: z.array(StockValuationRowDto),
    total: MoneySchema,
  })
  .strict();
export type StockValuationDto = z.infer<typeof StockValuationDto>;
