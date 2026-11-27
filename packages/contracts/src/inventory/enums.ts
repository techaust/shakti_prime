import { z } from 'zod';

/**
 * The stock model's value lists (docs/03-roadmap-appendix/phase3.md §5). Each equals the database
 * check of the same name (`enum-sync.test.ts`).
 */

/** A hub's kind: a godown or factory holds stock at a site; the transit hub holds it between two. */
export const WAREHOUSE_KINDS = ['godown', 'factory', 'transit'] as const;
export const WarehouseKindSchema = z.enum(WAREHOUSE_KINDS);
export type WarehouseKind = z.infer<typeof WarehouseKindSchema>;

/**
 * A bin's kind. Free stock is what `storage` bins hold; `quarantine` holds faulty and returned
 * goods awaiting a decision; a `transit` bin belongs to the transit hub and pairs two hubs.
 */
export const BIN_KINDS = [
  'storage',
  'receiving',
  'dispatch',
  'quarantine',
  'surplus',
  'transit',
] as const;
export const BinKindSchema = z.enum(BIN_KINDS);
export type BinKind = z.infer<typeof BinKindSchema>;

/** The kinds a person gives a bin of a godown or factory; the others come with the hub. */
export const EDITABLE_BIN_KINDS = ['storage', 'quarantine', 'surplus'] as const;
export const EditableBinKindSchema = z.enum(EDITABLE_BIN_KINDS);
export type EditableBinKind = z.infer<typeof EditableBinKindSchema>;

/** The states of a serial (the `serial` machine). */
export const SERIAL_STATES = [
  'in_stock',
  'reserved',
  'picked',
  'in_transit',
  'with_customer',
  'faulty',
  'with_supplier',
  'scrapped',
] as const;
export const SerialStateSchema = z.enum(SERIAL_STATES);
export type SerialState = z.infer<typeof SerialStateSchema>;

/** The states in which a serial sits in a bin, and those in which it has left the company's stock. */
export const SERIAL_STATES_IN_BIN = ['in_stock', 'reserved', 'picked', 'faulty'] as const;
export const SERIAL_STATES_OUT = ['with_customer', 'with_supplier', 'scrapped'] as const;

/** Why stock moved: every movement of the ledger names one. */
export const STOCK_REASONS = [
  'opening',
  'receipt',
  'transfer',
  'pick',
  'issue',
  'return_customer',
  'return_supplier',
  'adjust_gain',
  'adjust_loss',
  'damage',
  'count',
  'warranty_replacement',
  'surplus_in',
  'surplus_out',
  'reversal',
] as const;
export const StockReasonSchema = z.enum(STOCK_REASONS);
export type StockReason = z.infer<typeof StockReasonSchema>;

/**
 * The reasons `app.stock_move()` accepts in H1, each with the grant it needs; every other reason is
 * refused until the slice that opens it (`stock_reason_not_open`).
 */
export const OPEN_STOCK_REASONS = {
  opening: 'inventory.stock.adjust',
  adjust_gain: 'inventory.stock.adjust',
  adjust_loss: 'inventory.stock.adjust',
  damage: 'inventory.stock.adjust',
  count: 'inventory.stock.adjust',
  reversal: 'inventory.stock.adjust',
  transfer: 'inventory.stock.move',
} as const satisfies Partial<Record<StockReason, string>>;

/**
 * The movements a person may reverse; opening stock, a receipt or an issue is reversed by its own
 * document (the opening import's rollback, the receipt, the dispatch).
 */
export const REVERSIBLE_STOCK_REASONS = [
  'adjust_gain',
  'adjust_loss',
  'damage',
  'count',
  'transfer',
] as const satisfies readonly StockReason[];

/** The refusals of the ledger (`app.stock_move()`), each a catalogue reason. */
export const STOCK_REFUSALS = [
  'stock_batch_empty',
  'stock_batch_too_large',
  'stock_reason_not_open',
  'stock_movement_shape',
  'stock_movement_missing',
  'stock_reversal_not_allowed',
  'stock_already_reversed',
  'stock_bin_missing',
  'stock_bin_archived',
  'stock_transit_pair',
  'stock_item_missing',
  'stock_item_inactive',
  'stock_item_not_stocked',
  'stock_serial_untracked',
  'stock_serial_qty',
  'stock_serial_required',
  'stock_serial_exists',
  'stock_serial_unknown',
  'stock_serial_not_in_bin',
  // X4: a serial in a state its movement does not take, and a delivery's customer not found.
  'stock_serial_state',
  'stock_customer_missing',
  'stock_insufficient',
  'opening_stock_posted',
] as const;
export type StockRefusal = (typeof STOCK_REFUSALS)[number];
