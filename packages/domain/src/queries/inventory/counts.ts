import {
  DomainError,
  GetStockCountInput,
  hasGrant,
  ListStockCountsInput,
  StockCountPageDto,
  StockCountReviewDto,
  StockCountRowDto,
  StockCountSheetDto,
  type SerialState,
  type StockCountMovementDto,
  type ItemUnit,
  type StockCountReviewLineDto,
  type StockCountSheetRowDto,
} from '@shakti/contracts';
import type { RequestContext, RequestTx } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { assertEntityInScope } from '../../commands/imports/shared';
import { checkPermission } from '../../command/run-command';
import { countProgress } from '../../commands/inventory/counts-shared';
import {
  fromMilli,
  serialLineRefusal,
  toMilli,
  varianceMilli,
  type CountLineFacts,
} from '../../commands/inventory/counts-plan';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

/**
 * The reads of stock counts (H3, docs/03-roadmap-appendix/phase3.md §7.3). The list and the
 * counter's sheet carry no expected quantity: the sheet comes from `app.stock_count_sheet()`,
 * which never selects one. The review, for `inventory.stock.adjust` only, reads the expected
 * quantities through `app.stock_count_review()`, and values each variance at the moving average
 * only for a holder of `finance.cost.read` (the cost table's own policy decides the rest).
 */

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const ListCursor = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** At most this many movements during a count are listed on its review. */
const REVIEW_MOVEMENTS = 200;

const COUNT_ROW_SELECT = sql`
  c.id, c.entity_id as "entityId", c.warehouse_id as "hubId", c.scope,
  c.scope_bin_ids as "binIds", c.scope_item_ids as "itemIds", c.state,
  c.started_at as "startedAt", c.started_by as "startedBy", c.submitted_at as "submittedAt",
  c.posted_at as "postedAt", c.post_note as "postNote", c.cancelled_at as "cancelledAt",
  c.cancel_reason as "cancelReason", coalesce(w.code, '') as "hubCode",
  coalesce(w.name, '') as "hubName", coalesce(p.display_name, '') as "startedByName"`;

/**
 * The hub's code and name come through `app.stock_count_hub()`, so a counter who holds
 * `inventory.stock.move` without `inventory.stock.read` (which H1's hubs need) still sees them.
 */
const COUNT_ROW_JOINS = sql`
  left join lateral app.stock_count_hub(c.warehouse_id) w on true
  left join principals p on p.id = c.started_by`;

type Stamp = string | Date | null;

interface CountRowRaw {
  id: string;
  entityId: number;
  hubId: string;
  scope: string;
  binIds: string[] | null;
  itemIds: string[] | null;
  state: string;
  startedAt: Stamp;
  startedBy: string;
  submittedAt: Stamp;
  postedAt: Stamp;
  postNote: string | null;
  cancelledAt: Stamp;
  cancelReason: string | null;
  hubCode: string;
  hubName: string;
  startedByName: string;
}

const iso = (value: Stamp): string | null =>
  value === null ? null : new Date(value).toISOString();

function toRowDto(row: CountRowRaw): StockCountRowDto {
  return StockCountRowDto.parse({
    ...row,
    startedAt: iso(row.startedAt),
    submittedAt: iso(row.submittedAt),
    postedAt: iso(row.postedAt),
    cancelledAt: iso(row.cancelledAt),
  });
}

async function readCountRow(ctx: Ctx, countId: string): Promise<StockCountRowDto> {
  const [row] = (await ctx.tx.execute(sql`
    select ${COUNT_ROW_SELECT} from stock_counts c ${COUNT_ROW_JOINS}
     where c.id = ${countId}`)) as unknown as CountRowRaw[];
  if (!row)
    throw new DomainError('not_found', 'count not found', { reason: 'stock_count_missing' });
  assertEntityInScope(ctx.entityIds, row.entityId);
  return toRowDto(row);
}

/**
 * `/inventory/counts`: one company's counts, by state when asked, newest first (keyset on the
 * start and id, by `stock_counts_list_idx`), for anyone who reads stock or counts it.
 */
