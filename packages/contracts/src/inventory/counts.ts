import { z } from 'zod';
import { ItemUnitSchema, SignedMoneySchema } from '../catalogue/enums';
import { EntityIdSchema, IdSchema } from '../ids';
import { StockReasonSchema } from './enums';
import { StockQtySchema } from './stock';

/**
 * Stock counts (H3, docs/03-roadmap-appendix/phase3.md §7.3). A counter (`inventory.stock.move`)
 * sees bins and items and what they entered, never the quantity the ledger expects: no DTO a
 * counter reads has a field for it, or for a difference. The Inventory Manager's review
 * (`inventory.stock.adjust`) carries the expected quantities and variances, and their values only
 * with `finance.cost.read`.
 */

/** The states of a count (the `stock-count` machine); equal to `stock_counts_state_check`. */
export const STOCK_COUNT_STATES = ['open', 'counting', 'review', 'posted', 'cancelled'] as const;
export const StockCountStateSchema = z.enum(STOCK_COUNT_STATES);
export type StockCountState = z.infer<typeof StockCountStateSchema>;

/** The states in which a count is live: one per company and hub. */
export const LIVE_STOCK_COUNT_STATES = [
  'open',
  'counting',
  'review',
] as const satisfies readonly StockCountState[];

/** What a count covers; equal to `stock_counts_scope_check`. */
export const STOCK_COUNT_SCOPES = ['hub', 'bins', 'items'] as const;
export const StockCountScopeSchema = z.enum(STOCK_COUNT_SCOPES);
export type StockCountScope = z.infer<typeof StockCountScopeSchema>;

/** Where an item in a bin stands for its counter. */
export const STOCK_COUNT_LINE_STATES = ['to_count', 'counted', 'recount'] as const;
export const StockCountLineStateSchema = z.enum(STOCK_COUNT_LINE_STATES);
export type StockCountLineState = z.infer<typeof StockCountLineStateSchema>;

/** The refusals of the count's definers, each a catalogue reason. */
export const STOCK_COUNT_REFUSALS = [
  'stock_count_started',
  'stock_count_not_counting',
  'stock_count_bin_outside',
  'stock_count_item_outside',
  'stock_count_serial_unknown',
  'stock_count_serial_counted_elsewhere',
  'stock_count_uncounted',
  'stock_count_closed',
  'stock_count_transition',
] as const;
export type StockCountRefusal = (typeof STOCK_COUNT_REFUSALS)[number];

/**
 * Why a serial's line cannot post as it stands, each a catalogue reason: it moved since its
 * count, it is recorded as out of our stock or on its way, it is reserved or picked for an order,
 * or it is a faulty unit in quarantine. The review names it on the line; the post refuses it.
 */
export const STOCK_COUNT_POST_REFUSALS = [
  'stock_count_serial_moved',
  'stock_count_serial_elsewhere',
  'stock_count_serial_reserved',
  'stock_count_serial_faulty',
] as const;
export const StockCountPostRefusalSchema = z.enum(STOCK_COUNT_POST_REFUSALS);
export type StockCountPostRefusal = z.infer<typeof StockCountPostRefusalSchema>;

/** Up to 200 ids, each once. */
const IdList = z
  .array(IdSchema)
  .min(1)
  .max(200)
  .refine((list) => new Set(list).size === list.length, { message: 'each once' });

/** Start a count of one company's stock in one hub (`inventory.stock.adjust`). */
export const StartStockCountInput = z
  .object({
    entityId: EntityIdSchema,
    hubId: IdSchema,
    scope: StockCountScopeSchema,
    binIds: IdList.optional(),
    itemIds: IdList.optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.scope === 'bins') === (v.binIds !== undefined) &&
      (v.scope === 'items') === (v.itemIds !== undefined),
    { message: 'the bins or items the scope names', path: ['scope'] },
  );
export type StartStockCountInput = z.input<typeof StartStockCountInput>;

/** A counted quantity: zero or more, up to three decimals, in the item's stock unit. */
export const CountedQtySchema = z.string().regex(/^\d{1,9}(\.\d{1,3})?$/);

/** A serial number as scanned or typed: trimmed, 1 to 100 characters. */
const CountedSerialNo = z.string().trim().min(1).max(100);

