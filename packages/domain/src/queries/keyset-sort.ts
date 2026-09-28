import { DomainError, IdSchema, type SortDirection } from '@shakti/contracts';
import { and, isNull, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from './parse-input';

/**
 * One column a list can be sorted by: the expression, the Postgres type its text form is read
 * back as, and whether it can be empty.
 */
export interface SortKey {
  expr: SQLWrapper;
  type: 'text' | 'timestamptz' | 'numeric' | 'integer' | 'boolean';
  nullable: boolean;
}

/** A list's sortable columns by the key the contract names them. */
export type SortKeys<K extends string> = Readonly<Record<K, SortKey>>;

/** The order one page is read in, and the tie-breaking id column. */
export interface KeysetOrder {
  name: string;
  key: SortKey;
  direction: SortDirection;
  id: SQLWrapper;
}

/**
 * The position after the last row of a page: the sort it was read in (`s`), the row's sort value
 * as Postgres text, so no microsecond of a timestamp or digit of an amount is lost, and its id.
 */
const SortCursorSchema = z
  .object({ s: z.string().max(80), v: z.string().max(1000).nullable(), id: IdSchema })
  .strict();

/** The asked-for sort, or the list's own order when none is asked for. */
export function keysetOrder<K extends string>(
  keys: SortKeys<K>,
  id: SQLWrapper,
  sort: { column: K; direction: SortDirection } | undefined,
  fallback: { column: K; direction: SortDirection },
): KeysetOrder {
  const chosen = sort ?? fallback;
  return { name: chosen.column, key: keys[chosen.column], direction: chosen.direction, id };
}

const sortName = (order: KeysetOrder) => `${order.name}.${order.direction}`;

/** The sort value of a row as Postgres text, selected beside the row for its cursor. */
export function sortText(order: KeysetOrder): SQL<string | null> {
  return sql<string | null>`(${order.key.expr})::text`;
}

/**
 * The `order by` terms: the column, then the id in the same direction, so every row has one
 * place. An empty value comes last in either direction (as `sortRows` puts it); a column that
 * is never empty keeps Postgres's own null order, so its btree index serves both directions.
 */
export function orderTerms(order: KeysetOrder): SQL[] {
  const dir = order.direction === 'asc' ? sql`asc` : sql`desc`;
  const nulls = order.key.nullable ? sql` nulls last` : sql``;
  return [sql`${order.key.expr} ${dir}${nulls}`, sql`${order.id} ${dir}`];
}

/**
 * The rows after a cursor: the `(value, id)` pair compared as a tuple in the sort's direction,
 * then, for a column that can be empty, the empty ones that come last; after an empty value,
 * only empty ones with a later id. A cursor read in another sort is refused.
 */
export function afterCursor(order: KeysetOrder, cursor: string | undefined): SQL | undefined {
  if (cursor === undefined) return undefined;
  const after = decodeCursor(SortCursorSchema, cursor);
  if (after.s !== sortName(order)) {
    throw new DomainError('validation_failed', 'cursor belongs to another sort', { cursor });
  }
  const { expr, type, nullable } = order.key;
  const cmp = order.direction === 'asc' ? sql`>` : sql`<`;
  const idAfter = sql`${order.id} ${cmp} ${after.id}::uuid`;
  if (after.v === null) return and(isNull(expr), idAfter);
  const value = sql`${after.v}::${sql.raw(type)}`;
  const beyond = sql`(${expr}, ${order.id}) ${cmp} (${value}, ${after.id}::uuid)`;
  return nullable ? or(beyond, isNull(expr)) : beyond;
}

/** The cursor after `last`, or null when no page follows. */
export function nextCursor(
  order: KeysetOrder,
  more: boolean,
  last: { value: string | null; id: string } | undefined,
): string | null {
  if (!more || last === undefined) return null;
  return encodeCursor({ s: sortName(order), v: last.value, id: last.id });
}
