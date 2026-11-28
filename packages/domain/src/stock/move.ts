import {
  DomainError,
  RESERVATION_REFUSALS,
  STOCK_REFUSALS,
  type ReservationRefusal,
  type StockReason,
  type StockRefusal,
} from '@shakti/contracts';
import type { RequestTx } from '@shakti/db';
import { sql } from 'drizzle-orm';

export interface StockMovementLine {
  reason: Exclude<StockReason, typeof REVERSAL>;
  entityId: number;
  itemId: string;
  /** An existing serial of a tracked item. */
  serialId?: string | null;
  /** A serial by its number: a new one for `opening` and `adjust_gain`, else an existing one. */
  serialNo?: string | null;
  fromBinId?: string | null;
  toBinId?: string | null;
  /** In the item's stock unit, up to three decimals. */
  qty: string;
  refType?: string | null;
  refId?: string | null;
  /** An inbound line's cost per unit, four decimals; else the definer's moving average. */
  unitCost?: string | null;
  /** Why a person moved it, up to 300 characters. */
  note?: string | null;
}

/** The ledger's reasons the helpers name (constants, so no error catalogue reads them as one). */
export const REVERSAL: Extract<StockReason, 'reversal'> = 'reversal';
export const TRANSFER: Extract<StockReason, 'transfer'> = 'transfer';
export const OPENING: Extract<StockReason, 'opening'> = 'opening';

/** A reversal names only the movement it reverses and a reference. */
export interface StockReversalLine {
  reason: typeof REVERSAL;
  reversesId: string;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
}

/**
 * One line of a batch for `app.stock_move()`, the ledger's one write path
 * (docs/03-roadmap-appendix/phase3.md §5). A reversal takes the rest from the movement it reverses.
 */
export type StockMoveLine = StockMovementLine | StockReversalLine;

/** The refusals a person can act on as a state of the stock, rather than a mistake in the input. */
const CONFLICTS: ReadonlySet<string> = new Set<StockRefusal | ReservationRefusal>([
  'stock_insufficient',
  'stock_serial_not_in_bin',
  'stock_serial_state',
  'stock_serial_exists',
  'stock_already_reversed',
  'opening_stock_posted',
  'stock_bin_archived',
  // H2: what the bins hold for orders, and a reservation's own state.
  'stock_reserved_insufficient',
  'reservation_stock_short',
  'reservation_order_reserved',
  'reservation_not_active',
  'reservation_already_extended',
]);

/** The two unique indexes a concurrent batch can meet, with the refusal each one means. */
const RACES: Readonly<Record<string, StockRefusal>> = {
  serials_item_serial_no_unique: 'stock_serial_exists',
  stock_movements_reverses_unique: 'stock_already_reversed',
};

/**
 * The check a concurrent reserver can meet, with the refusal it means: reserved stock would exceed
 * what the bin holds (`stock_balances_reserved_on_hand_check`), which the definers' locks prevent
 * and the check backs, so a race nobody foresaw answers as stock that is short, never an
 * internal error.
 */
const CHECK_RACES: Readonly<Record<string, ReservationRefusal>> = {
  stock_balances_reserved_on_hand_check: 'reservation_stock_short',
};

/** The facts a refusal may carry to a screen: ids, codes and the batch line, never a cost. */
const FACTS = ['line', 'itemId', 'sku', 'binId', 'binCode', 'serialNo', 'entityId'] as const;

const REFUSALS: ReadonlySet<string> = new Set([...STOCK_REFUSALS, ...RESERVATION_REFUSALS]);

interface PgFailure {
  code?: unknown;
  constraint_name?: unknown;
  detail?: unknown;
}

function pgFailure(e: unknown): PgFailure | undefined {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  return cause instanceof Error ? (cause as PgFailure) : undefined;
}

function facts(detail: unknown): Record<string, unknown> {
  if (typeof detail !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const key of FACTS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string' || typeof value === 'number') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The ledger's refusal (or a reservation definer's, H2) as a domain error with its catalogue reason and the facts it names, or
 * undefined for any other failure (which the runner translates as usual).
 */
export function stockRefusal(e: unknown): DomainError | undefined {
  const failure = pgFailure(e);
  if (failure === undefined) return undefined;
  const constraint =
    typeof failure.constraint_name === 'string' ? failure.constraint_name : undefined;
  if (constraint === undefined) return undefined;
  let reason: StockRefusal | ReservationRefusal | undefined;
  if (failure.code === '23514') {
    reason = REFUSALS.has(constraint)
      ? (constraint as StockRefusal | ReservationRefusal)
      : CHECK_RACES[constraint];
  } else if (failure.code === '23505') reason = RACES[constraint];
  if (reason === undefined) return undefined;
  return new DomainError(
    CONFLICTS.has(reason) ? 'conflict' : 'validation_failed',
    `stock movement refused: ${reason}`,
    { ...facts(failure.detail), reason },
    { cause: e },
  );
}

function lineJson(line: StockMoveLine): Record<string, unknown> {
  if (line.reason === REVERSAL) {
    return {
      reason: REVERSAL,
      reverses_id: line.reversesId,
      ref_type: line.refType ?? null,
      ref_id: line.refId ?? null,
      note: line.note ?? null,
    };
  }
  return {
    reason: line.reason,
    entity_id: line.entityId,
    item_id: line.itemId,
    serial_id: line.serialId ?? null,
    serial_no: line.serialNo ?? null,
    from_bin_id: line.fromBinId ?? null,
    to_bin_id: line.toBinId ?? null,
    qty: line.qty,
    ref_type: line.refType ?? null,
    ref_id: line.refId ?? null,
    unit_cost: line.unitCost ?? null,
    note: line.note ?? null,
  };
}

/**
 * Posts a batch through `app.stock_move()` in the caller's transaction and answers the movement
 * ids in the order given. The definer checks the caller's grant for each reason, locks what it
 * touches in the one fixed order and refuses what the stock cannot do; a refusal is thrown as a
 * `DomainError` with its catalogue reason. Nothing it answers carries a cost.
 */
export async function stockMove(tx: RequestTx, lines: readonly StockMoveLine[]): Promise<string[]> {
  const payload = JSON.stringify(lines.map(lineJson));
  try {
    const rows = (await tx.execute(
      sql`select app.stock_move(${payload}::jsonb) as ids`,
    )) as unknown as { ids: string[] }[];
    return rows[0]?.ids ?? [];
  } catch (e) {
    throw stockRefusal(e) ?? e;
  }
}
