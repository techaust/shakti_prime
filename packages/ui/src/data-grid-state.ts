import type { ReactNode } from 'react';

export type SortDirection = 'asc' | 'desc';

/** The order a grid shows its rows in: one column, up or down. */
export interface GridSort {
  columnId: string;
  direction: SortDirection;
}

export type GridDensity = 'comfortable' | 'compact';

/** The parts of a column the state helpers read; `DataGridColumn` extends it. */
export interface GridColumnShape<T> {
  id: string;
  header: ReactNode;
  /** The column's name in the column chooser, when the header is not plain text. */
  label?: string;
  primary?: boolean;
  /** False keeps the column on screen: the chooser does not offer it. */
  hideable?: boolean;
  /** The header becomes a sort button. Implied by `sortValue`. */
  sortable?: boolean;
  /** What `sortRows` orders the loaded rows by; null sorts last in either direction. */
  sortValue?: (row: T) => string | number | null;
}

/** The column that titles a phone card and can never be hidden: the one marked, or the first. */
export function primaryColumn<C extends { primary?: boolean }>(
  columns: readonly C[],
): C | undefined {
  return columns.find((c) => c.primary === true) ?? columns[0];
}

/** The name the chooser shows: the label, or the header when it is plain text. */
export function columnLabel<T>(column: GridColumnShape<T>): string | undefined {
  if (column.label !== undefined) return column.label;
  return typeof column.header === 'string' ? column.header : undefined;
}

/**
 * Whether the chooser may hide a column: never the primary column, never one marked
 * `hideable: false`, and never one without a name to show in the menu (an actions column).
 */
export function canHideColumn<T>(
  column: GridColumnShape<T>,
  columns: readonly GridColumnShape<T>[],
): boolean {
  return (
    column !== primaryColumn(columns) &&
    column.hideable !== false &&
    columnLabel(column) !== undefined
  );
}

/** The columns on screen: every column except the hidden ones the chooser may hide. */
export function visibleColumns<C extends GridColumnShape<never>>(
  columns: readonly C[],
  hidden: readonly string[],
): C[] {
  const shown = columns.filter((c) => !hidden.includes(c.id) || !canHideColumn(c, columns));
  // At least one column always stays, whatever a saved view asks for.
  const first = columns[0];
  return shown.length === 0 && first !== undefined ? [first] : shown;
}

/**
 * The hidden list after the chooser ticks or unticks `id`. A column the chooser may not hide is
 * left as it is, and the last visible column is never hidden.
 */
export function toggleColumn<T>(
  columns: readonly GridColumnShape<T>[],
  hidden: readonly string[],
  id: string,
): string[] {
  const column = columns.find((c) => c.id === id);
  if (column === undefined || !canHideColumn(column, columns)) return [...hidden];
  if (hidden.includes(id)) return hidden.filter((h) => h !== id);
  if (visibleColumns(columns, hidden).length <= 1) return [...hidden];
  return [...hidden, id];
}

/** A sortable header's next order: up first, then down, then back to the list's own order. */
export function nextSort(current: GridSort | null | undefined, columnId: string): GridSort | null {
  if (current?.columnId !== columnId) return { columnId, direction: 'asc' };
  return current.direction === 'asc' ? { columnId, direction: 'desc' } : null;
}

export function isSortable<T>(column: GridColumnShape<T>): boolean {
  return column.sortable ?? column.sortValue !== undefined;
}

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

/**
 * The loaded rows in the grid's order, for a list whose query has no order of its own to offer:
 * a stable sort on the column's `sortValue`, names compared the way people read them ("Pump 2"
 * before "Pump 10"), empty values last in either direction. Without a sort, or for a column with
 * no `sortValue`, the rows keep the query's order.
 */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly GridColumnShape<T>[],
  sort: GridSort | null | undefined,
): T[] {
  if (sort == null) return [...rows];
  const value = columns.find((c) => c.id === sort.columnId)?.sortValue;
  if (value === undefined) return [...rows];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: value(row) }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) {
        if (a.key === b.key) return a.index - b.index;
        return a.key === null ? 1 : -1;
      }
      const order =
        typeof a.key === 'number' && typeof b.key === 'number'
          ? a.key - b.key
          : collator.compare(String(a.key), String(b.key));
      return order === 0 ? a.index - b.index : sign * order;
    })
    .map((entry) => entry.row);
}

/** The selection with one row ticked or unticked. */
export function toggleRowSelection(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Select all: ticks every loaded row, or unticks them all when every one is already ticked. */
export function toggleAllSelection(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): Set<string> {
  const next = new Set(selected);
  const all = keys.length > 0 && keys.every((k) => next.has(k));
  for (const key of keys) {
    if (all) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** How many of the loaded rows are ticked, for the header checkbox. */
export function selectionState(
  selected: ReadonlySet<string>,
  keys: readonly string[],
): 'none' | 'some' | 'all' {
  const count = keys.filter((k) => selected.has(k)).length;
  if (count === 0) return 'none';
  return count === keys.length ? 'all' : 'some';
}