export async function listStockCounts(ctx: Ctx, rawInput: unknown): Promise<StockCountPageDto> {
  const input = parseQueryInput(ListStockCountsInput, rawInput, 'inventory.count.list');
  assertEntityInScope(ctx.entityIds, input.entityId);
  if (!hasGrant(ctx.principal.permissions, 'inventory.stock.move', 'entity')) {
    checkPermission(ctx.principal, 'inventory.stock.read', 'entity');
  }
  const where: SQL[] = [sql`c.entity_id = ${input.entityId}`];
  if (input.state !== undefined) where.push(sql`c.state = ${input.state}`);
  if (input.cursor !== undefined) {
    const [at, id] = decodeCursor(ListCursor, input.cursor);
    where.push(sql`(c.started_at, c.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = (await ctx.tx.execute(sql`
    select ${COUNT_ROW_SELECT} from stock_counts c ${COUNT_ROW_JOINS}
     where ${sql.join(where, sql` and `)}
     order by c.started_at desc, c.id desc
     limit ${input.limit + 1}`)) as unknown as CountRowRaw[];
  const page = rows.slice(0, input.limit).map(toRowDto);
  const last = page.at(-1);
  return StockCountPageDto.parse({
    items: page,
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor([last.startedAt, last.id])
        : null,
  });
}

interface SheetRaw {
  binId: string;
  binCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  isSerialTracked: boolean;
  serialPattern: string | null;
  state: StockCountSheetRowDto['state'];
  countedQty: string | null;
  serialNos: string[] | null;
}

/**
 * The counting screen (`inventory.stock.move`): each item in each bin, whether it is still to
 * count, counted or asked for again, and what the counter entered, and the bins a counter may
 * count stock found in. Never what the ledger expects, and nothing that needs
 * `inventory.stock.read`.
 */
export async function getStockCountSheet(ctx: Ctx, rawInput: unknown): Promise<StockCountSheetDto> {
  const input = parseQueryInput(GetStockCountInput, rawInput, 'inventory.count.sheet');
  checkPermission(ctx.principal, 'inventory.stock.move', 'entity');
  const count = await readCountRow(ctx, input.countId);
  const rows = (await ctx.tx.execute(sql`
    select bin_id as "binId", bin_code as "binCode", item_id as "itemId", sku,
           item_name as "itemName", unit, is_serial_tracked as "isSerialTracked",
           serial_pattern as "serialPattern", line_state as state,
           counted_qty::numeric(12, 3)::text as "countedQty", serial_nos as "serialNos"
      from app.stock_count_sheet(${input.countId}::uuid)`)) as unknown as SheetRaw[];
  const bins = (await ctx.tx.execute(sql`
    select id, code from app.stock_count_bins(${input.countId}::uuid)`)) as unknown as {
    id: string;
    code: string;
  }[];
  return StockCountSheetDto.parse({
    count,
    rows,
    bins,
    progress: await countProgress(ctx.tx, input.countId),
  });
}

interface ReviewRaw {
  lineId: string;
  binId: string;
  itemId: string;
  serialId: string | null;
  serialNo: string | null;
  expectedQty: string;
  countedQty: string | null;
  recountQty: string | null;
  recountOpen: boolean;
  finalQty: string | null;
  countedAt: Stamp;
  expectedAtCount: string;
  serialMovedSince: boolean;
  serialState: SerialState | null;
  serialBinId: string | null;
}

/** The review's lines through `app.stock_count_review()` (`inventory.stock.adjust`). */
export async function readReviewLines(
  tx: RequestTx,
  countId: string,
): Promise<(CountLineFacts & ReviewRaw)[]> {
  return (await tx.execute(sql`
    select line_id as "lineId", bin_id as "binId", item_id as "itemId", serial_id as "serialId",
           serial_no as "serialNo", expected_qty::numeric(12, 3)::text as "expectedQty",
           counted_qty::numeric(12, 3)::text as "countedQty",
           recount_qty::numeric(12, 3)::text as "recountQty", recount_open as "recountOpen",
           final_qty::numeric(12, 3)::text as "finalQty", counted_at as "countedAt",
           expected_at_count::numeric(13, 3)::text as "expectedAtCount",
           serial_moved_since as "serialMovedSince", serial_state as "serialState",
           serial_bin_id as "serialBinId"
      from app.stock_count_review(${countId}::uuid)`)) as unknown as (CountLineFacts & ReviewRaw)[];
}

/** A variance in thousandths at a cost per unit (four decimals), in rupees to the paisa. */
function valueOf(varianceMilli: number, unitCost: string): string {
  const [whole = '0', fraction = ''] = unitCost.split('.');
  const cost = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0').slice(0, 4));
  // thousandths × ten-thousandths = 10^-7 rupees; to paise is 10^-2, so divide by 10^5.
  const product = BigInt(varianceMilli) * cost;
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const paise = (abs + 50000n) / 100000n;
  const text = `${(paise / 100n).toString()}.${(paise % 100n).toString().padStart(2, '0')}`;
  return negative && paise !== 0n ? `-${text}` : text;
}

function sumMoney(values: readonly string[]): string {
  const paise = values.reduce((sum, v) => {
    const negative = v.startsWith('-');
    const n = BigInt((negative ? v.slice(1) : v).replace('.', ''));
    return sum + (negative ? -n : n);
  }, 0n);
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const text = `${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

type LineValue = (
  line: Pick<CountLineFacts, 'binId' | 'itemId' | 'serialId'>,
  varianceMilli: number,
) => string | null;

/**
 * A live count's values (`finance.cost.read`, read under the viewer's own grant): each variance
 * at the item's moving average now; null for an item with no average.
 */
async function valuesNow(
  ctx: Ctx,
  entityId: number,
  itemIds: readonly string[],
): Promise<LineValue> {
  const rows = (await ctx.tx.execute(sql`
    select item_id as "itemId", moving_avg_cost::numeric(14, 4)::text as cost
      from item_costs
     where entity_id = ${entityId} and moving_avg_cost is not null
       and item_id = any(${`{${itemIds.join(',')}}`}::uuid[])`)) as unknown as {
    itemId: string;
    cost: string;
  }[];
  const costs = new Map(rows.map((r) => [r.itemId, r.cost]));
  return (line, variance) => {
    const cost = costs.get(line.itemId);
    return cost === undefined ? null : valueOf(variance, cost);
  };
}

/**
 * A posted count's values, as they were posted: each line's movements of this count (into the
 * line's bin for more, out of it for less; a serial's by its serial) at the cost each posted with
 * (`stock_movement_costs`, `finance.cost.read`, read under the viewer's own grants), so a sheet
 * printed later reads the same. A line with no difference is worth nothing; one whose movements
 * have no cost the viewer reads has no value.
 */
async function postedValues(ctx: Ctx, count: StockCountRowDto): Promise<LineValue> {
  const rows = (await ctx.tx.execute(sql`
    select m.item_id as "itemId", m.serial_id as "serialId", m.from_bin_id as "fromBinId",
           m.to_bin_id as "toBinId", m.qty::numeric(12, 3)::text as qty,
           c.unit_cost::numeric(14, 4)::text as cost
      from stock_movements m
      join stock_movement_costs c on c.movement_id = m.id and c.entity_id = m.entity_id
     where m.entity_id = ${count.entityId} and m.ref_type = 'stock_count'
       and m.ref_id = ${count.id}::uuid`)) as unknown as {
    itemId: string;
    serialId: string | null;
    fromBinId: string | null;
    toBinId: string | null;
    qty: string;
    cost: string;
  }[];
  const byLine = new Map<string, string[]>();
  const add = (key: string, value: string) => {
    byLine.set(key, [...(byLine.get(key) ?? []), value]);
  };
  const keyOf = (bin: string, itemId: string, serialId: string | null) =>
    `${bin}/${itemId}/${serialId ?? ''}`;
  for (const r of rows) {
    const milli = toMilli(r.qty);
    if (r.toBinId !== null) add(keyOf(r.toBinId, r.itemId, r.serialId), valueOf(milli, r.cost));
    if (r.fromBinId !== null) {
      add(keyOf(r.fromBinId, r.itemId, r.serialId), valueOf(-milli, r.cost));
    }
  }
  return (line, variance) => {
    if (variance === 0) return '0.00';
    const posted = byLine.get(keyOf(line.binId, line.itemId, line.serialId));
    return posted === undefined ? null : sumMoney(posted);
  };
}

interface NamesRaw {
  bins: { id: string; code: string }[] | null;
  items: { id: string; sku: string; name: string; unit: ItemUnit }[] | null;
}

/**
 * The review and the count's sheet for the record (`inventory.stock.adjust`): every line with
 * what the ledger expected at the start, what moved in the bin until it was counted, what was
 * counted and the variance, and why a serial's line cannot post as it stands; the movements into
 * or out of the counted bins since the start; and, only with `finance.cost.read`, each variance's
 * value (at the moving average while the count is live, at the posted costs once posted).
 */
export async function getStockCountReview(
  ctx: Ctx,
  rawInput: unknown,
): Promise<StockCountReviewDto> {
  const input = parseQueryInput(GetStockCountInput, rawInput, 'inventory.count.review');
  checkPermission(ctx.principal, 'inventory.stock.adjust', 'entity');
  const count = await readCountRow(ctx, input.countId);
  const lines = await readReviewLines(ctx.tx, input.countId);
  const binIds = [...new Set(lines.map((l) => l.binId))];
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const [names] = (await ctx.tx.execute(sql`
    select (select json_agg(json_build_object('id', b.id, 'code', b.code)) from bins b
             where b.id = any(${`{${binIds.join(',')}}`}::uuid[])) as bins,
           (select json_agg(json_build_object('id', i.id, 'sku', i.sku, 'name', i.name, 'unit', i.unit))
              from items i where i.id = any(${`{${itemIds.join(',')}}`}::uuid[])) as items`)) as unknown as NamesRaw[];
  const binCode = new Map((names?.bins ?? []).map((b) => [b.id, b.code]));
  const item = new Map((names?.items ?? []).map((i) => [i.id, i]));

  const showsValues = hasGrant(ctx.principal.permissions, 'finance.cost.read', 'entity');
  const valueOfLine =
    !showsValues || lines.length === 0
      ? () => null
      : count.state === 'posted'
        ? await postedValues(ctx, count)
        : await valuesNow(ctx, count.entityId, itemIds);

  const values: string[] = [];
  const reviewLines: StockCountReviewLineDto[] = lines.map((l) => {
    const i = item.get(l.itemId);
    const variance = l.recountOpen ? null : varianceMilli(l);
    const value = variance === null ? null : valueOfLine(l, variance);
    if (value !== null) values.push(value);
    return {
      lineId: l.lineId,
      binId: l.binId,
      binCode: binCode.get(l.binId) ?? '',
      itemId: l.itemId,
      sku: i?.sku ?? '',
      itemName: i?.name ?? '',
      unit: i?.unit ?? 'nos',
      serialId: l.serialId,
      serialNo: l.serialNo,
      expectedAtStart: l.expectedQty,
      movedDuringCount: fromMilli(toMilli(l.expectedAtCount) - toMilli(l.expectedQty)),
      expectedAtCount: fromMilli(toMilli(l.expectedAtCount)),
      firstCount: l.countedQty,
      recount: l.recountOpen ? null : l.recountQty,
      counted: l.recountOpen ? null : l.finalQty,
      recountOpen: l.recountOpen,
      variance: variance === null ? null : fromMilli(variance),
      value,
      postRefusal:
        count.state === 'posted' || count.state === 'cancelled' ? null : serialLineRefusal(l),
    };
  });

  const scopeItems =
    count.itemIds === null
      ? sql``
      : sql`and m.item_id = any(${`{${count.itemIds.join(',')}}`}::uuid[])`;
  const scopeBins =
    count.binIds === null
      ? sql`select b.id from bins b where b.warehouse_id = ${count.hubId}`
      : sql`select unnest(${`{${count.binIds.join(',')}}`}::uuid[])`;
  const movements = (await ctx.tx.execute(sql`
    select m.id, m.moved_at as "movedAt", m.reason, m.item_id as "itemId", i.sku,
           s.serial_no as "serialNo", fb.code as "fromBinCode", tb.code as "toBinCode",
           m.qty::numeric(12, 3)::text as qty
      from stock_movements m
      join items i on i.id = m.item_id
      left join serials s on s.id = m.serial_id
      left join bins fb on fb.id = m.from_bin_id
      left join bins tb on tb.id = m.to_bin_id
     where m.entity_id = ${count.entityId}
       and m.moved_at > ${count.startedAt}::timestamptz
       and (m.to_bin_id in (${scopeBins}) or m.from_bin_id in (${scopeBins}))
       and (m.ref_type is distinct from 'stock_count' or m.ref_id is distinct from ${count.id}::uuid)
       ${scopeItems}
     order by m.moved_at desc, m.id desc
     limit ${REVIEW_MOVEMENTS + 1}`)) as unknown as (Omit<StockCountMovementDto, 'movedAt'> & {
    movedAt: Stamp;
  })[];

  return StockCountReviewDto.parse({
    count,
    lines: reviewLines,
    movements: movements.slice(0, REVIEW_MOVEMENTS).map((m) => ({ ...m, movedAt: iso(m.movedAt) })),
    moreMovements: movements.length > REVIEW_MOVEMENTS,
    progress: await countProgress(ctx.tx, input.countId),
    showsValues,
    netValue: showsValues ? sumMoney(values) : null,
  });
}