/** The serials found of a tracked item in a bin, each once (in any case); none is a count too. */
const CountedSerialNos = z
  .array(CountedSerialNo)
  .max(1000)
  .refine((list) => new Set(list.map((s) => s.toLowerCase())).size === list.length, {
    message: 'each serial once',
  });

/**
 * A counter's count of one item in one bin (`inventory.stock.move`): a quantity, or every serial
 * found. While the item in the bin is asked for again, this is the recount.
 */
export const RecordStockCountInput = z
  .object({
    countId: IdSchema,
    binId: IdSchema,
    itemId: IdSchema,
    qty: CountedQtySchema.optional(),
    serialNos: CountedSerialNos.optional(),
  })
  .strict()
  .refine((v) => (v.qty === undefined) !== (v.serialNos === undefined), {
    message: 'a quantity or serials',
    path: ['qty'],
  });
export type RecordStockCountInput = z.input<typeof RecordStockCountInput>;

/** Ask for an item in a bin again (`inventory.stock.adjust`). */
export const RecountStockCountInput = z
  .object({ countId: IdSchema, binId: IdSchema, itemId: IdSchema })
  .strict();
export type RecountStockCountInput = z.input<typeof RecountStockCountInput>;

/** Send a count for review once every item in every bin is counted (`inventory.stock.move`). */
export const SubmitStockCountInput = z.object({ countId: IdSchema }).strict();
export type SubmitStockCountInput = z.input<typeof SubmitStockCountInput>;

const CountNote = z.string().trim().min(3).max(300);

/**
 * Post a reviewed count (`inventory.stock.adjust`): each variance becomes a `count` movement with
 * the note; a serial not found may carry its own reason.
 */
export const PostStockCountInput = z
  .object({
    countId: IdSchema,
    note: CountNote,
    serialNotes: z
      .array(z.object({ lineId: IdSchema, note: CountNote }).strict())
      .max(1000)
      .default([]),
  })
  .strict();
export type PostStockCountInput = z.input<typeof PostStockCountInput>;

/** Cancel a count before it posts (`inventory.stock.adjust`). */
export const CancelStockCountInput = z
  .object({ countId: IdSchema, cancelReason: CountNote })
  .strict();
export type CancelStockCountInput = z.input<typeof CancelStockCountInput>;

/** A count's header, as every reader of counts sees it. */
export const StockCountDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    hubId: IdSchema,
    scope: StockCountScopeSchema,
    binIds: z.array(IdSchema).nullable(),
    itemIds: z.array(IdSchema).nullable(),
    state: StockCountStateSchema,
    startedAt: z.string(),
    startedBy: IdSchema,
    submittedAt: z.string().nullable(),
    postedAt: z.string().nullable(),
    postNote: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    cancelReason: z.string().nullable(),
  })
  .strict();
export type StockCountDto = z.infer<typeof StockCountDto>;

/** A posted count: its header and the movements its variances became. */
export const StockCountPostedDto = z
  .object({ count: StockCountDto, movementIds: z.array(IdSchema) })
  .strict();
export type StockCountPostedDto = z.infer<typeof StockCountPostedDto>;

/** How far a count has come, per item in a bin (never per serial). */
export const StockCountProgressDto = z
  .object({
    itemsInBins: z.number().int().min(0),
    toCount: z.number().int().min(0),
    recountOpen: z.number().int().min(0),
  })
  .strict();
export type StockCountProgressDto = z.infer<typeof StockCountProgressDto>;

