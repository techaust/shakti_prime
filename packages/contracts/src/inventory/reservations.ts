import { z } from 'zod';
import { EntityIdSchema, IdSchema } from '../ids';
import { StockQtySchema } from './stock';

/**
 * Reservations and availability (H2, docs/03-roadmap-appendix/phase3.md §7.1, questions 3 (a) and
 * 4 (a)). Each value list equals the database check of the same name (`enum-sync.test.ts`).
 */

/** The states of a reservation (the `reservation` machine). */
export const RESERVATION_STATES = ['active', 'picked', 'released', 'lapsed'] as const;
export const ReservationStateSchema = z.enum(RESERVATION_STATES);
export type ReservationState = z.infer<typeof ReservationStateSchema>;

/** How a released reservation ended: by a person, with its order's cancellation, or moved. */
export const RESERVATION_RELEASE_KINDS = ['by_hand', 'order_cancelled', 'moved'] as const;
export const ReservationReleaseKindSchema = z.enum(RESERVATION_RELEASE_KINDS);
export type ReservationReleaseKind = z.infer<typeof ReservationReleaseKindSchema>;

/** A line's availability: in stock, partly in stock, or on order. */
export const AVAILABILITY_STATUSES = ['covered', 'partly_covered', 'short'] as const;
export const AvailabilityStatusSchema = z.enum(AVAILABILITY_STATUSES);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

/** The refusals of the reservation definers, each a catalogue reason. */
export const RESERVATION_REFUSALS = [
  'reservation_expiry_invalid',
  'reservation_need_missing',
  'reservation_stock_short',
  'reservation_order_not_open',
  'reservation_order_reserved',
  'reservation_order_not_cancelled',
  'reservation_missing',
  'reservation_not_active',
  'reservation_already_extended',
  'reservation_move_same_hub',
  'reservation_hub_missing',
] as const;
export type ReservationRefusal = (typeof RESERVATION_REFUSALS)[number];

const Reason = z.string().trim().min(3).max(300);

/**
 * Whose grant extends a reservation: the Inventory Manager's `inventory.stock.adjust`, or the
 * General Manager's `sales.order.cancel` (docs/03-roadmap-appendix/phase3.md §7.1).
 */
export const EXTEND_AUTHORITIES = ['stock', 'order'] as const;
export const ExtendAuthoritySchema = z.enum(EXTEND_AUTHORITIES);
export type ExtendAuthority = z.infer<typeof ExtendAuthoritySchema>;

/** Hold a reservation longer, once, by the hold period, with why. */
export const ExtendReservationInput = z
  .object({
    entityId: EntityIdSchema,
    reservationId: IdSchema,
    authority: ExtendAuthoritySchema,
    reason: Reason,
  })
  .strict();
export type ExtendReservationInput = z.input<typeof ExtendReservationInput>;

/** Free a reservation's stock by hand, with why; the quantity is back on order. */
export const ReleaseReservationInput = z
  .object({ entityId: EntityIdSchema, reservationId: IdSchema, reason: Reason })
  .strict();
export type ReleaseReservationInput = z.input<typeof ReleaseReservationInput>;

/** Reserve the same quantity from another hub's free stock instead. */
export const MoveReservationInput = z
  .object({ entityId: EntityIdSchema, reservationId: IdSchema, hubId: IdSchema })
  .strict();
export type MoveReservationInput = z.input<typeof MoveReservationInput>;

/** What a person's change of a reservation answers: the reservations it ended and made. */
export const ReservationChangedDto = z
  .object({
    reservationIds: z.array(IdSchema),
    /** When the reservation now lapses, for an extension. */
    expiresAt: z.date().nullable(),
  })
  .strict();
export type ReservationChangedDto = z.infer<typeof ReservationChangedDto>;

/**
 * The backorder fill for one item of a company, run by the platform as stock arrives: one item a
 * transaction, so each fill takes its orders' locks before the item's balances and never holds one
 * item's balances while it waits for another item's orders.
 */
export const FillBackordersInput = z.object({ entityId: EntityIdSchema, itemId: IdSchema }).strict();
export type FillBackordersInput = z.input<typeof FillBackordersInput>;

/** How many backorders a fill served: counts of rows, never a quantity of stock. */
export const FillBackordersDto = z
  .object({ entityId: EntityIdSchema, filled: z.number().int().min(0) })
  .strict();
export type FillBackordersDto = z.infer<typeof FillBackordersDto>;

/** The daily scan of one company's reservations. */
export const ReservationScanInput = z.object({ entityId: EntityIdSchema }).strict();
export type ReservationScanInput = z.input<typeof ReservationScanInput>;

export const ReservationScanDto = z
  .object({
    entityId: EntityIdSchema,
    lapsed: z.number().int().min(0),
    reminded: z.number().int().min(0),
    /** The items open orders of the company wait for, for the catch-up fill (at most 500). */
    backorderedItemIds: z.array(IdSchema).max(500),
    /** More were due than one run takes; the next run carries on. */
    more: z.boolean(),
  })
  .strict();
export type ReservationScanDto = z.infer<typeof ReservationScanDto>;

