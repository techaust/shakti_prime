import type { SortDirection } from '@shakti/contracts';
import type { GridSort } from '@shakti/ui';

/** Whether two grid sorts are the same order (both none, or one column in one direction). */
export function sameSort(a: GridSort | null, b: GridSort | null): boolean {
  if (a === null || b === null) return a === b;
  return a.columnId === b.columnId && a.direction === b.direction;
}

/**
 * The grid's sort as the list query takes it: the column when the query can sort by it (its
 * contract's whitelist), otherwise undefined, which reads the list in its own order. A saved view
 * that names a column the server cannot sort by is read that way too.
 */
export function toListSort<K extends string>(
  sort: GridSort | null,
  columns: readonly K[],
): { column: K; direction: SortDirection } | undefined {
  if (sort === null) return undefined;
  const column = columns.find((c) => c === sort.columnId);
  return column === undefined ? undefined : { column, direction: sort.direction };
}

/** The list input's `sort` field, left out when the list's own order is wanted. */
export function sortInput<K extends string>(
  sort: { column: K; direction: SortDirection } | undefined,
): { sort?: { column: K; direction: SortDirection } } {
  return sort === undefined ? {} : { sort };
}