/** `/inventory/counts`: a company's counts by state, newest first. */
export const ListStockCountsInput = z
  .object({
    entityId: EntityIdSchema,
    state: StockCountStateSchema.optional(),
    cursor: z.string().max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListStockCountsInput = z.input<typeof ListStockCountsInput>;

export const StockCountRowDto = StockCountDto.extend({
  hubCode: z.string(),
  hubName: z.string(),
  startedByName: z.string(),
}).strict();
export type StockCountRowDto = z.infer<typeof StockCountRowDto>;

export const StockCountPageDto = z
  .object({ items: z.array(StockCountRowDto), nextCursor: z.string().nullable() })
  .strict();
export type StockCountPageDto = z.infer<typeof StockCountPageDto>;

export const GetStockCountInput = z.object({ countId: IdSchema }).strict();
export type GetStockCountInput = z.input<typeof GetStockCountInput>;

/**
 * One item in one bin as a counter sees it: what to count and what they entered. A recount shows
 * nothing of the earlier count; nothing here is what the ledger expects.
 */
export const StockCountSheetRowDto = z
  .object({
    binId: IdSchema,
    binCode: z.string(),
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    unit: ItemUnitSchema,
    isSerialTracked: z.boolean(),
    serialPattern: z.string().nullable(),
    state: StockCountLineStateSchema,
    countedQty: StockQtySchema.nullable(),
    serialNos: z.array(z.string()).nullable(),
  })
  .strict();
export type StockCountSheetRowDto = z.infer<typeof StockCountSheetRowDto>;

/** A bin a counter may count in: its code, never what it holds. */
export const StockCountBinDto = z.object({ id: IdSchema, code: z.string() }).strict();
export type StockCountBinDto = z.infer<typeof StockCountBinDto>;

/** The counting screen and the count's sheet for a counter (`inventory.stock.move`). */
export const StockCountSheetDto = z
  .object({
    count: StockCountRowDto,
    rows: z.array(StockCountSheetRowDto),
    /** The bins of the count (its chosen bins, or its hub's), for stock found where none was listed. */
    bins: z.array(StockCountBinDto),
    progress: StockCountProgressDto,
  })
  .strict();
export type StockCountSheetDto = z.infer<typeof StockCountSheetDto>;

/** A quantity that may be below zero: a variance, or what moved during the count. */
export const SignedStockQtySchema = z.string().regex(/^-?\d{1,9}\.\d{3}$/);

/** One line of the review (`inventory.stock.adjust`). */
export const StockCountReviewLineDto = z
  .object({
    lineId: IdSchema,
    binId: IdSchema,
    binCode: z.string(),
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    unit: ItemUnitSchema,
    serialId: IdSchema.nullable(),
    serialNo: z.string().nullable(),
    /** What the ledger held when the count started. */
    expectedAtStart: StockQtySchema,
    /** What moved into the bin less what moved out, from the start until the line was counted. */
    movedDuringCount: SignedStockQtySchema,
    /** What the ledger held when the line was counted: the start's, with the movements folded in. */
    expectedAtCount: SignedStockQtySchema,
    firstCount: StockQtySchema.nullable(),
    recount: StockQtySchema.nullable(),
    /** The count that stands: the recount once taken, else the first; null while uncounted. */
    counted: StockQtySchema.nullable(),
    recountOpen: z.boolean(),
    /** Counted less expected; null while uncounted or asked for again. */
    variance: SignedStockQtySchema.nullable(),
    /**
     * The variance's value, only with `finance.cost.read`: at the cost each movement posted with
     * once the count is posted, else at the moving average now; null where no cost is known.
     */
    value: SignedMoneySchema.nullable(),
    /** Why the line cannot post as it stands; null when it can. */
    postRefusal: StockCountPostRefusalSchema.nullable(),
  })
  .strict();
export type StockCountReviewLineDto = z.infer<typeof StockCountReviewLineDto>;

/** A movement into or out of a counted bin after the count started, other than the count's own. */
export const StockCountMovementDto = z
  .object({
    id: IdSchema,
    movedAt: z.string(),
    reason: StockReasonSchema,
    itemId: IdSchema,
    sku: z.string(),
    serialNo: z.string().nullable(),
    fromBinCode: z.string().nullable(),
    toBinCode: z.string().nullable(),
    qty: StockQtySchema,
  })
  .strict();
export type StockCountMovementDto = z.infer<typeof StockCountMovementDto>;

/** The review and the printed sheet (`inventory.stock.adjust`). */
export const StockCountReviewDto = z
  .object({
    count: StockCountRowDto,
    lines: z.array(StockCountReviewLineDto),
    movements: z.array(StockCountMovementDto),
    /** More movements happened than the review lists. */
    moreMovements: z.boolean(),
    progress: StockCountProgressDto,
    /** Whether the caller reads values (`finance.cost.read`); each line's value is null if not. */
    showsValues: z.boolean(),
    /** The net value of every variance valued; null without `finance.cost.read`. */
    netValue: SignedMoneySchema.nullable(),
  })
  .strict();
export type StockCountReviewDto = z.infer<typeof StockCountReviewDto>;
