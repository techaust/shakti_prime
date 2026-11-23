import {
  DomainError,
  GetSerialInput,
  GetStockCardInput,
  hasGrant,
  ListStockBalancesInput,
  ReadStockValuationInput,
  REVERSIBLE_STOCK_REASONS,
  SerialDto,
  StockBalancePageDto,
  StockCardDto,
  StockValuationDto,
  type StockItemDto,
  type StockMovementRowDto,
} from '@shakti/contracts';
import type { RequestContext } from '@shakti/db';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { assertEntityInScope } from '../../commands/imports/shared';
import { checkPermission } from '../../command/run-command';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

/**
 * The stock ledger's reads (H1, docs/03-roadmap-appendix/phase3.md §6.2): balances by hub, bin
 * and item, an item's stock card, a serial's history, all with `inventory.stock.read` for the
 * company and none carrying a cost; and the valuation, with `finance.cost.read` only, its value
 * summed from the movements' own costs up to the date.
 */

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const BalanceCursor = z.tuple([z.uuid(), z.uuid(), z.uuid()]);
const CardCursor = z.tuple([z.iso.datetime({ offset: true }), z.uuid()]);

/** `%`, `_` and `\` typed into a search match themselves. */
function likeText(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function readGuard(ctx: Ctx, entityId: number): void {
  assertEntityInScope(ctx.entityIds, entityId);
  checkPermission(ctx.principal, 'inventory.stock.read', 'entity');
}

interface BalanceRow {
  hubId: string;
  hubCode: string;
  hubName: string;
  binId: string;
  binCode: string;
  binKind: string;
  itemId: string;
  sku: string;
  itemName: string;
  unit: string;
  category: string;
  isSerialTracked: boolean;
  onHand: string;
  reserved: string;
  free: string | null;
}

/**
 * `/inventory/stock`: one company's balances above zero, by hub, bin and item (keyset on the
 * balance key, the order every stock path locks in), filtered by hub, bin, item, category or the
 * item's code or name. Free stock is on hand less reserved, in storage bins only.
 */
export async function listStockBalances(ctx: Ctx, rawInput: unknown): Promise<StockBalancePageDto> {
  const input = parseQueryInput(ListStockBalancesInput, rawInput, 'inventory.stock.list');
  readGuard(ctx, input.entityId);
  const where: SQL[] = [
    sql`b.entity_id = ${input.entityId}`,
    sql`(b.qty_on_hand > 0 or b.qty_reserved > 0)`,
  ];
  if (input.hubId !== undefined) where.push(sql`b.warehouse_id = ${input.hubId}`);
  if (input.binId !== undefined) where.push(sql`b.bin_id = ${input.binId}`);
  if (input.itemId !== undefined) where.push(sql`b.item_id = ${input.itemId}`);
  if (input.category !== undefined) where.push(sql`i.category = ${input.category}`);
  if (input.search !== undefined) {
    const text = likeText(input.search);
    where.push(sql`(i.sku like ${`${text.toUpperCase()}%`} or i.name ilike ${`%${text}%`})`);
  }
  if (input.cursor !== undefined) {
    const [hub, bin, item] = decodeCursor(BalanceCursor, input.cursor);
    where.push(
      sql`(b.warehouse_id, b.bin_id, b.item_id) > (${hub}::uuid, ${bin}::uuid, ${item}::uuid)`,
    );
  }
  const rows = (await ctx.tx.execute(sql`
    select b.warehouse_id as "hubId", w.code as "hubCode", w.name as "hubName",
           b.bin_id as "binId", bn.code as "binCode", bn.kind as "binKind",
           b.item_id as "itemId", i.sku, i.name as "itemName", i.unit, i.category,
           i.is_serial_tracked as "isSerialTracked",
           b.qty_on_hand::text as "onHand", b.qty_reserved::text as reserved,
           case when bn.kind = 'storage' then (b.qty_on_hand - b.qty_reserved)::numeric(12, 3)::text end as free
      from stock_balances b
      join warehouses w on w.id = b.warehouse_id
      join bins bn on bn.id = b.bin_id
      join items i on i.id = b.item_id
     where ${sql.join(where, sql` and `)}
     order by b.warehouse_id, b.bin_id, b.item_id
     limit ${input.limit + 1}`)) as unknown as BalanceRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return StockBalancePageDto.parse({
    items: page,
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor([last.hubId, last.binId, last.itemId])
        : null,
  });
}

interface MovementRow {
  id: string;
  movedAt: string | Date;
  reason: string;
  qty: string;
  fromId: string | null;
  fromCode: string | null;
  fromHub: string | null;
  toId: string | null;
  toCode: string | null;
  toHub: string | null;
  serialId: string | null;
  serialNo: string | null;
  movedBy: string | null;
  reversesId: string | null;
  reversedById: string | null;
}

/** The movement columns the card and the serial's page read, over the alias `m`. */
const MOVEMENT_SELECT = sql`
  m.id, m.moved_at as "movedAt", m.reason, m.qty::text as qty,
  m.from_bin_id as "fromId", fb.code as "fromCode", fw.code as "fromHub",
  m.to_bin_id as "toId", tb.code as "toCode", tw.code as "toHub",
  m.serial_id as "serialId", s.serial_no as "serialNo", p.display_name as "movedBy",
  m.reverses_id as "reversesId",
  (select r.id from stock_movements r where r.reverses_id = m.id) as "reversedById"`;

const MOVEMENT_JOINS = sql`
  left join bins fb on fb.id = m.from_bin_id
  left join warehouses fw on fw.id = fb.warehouse_id
  left join bins tb on tb.id = m.to_bin_id
  left join warehouses tw on tw.id = tb.warehouse_id
  left join serials s on s.id = m.serial_id
  left join principals p on p.id = m.moved_by`;

const REVERSIBLE: ReadonlySet<string> = new Set(REVERSIBLE_STOCK_REASONS);
const DAY_MS = 24 * 60 * 60 * 1000;

function toMovementDto(ctx: Ctx, row: MovementRow, now: Date): StockMovementRowDto {
  const movedAt = new Date(row.movedAt);
  const reversible =
    REVERSIBLE.has(row.reason) &&
    row.reversedById === null &&
    now.getTime() - movedAt.getTime() <= WORKSHOP_DEFAULTS.stock.reversalDays * DAY_MS &&
    hasGrant(ctx.principal.permissions, 'inventory.stock.adjust', 'entity');
  return {
    id: row.id,
    movedAt: movedAt.toISOString(),
    reason: row.reason as StockMovementRowDto['reason'],
    qty: row.qty,
    from:
      row.fromId === null
        ? null
        : { id: row.fromId, code: row.fromCode ?? '', hubCode: row.fromHub ?? '' },
    to:
      row.toId === null ? null : { id: row.toId, code: row.toCode ?? '', hubCode: row.toHub ?? '' },
    serialId: row.serialId,
    serialNo: row.serialNo,
    movedBy: row.movedBy ?? '',
    reversesId: row.reversesId,
    reversedById: row.reversedById,
    reversible,
  };
}

async function stockItem(ctx: Ctx, itemId: string): Promise<StockItemDto> {
  const [item] = (await ctx.tx.execute(sql`
    select id, sku, name, unit, category, is_serial_tracked as "isSerialTracked",
           (is_active and archived_at is null) as "isActive"
      from items where id = ${itemId}`)) as unknown as StockItemDto[];
  if (!item) throw new DomainError('not_found', 'item not found', { reason: 'stock_item_missing' });
  return item;
}

/**
 * An item's stock card in one company: what each hub holds, and its movements newest first
 * (keyset on the time and id, by `stock_movements_card_idx`), optionally those touching one hub.
 */
export async function getStockCard(
  ctx: Ctx,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<StockCardDto> {
  const input = parseQueryInput(GetStockCardInput, rawInput, 'inventory.stock.card');
  readGuard(ctx, input.entityId);
  const item = await stockItem(ctx, input.itemId);
  const byHub = (await ctx.tx.execute(sql`
    select b.warehouse_id as "hubId", w.code as "hubCode", w.name as "hubName",
           sum(b.qty_on_hand)::numeric(12, 3)::text as "onHand",
           sum(b.qty_reserved)::numeric(12, 3)::text as reserved
      from stock_balances b join warehouses w on w.id = b.warehouse_id
     where b.entity_id = ${input.entityId} and b.item_id = ${input.itemId}
     group by b.warehouse_id, w.code, w.name
    having sum(b.qty_on_hand) > 0 or sum(b.qty_reserved) > 0
     order by w.code`)) as unknown as StockCardDto['byHub'];
  const where: SQL[] = [sql`m.entity_id = ${input.entityId}`, sql`m.item_id = ${input.itemId}`];
  if (input.hubId !== undefined) {
    where.push(sql`(fb.warehouse_id = ${input.hubId} or tb.warehouse_id = ${input.hubId})`);
  }
  if (input.cursor !== undefined) {
    const [at, id] = decodeCursor(CardCursor, input.cursor);
    where.push(sql`(m.moved_at, m.id) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = (await ctx.tx.execute(sql`
    select ${MOVEMENT_SELECT}
      from stock_movements m ${MOVEMENT_JOINS}
     where ${sql.join(where, sql` and `)}
     order by m.moved_at desc, m.id desc
     limit ${input.limit + 1}`)) as unknown as MovementRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return StockCardDto.parse({
    entityId: input.entityId,
    item,
    byHub,
    movements: page.map((r) => toMovementDto(ctx, r, now)),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor([new Date(last.movedAt).toISOString(), last.id])
        : null,
  });
}

/** A serial and its movements, newest first (the 200 latest). */
export async function getSerial(
  ctx: Ctx,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<SerialDto> {
  const input = parseQueryInput(GetSerialInput, rawInput, 'inventory.serial.get');
  readGuard(ctx, input.entityId);
  const [serial] = (await ctx.tx.execute(sql`
    select s.id, s.entity_id as "entityId", s.item_id as "itemId", s.serial_no as "serialNo",
           s.state, s.bin_id as "binId", b.code as "binCode", w.code as "hubCode",
           s.delivered_at as "deliveredAt", s.warranty_until::text as "warrantyUntil",
           s.supplier_warranty_until::text as "supplierWarrantyUntil"
      from serials s
      left join bins b on b.id = s.bin_id
      left join warehouses w on w.id = b.warehouse_id
     where s.id = ${input.serialId} and s.entity_id = ${input.entityId}`)) as unknown as {
    id: string;
    entityId: number;
    itemId: string;
    serialNo: string;
    state: string;
    binId: string | null;
    binCode: string | null;
    hubCode: string | null;
    deliveredAt: string | Date | null;
    warrantyUntil: string | null;
    supplierWarrantyUntil: string | null;
  }[];
  if (!serial) {
    throw new DomainError('not_found', 'serial not found', { reason: 'stock_serial_unknown' });
  }
  const rows = (await ctx.tx.execute(sql`
    select ${MOVEMENT_SELECT}
      from stock_movements m ${MOVEMENT_JOINS}
     where m.entity_id = ${input.entityId} and m.serial_id = ${input.serialId}
     order by m.moved_at desc, m.id desc
     limit 200`)) as unknown as MovementRow[];
  return SerialDto.parse({
    id: serial.id,
    entityId: serial.entityId,
    item: await stockItem(ctx, serial.itemId),
    serialNo: serial.serialNo,
    state: serial.state,
    bin:
      serial.binId === null
        ? null
        : { id: serial.binId, code: serial.binCode ?? '', hubCode: serial.hubCode ?? '' },
    deliveredAt: serial.deliveredAt === null ? null : new Date(serial.deliveredAt).toISOString(),
    warrantyUntil: serial.warrantyUntil,
    supplierWarrantyUntil: serial.supplierWarrantyUntil,
    movements: rows.map((r) => toMovementDto(ctx, r, now)),
  });
}

/**
 * The stock valuation (`finance.cost.read`): per hub and category of one company, the quantity
 * held at the close of a date in India, its value from the movements' own costs up to then (each
 * inbound movement adds its quantity at its cost, each outbound one takes it away at its cost),
 * and the average cost that value gives. Cost rows are read under their own policy too.
 */
export async function readStockValuation(ctx: Ctx, rawInput: unknown): Promise<StockValuationDto> {
  const input = parseQueryInput(ReadStockValuationInput, rawInput, 'inventory.stock.valuation');
  assertEntityInScope(ctx.entityIds, input.entityId);
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  const cut = sql`((${input.asOf}::date + 1)::timestamp at time zone 'Asia/Kolkata')`;
  const rows = (await ctx.tx.execute(sql`
    with x as (
      select bn.warehouse_id as hub, m.item_id, m.qty as q, m.qty * c.unit_cost as v
        from stock_movements m
        join stock_movement_costs c on c.movement_id = m.id
        join bins bn on bn.id = m.to_bin_id
       where m.entity_id = ${input.entityId} and m.moved_at < ${cut}
      union all
      select bn.warehouse_id, m.item_id, -m.qty, -(m.qty * c.unit_cost)
        from stock_movements m
        join stock_movement_costs c on c.movement_id = m.id
        join bins bn on bn.id = m.from_bin_id
       where m.entity_id = ${input.entityId} and m.moved_at < ${cut}
    )
    select x.hub as "hubId", w.code as "hubCode", w.name as "hubName", i.category,
           sum(x.q)::numeric(12, 3)::text as qty,
           round(greatest(sum(x.v), 0) / sum(x.q), 4)::numeric(14, 4)::text as "avgCost",
           round(greatest(sum(x.v), 0), 2)::numeric(14, 2)::text as value
      from x
      join warehouses w on w.id = x.hub
      join items i on i.id = x.item_id
     group by x.hub, w.code, w.name, i.category
    having sum(x.q) > 0
     order by w.code, i.category`)) as unknown as StockValuationDto['rows'];
  const totalPaise = rows.reduce((sum, r) => sum + BigInt(r.value.replace('.', '')), 0n);
  const total = `${(totalPaise / 100n).toString()}.${(totalPaise % 100n).toString().padStart(2, '0')}`;
  return StockValuationDto.parse({ entityId: input.entityId, asOf: input.asOf, rows, total });
}
