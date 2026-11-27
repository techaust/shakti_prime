import {
  DomainError,
  STOCK_COUNT_REFUSALS,
  StockCountDto,
  StockCountProgressDto,
  type StockCountRefusal,
  type StockCountState,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { transition } from '../../state-machines/define-machine';
import {
  stockCountMachine,
  type StockCountEvent,
  type StockCountRecord,
} from '../../state-machines/machines/stock-count';
import { stockRefusal } from '../../stock/move';

/**
 * What the count commands share (H3, docs/03-roadmap-appendix/phase3.md §7.3): the header read
 * and locked, the machine fired, the progress per item in a bin, and the definers' refusals as
 * domain errors. Nothing here reads a line's expected quantity.
 */

/** Every key the count commands' audit rows record besides ids: never a value, never expected. */
export const COUNT_AUDIT_FIELDS = [
  'state',
  'countScope',
  'quantity',
  'serialsCounted',
  'countNote',
  'cancelReason',
] as const;

/** The live-count index a second start races against. */
export const COUNT_CONSTRAINTS = {
  stock_counts_live_unique: 'stock_count_live',
  stock_count_closed: 'stock_count_closed',
  stock_count_transition: 'stock_count_transition',
} as const;

type CountRow = typeof schema.stockCounts.$inferSelect;

/** The facts a count refusal may carry to a screen: ids, codes and serial numbers. */
const FACTS = ['binId', 'itemId', 'serialNo', 'binCode'] as const;
const REFUSALS: ReadonlySet<string> = new Set(STOCK_COUNT_REFUSALS);
const CONFLICTS: ReadonlySet<StockCountRefusal> = new Set<StockCountRefusal>([
  'stock_count_started',
  'stock_count_not_counting',
  'stock_count_serial_counted_elsewhere',
  'stock_count_uncounted',
  'stock_count_closed',
  'stock_count_transition',
]);

function causeOf(e: unknown): { code?: unknown; constraint_name?: unknown; detail?: unknown } {
  const cause = e instanceof Error && e.cause instanceof Error ? e.cause : e;
  return cause instanceof Error ? (cause as { code?: unknown }) : {};
}

function factsOf(detail: unknown): Record<string, unknown> {
  if (typeof detail !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const key of FACTS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === 'string') out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * A count definer's refusal (or the ledger's, from `app.stock_move()`) as a domain error with its
 * catalogue reason, or undefined for any other failure, which the runner translates as usual.
 */
export function countRefusal(e: unknown): DomainError | undefined {
  const failure = causeOf(e);
  const constraint =
    typeof failure.constraint_name === 'string' ? failure.constraint_name : undefined;
  if (failure.code === '23514' && constraint !== undefined && REFUSALS.has(constraint)) {
    const reason = constraint as StockCountRefusal;
    return new DomainError(
      CONFLICTS.has(reason) ? 'conflict' : 'validation_failed',
      `stock count refused: ${reason}`,
      { ...factsOf(failure.detail), reason },
      { cause: e },
    );
  }
  return stockRefusal(e);
}

/** Runs a definer call, turning its refusal into the domain error a screen names. */
export async function viaDefiner<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    throw countRefusal(e) ?? e;
  }
}

export function toCountDto(row: CountRow): StockCountDto {
  return StockCountDto.parse({
    id: row.id,
    entityId: row.entityId,
    hubId: row.warehouseId,
    scope: row.scope,
    binIds: row.scopeBinIds,
    itemIds: row.scopeItemIds,
    state: row.state,
    startedAt: row.startedAt.toISOString(),
    startedBy: row.startedBy,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    postedAt: row.postedAt?.toISOString() ?? null,
    postNote: row.postNote,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
  });
}

/**
 * The count's header, locked against every other command on it until this transaction ends, so
 * a count is recorded, asked again, sent, posted or cancelled one step at a time. A count the
 * caller cannot read is not found.
 */
export async function lockCount(ctx: CommandContext, countId: string): Promise<CountRow> {
  const c = schema.stockCounts;
  const [row] = await ctx.tx
    .select()
    .from(c)
    .where(eq(c.id, countId))
    .limit(1)
    .for('no key update');
  if (!row) {
    throw new DomainError('not_found', 'count not found', { reason: 'stock_count_missing' });
  }
  if (!ctx.entityIds.includes(row.entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', {
      entityId: row.entityId,
    });
  }
  return row;
}

/** How far the count has come, per item in a bin, through `app.stock_count_progress()`. */
export async function countProgress(
  tx: RequestTx,
  countId: string,
): Promise<StockCountProgressDto> {
  const rows = (await tx.execute(
    sql`select items_in_bins as "itemsInBins", to_count as "toCount", recount_open as "recountOpen"
          from app.stock_count_progress(${countId}::uuid)`,
  )) as unknown as StockCountProgressDto[];
  return StockCountProgressDto.parse(rows[0] ?? { itemsInBins: 0, toCount: 0, recountOpen: 0 });
}

/** Fires `event` on the count through the `stock-count` machine and answers the new state. */
export function fireCount(
  ctx: CommandContext,
  record: StockCountRecord,
  event: StockCountEvent,
): StockCountState {
  return transition(stockCountMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: {},
  }).to;
}

/** The record the machine reads, with the progress from the definer. */
export async function countRecord(
  ctx: CommandContext,
  row: CountRow,
): Promise<StockCountRecord & { progress: StockCountProgressDto }> {
  const progress = await countProgress(ctx.tx, row.id);
  return {
    state: row.state as StockCountState,
    toCount: progress.toCount,
    recountOpen: progress.recountOpen,
    progress,
  };
}

/** Writes the count's new state and stamps, and answers the header as it now stands. */
export async function setCountState(
  ctx: CommandContext,
  row: CountRow,
  to: StockCountState,
  stamps: Partial<
    Pick<
      CountRow,
      | 'submittedAt'
      | 'submittedBy'
      | 'postedAt'
      | 'postedBy'
      | 'postNote'
      | 'cancelledAt'
      | 'cancelledBy'
      | 'cancelReason'
    >
  > = {},
): Promise<CountRow> {
  if (to === row.state && Object.keys(stamps).length === 0) return row;
  const c = schema.stockCounts;
  const [updated] = await ctx.tx
    .update(c)
    .set({
      state: to,
      ...(to === row.state ? {} : { stateChangedAt: ctx.now }),
      ...stamps,
      updatedBy: ctx.principal.id,
    })
    .where(eq(c.id, row.id))
    .returning();
  if (!updated) throw new DomainError('internal', 'count update returned no row');
  return updated;
}