/** Availability of a quote's or an order's lines (`app.line_availability()`). */
export const DOCUMENT_KINDS = ['quote', 'order'] as const;
export const DocumentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = z.infer<typeof DocumentKindSchema>;

export const ReadLineAvailabilityInput = z
  .object({ entityId: EntityIdSchema, kind: DocumentKindSchema, id: IdSchema })
  .strict();
export type ReadLineAvailabilityInput = z.input<typeof ReadLineAvailabilityInput>;

/** A line's status and expected date, for a caller without `inventory.stock.read`: no count. */
export const LineStatusDto = z
  .object({
    /** The line's id; null for a line of the quote builder not yet saved. */
    lineId: IdSchema.nullable(),
    position: z.number().int().min(1),
    status: AvailabilityStatusSchema,
    /** When open purchase orders would cover the line (IST date), if known. */
    expectedOn: z.iso.date().nullable(),
  })
  .strict();
export type LineStatusDto = z.infer<typeof LineStatusDto>;

/** A line's status with its quantities, for a holder of `inventory.stock.read`. */
export const LineStockDto = LineStatusDto.extend({
  /** Free stock that would serve the line (kits for a kit line), on a quote or a draft order. */
  free: StockQtySchema.nullable(),
  /** Reserved and backordered, in the line's unit, on a confirmed order. */
  reserved: StockQtySchema.nullable(),
  backordered: StockQtySchema.nullable(),
  /** Dispatched, in the line's unit, on a confirmed order (none until dispatches exist, D2). */
  dispatched: StockQtySchema.nullable(),
}).strict();
export type LineStockDto = z.infer<typeof LineStockDto>;

/** The two shapes: the one without counts is built without reading them (question 4 (a)). */
export const LineAvailabilityDto = z.discriminatedUnion('withCounts', [
  z.object({ withCounts: z.literal(false), lines: z.array(LineStatusDto) }).strict(),
  z.object({ withCounts: z.literal(true), lines: z.array(LineStockDto) }).strict(),
]);
export type LineAvailabilityDto = z.infer<typeof LineAvailabilityDto>;

/** The quote builder's lines before the quote is made (`app.preview_availability()`). */
export const PreviewLineAvailabilityInput = z
  .object({
    entityId: EntityIdSchema,
    lines: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(200),
            itemId: IdSchema.optional(),
            kitId: IdSchema.optional(),
            qty: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
          })
          .strict()
          .refine((l) => (l.itemId === undefined) !== (l.kitId === undefined), {
            message: 'an item or a kit',
          }),
      )
      .min(1)
      .max(200),
  })
  .strict();
export type PreviewLineAvailabilityInput = z.input<typeof PreviewLineAvailabilityInput>;

/**
 * The active reservations of an order, or of an item in a company (`inventory.stock.read` for the
 * company): one of the two is named.
 */
export const ListReservationsInput = z
  .object({
    entityId: EntityIdSchema,
    orderId: IdSchema.optional(),
    itemId: IdSchema.optional(),
  })
  .strict()
  .refine((v) => (v.orderId === undefined) !== (v.itemId === undefined), {
    message: 'an order or an item',
    path: ['orderId'],
  });
export type ListReservationsInput = z.input<typeof ListReservationsInput>;

/** One active reservation, as the order page and the stock card list them. */
export const ReservationRowDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    orderId: IdSchema,
    /** The order's number when the reader may read the order; null otherwise. */
    soNo: z.string().nullable(),
    /** The order line's number when the reader may read the order; null otherwise. */
    linePosition: z.number().int().min(1).nullable(),
    itemId: IdSchema,
    sku: z.string(),
    itemName: z.string(),
    hubId: IdSchema,
    hubCode: z.string(),
    hubName: z.string(),
    binCode: z.string(),
    qty: StockQtySchema,
    expiresAt: z.iso.datetime(),
    extended: z.boolean(),
  })
  .strict();
export type ReservationRowDto = z.infer<typeof ReservationRowDto>;

export const ReservationListDto = z
  .object({
    items: z.array(ReservationRowDto),
    /** More than the list shows. */
    more: z.boolean(),
  })
  .strict();
export type ReservationListDto = z.infer<typeof ReservationListDto>;

/** The orders an item's free stock goes to next, in their queue order (the stock card). */
export const ListItemBackordersInput = z
  .object({ entityId: EntityIdSchema, itemId: IdSchema })
  .strict();
export type ListItemBackordersInput = z.input<typeof ListItemBackordersInput>;

export const BackorderRowDto = z
  .object({
    orderId: IdSchema,
    /** The order's number when the reader may read the order; null otherwise. */
    soNo: z.string().nullable(),
    linePosition: z.number().int().min(1).nullable(),
    needed: StockQtySchema,
    backordered: StockQtySchema,
    queuedAt: z.iso.datetime(),
  })
  .strict();
export type BackorderRowDto = z.infer<typeof BackorderRowDto>;

export const BackorderListDto = z
  .object({ items: z.array(BackorderRowDto), more: z.boolean() })
  .strict();
export type BackorderListDto = z.infer<typeof BackorderListDto>;
