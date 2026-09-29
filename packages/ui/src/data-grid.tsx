'use client';

import { ChevronDown, ChevronUp, Columns3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { useScrolls } from './scroll-region';
import {
  canHideColumn,
  columnLabel,
  isSortable,
  nextSort,
  primaryColumn,
  selectionState,
  toggleAllSelection,
  toggleColumn,
  toggleRowSelection,
  visibleColumns,
  type GridColumnShape,
  type GridDensity,
  type GridSort,
} from './data-grid-state';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Skeleton } from './skeleton';

export interface DataGridColumn<T> extends GridColumnShape<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Amounts and counts are right-aligned (DESIGN.md §6). */
  align?: 'start' | 'end';
  /** Tabular numerals, so digits line up down the column. */
  numeric?: boolean;
  /**
   * On phones the card shows this column as its title instead of as a labelled line. The column
   * chooser never hides it, so a grid always keeps at least one column.
   */
  primary?: boolean;
  /** Left out of the phone card, for a column that repeats the title or an action. */
  hideOnPhone?: boolean;
  className?: string;
}

export interface LoadMore {
  label: ReactNode;
  onLoadMore: () => void;
  pending: boolean;
}

/** The column chooser: a menu of checkboxes, one per column the person may hide. */
export interface ColumnChooser {
  /** The button's words, such as "Columns". */
  label: string;
  hidden: readonly string[];
  onHiddenChange: (hidden: string[]) => void;
}

/** Row height in the column chooser's menu (DESIGN.md §5: 40 or 32 px rows). */
export interface DensityChoice {
  label: string;
  comfortable: string;
  compact: string;
  onChange: (density: GridDensity) => void;
}

/**
 * Row selection, for a list with a bulk action: a checkbox on each row, one in the header that
 * ticks every loaded row, and a line that says how many are ticked. The caller holds the ticked
 * row keys and acts on them.
 */
export interface DataGridSelection<T> {
  selected: ReadonlySet<string>;
  onSelectedChange: (selected: Set<string>) => void;
  /** The header checkbox's name, such as "Select all loaded leads". */
  selectAllLabel: string;
  /** Each row checkbox's name, such as "Select Ramesh Patil". */
  selectRowLabel: (row: T) => string;
  /** The "{count} selected" line. */
  summary: (count: number) => ReactNode;
}

export interface DataGridProps<T> {
  /** What the table lists, for screen readers. */
  caption: string;
  columns: readonly DataGridColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /** The first page is on its way: skeleton rows instead of content (never a spinner). */
  loading?: boolean;
  skeletonRows?: number;
  /** Shown when nothing is loading and there are no rows; an `EmptyState`. */
  empty: ReactNode;
  /** Keyset paging: the button appears while another page exists. */
  loadMore?: LoadMore | undefined;
  density?: GridDensity;
  /** Offers comfortable and compact rows in the column chooser's menu. */
  densityChoice?: DensityChoice | undefined;
  /**
   * The order shown by the sortable headers (a single chevron, `aria-sort`). The grid does not
   * reorder rows itself: the caller gives them in order. A keyset-paged list asks its query for
   * the order when the sort changes and reads the first page again, so the order covers every
   * row and "Load more" continues it; only its columns marked `sortable` that the query can
   * sort by show a sort button. A grid that holds all its rows in memory sorts them with
   * `sortRows` and each column's `sortValue`.
   */
  sort?: GridSort | null | undefined;
  onSortChange?: ((sort: GridSort | null) => void) | undefined;
  columnChooser?: ColumnChooser | undefined;
  /** Off unless given: only a list with a bulk action lets rows be ticked. */
  selectable?: DataGridSelection<T> | undefined;
  /** Controls shown at the start of the toolbar, such as the Views menu. */
  toolbar?: ReactNode;
  className?: string;
}

const alignClass = (align: DataGridColumn<unknown>['align']) =>
  align === 'end' ? 'text-right' : 'text-left';

const checkboxClass = 'accent-accent size-4 shrink-0 cursor-pointer align-middle';

function ariaSort(
  sortable: boolean,
  sort: GridSort | null | undefined,
  id: string,
): 'ascending' | 'descending' | 'none' | undefined {
  if (!sortable) return undefined;
  if (sort?.columnId !== id) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

/** A sortable header: the header's own words and one chevron, up or down, on the sorted column. */
function SortButton<T>({
  column,
  sort,
  onSortChange,
}: {
  column: DataGridColumn<T>;
  sort: GridSort | null | undefined;
  onSortChange: (sort: GridSort | null) => void;
}) {
  const active = sort?.columnId === column.id;
  const Chevron = active && sort.direction === 'desc' ? ChevronDown : ChevronUp;
  return (
    <button
      type="button"
      onClick={() => {
        onSortChange(nextSort(sort, column.id));
      }}
      className={cn(
        'group hover:text-text inline-flex h-full items-center gap-1 rounded-sm font-medium',
        column.align === 'end' && 'flex-row-reverse',
        active && 'text-text',
      )}
    >
      {column.header}
      <Chevron
        aria-hidden
        className={cn(
          'size-3.5 shrink-0 transition-opacity',
          active
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60',
        )}
      />
    </button>
  );
}

function ChooserMenu<T>({
  columns,
  chooser,
  density,
  densityChoice,
}: {
  columns: readonly DataGridColumn<T>[];
  chooser: ColumnChooser | undefined;
  density: GridDensity;
  densityChoice: DensityChoice | undefined;
}) {
  const label = chooser?.label ?? densityChoice?.label ?? '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm">
          <Columns3 aria-hidden />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {chooser === undefined ? null : (
          <>
            <DropdownMenuLabel>{chooser.label}</DropdownMenuLabel>
            {columns.map((c) => {
              const name = columnLabel(c);
              if (name === undefined) return null;
              const hideable = canHideColumn(c, columns);
              return (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!hideable || !chooser.hidden.includes(c.id)}
                  disabled={!hideable}
                  // Stays open, so several columns can be changed in one go.
                  onSelect={(e) => {
                    e.preventDefault();
                  }}
                  onCheckedChange={() => {
                    chooser.onHiddenChange(toggleColumn(columns, chooser.hidden, c.id));
                  }}
                >
                  {name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        )}
        {densityChoice === undefined ? null : (
          <>
            {chooser === undefined ? null : <DropdownMenuSeparator />}
            <DropdownMenuLabel>{densityChoice.label}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(value) => {
                densityChoice.onChange(value === 'compact' ? 'compact' : 'comfortable');
              }}
            >
              <DropdownMenuRadioItem value="comfortable">
                {densityChoice.comfortable}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">{densityChoice.compact}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Data grid (DESIGN.md §5, §6): a table with a sticky header on wider screens and a list of cards
 * below `md`, so no page scrolls sideways on a phone. Paging is by "Load more", never numbered
 * pages, because the lists are keyset-paginated. Optional parts, each keyboard operable: sortable
 * headers, a column chooser with the row height, row selection, and a toolbar slot for saved views.
 */
export function DataGrid<T>({
  caption,
  columns: allColumns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  loadMore,
  density = 'comfortable',
  densityChoice,
  sort,
  onSortChange,
  columnChooser,
  selectable,
  toolbar,
  className,
}: DataGridProps<T>) {
  const [tableBox, tableScrolls] = useScrolls<HTMLDivElement>();
  const showSkeleton = loading && rows.length === 0;
  if (!showSkeleton && rows.length === 0) return <>{empty}</>;
  const columns = visibleColumns(allColumns, columnChooser?.hidden ?? []);
  const rowHeight = density === 'compact' ? 'h-row-compact text-body-dense' : 'h-row';
  const primary = primaryColumn(columns);
  const placeholders = Array.from({ length: skeletonRows }, (_, i) => i);
  const keys = rows.map(rowKey);
  const ticked = selectable === undefined ? 'none' : selectionState(selectable.selected, keys);
  const tickedCount =
    selectable === undefined ? 0 : keys.filter((k) => selectable.selected.has(k)).length;

  const selectAll =
    selectable === undefined ? null : (
      <input
        type="checkbox"
        className={checkboxClass}
        aria-label={selectable.selectAllLabel}
        checked={ticked === 'all'}
        ref={(el) => {
          if (el !== null) el.indeterminate = ticked === 'some';
        }}
        onChange={() => {
          selectable.onSelectedChange(toggleAllSelection(selectable.selected, keys));
        }}
      />
    );
  const selectRow = (row: T, key: string) =>
    selectable === undefined ? null : (
      <input
        type="checkbox"
        className={checkboxClass}
        aria-label={selectable.selectRowLabel(row)}
        checked={selectable.selected.has(key)}
        onChange={() => {
          selectable.onSelectedChange(toggleRowSelection(selectable.selected, key));
        }}
      />
    );

  const hasChooser = columnChooser !== undefined || densityChoice !== undefined;
  const hasToolbar = toolbar !== undefined || hasChooser || selectable !== undefined;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {hasToolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          {selectable === undefined ? null : (
            <label className="inline-flex items-center gap-2 text-sm md:hidden">
              {selectAll}
              {selectable.selectAllLabel}
            </label>
          )}
          {selectable === undefined ? null : (
            <p className="text-text-muted text-sm tabular-nums" aria-live="polite">
              {tickedCount > 0 ? selectable.summary(tickedCount) : null}
            </p>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            {hasChooser ? (
              <ChooserMenu
                columns={allColumns}
                chooser={columnChooser}
                density={density}
                densityChoice={densityChoice}
              />
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={tableBox}
        // A table that scrolls takes focus, so the keyboard can scroll it (WCAG 2.1.1).
        role="region"
        aria-label={caption}
        tabIndex={tableScrolls ? 0 : undefined}
        className="border-border bg-surface focus-visible:outline-focus hidden max-h-[calc(100dvh-12rem)] overflow-auto rounded-lg border focus-visible:outline-2 focus-visible:outline-offset-2 md:block"
      >
        <table className="w-full border-collapse" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable === undefined ? null : (
                <th
                  scope="col"
                  className="bg-surface-2 border-border sticky top-0 z-10 h-9 w-10 border-b px-3 text-left"
                >
                  {selectAll}
                </th>
              )}
              {columns.map((c) => {
                const sortable = onSortChange !== undefined && isSortable(c);
                return (
                  <th
                    key={c.id}
                    scope="col"
                    aria-sort={ariaSort(sortable, sort, c.id)}
                    className={cn(
                      'bg-surface-2 text-text-muted border-border sticky top-0 z-10 h-9 border-b px-3 text-xs font-medium whitespace-nowrap',
                      alignClass(c.align),
                      c.className,
                    )}
                  >
                    {sortable ? (
                      <SortButton column={c} sort={sort} onSortChange={onSortChange} />
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {showSkeleton
              ? placeholders.map((i) => (
                  <tr key={i} className={cn('border-border border-b last:border-b-0', rowHeight)}>
                    {selectable === undefined ? null : <td className="px-3" />}
                    {columns.map((c) => (
                      <td key={c.id} className="px-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => {
                  const key = rowKey(row);
                  const isTicked = selectable?.selected.has(key) === true;
                  return (
                    <tr
                      key={key}
                      data-selected={isTicked || undefined}
                      className={cn(
                        'border-border hover:bg-surface-2 border-b last:border-b-0',
                        isTicked && 'bg-accent-soft',
                        rowHeight,
                      )}
                    >
                      {selectable === undefined ? null : (
                        <td className="w-10 px-3 align-middle">{selectRow(row, key)}</td>
                      )}
                      {columns.map((c) => (
                        <td
                          key={c.id}
                          className={cn(
                            'px-3 align-middle',
                            alignClass(c.align),
                            c.numeric && 'font-medium tabular-nums',
                            c.className,
                          )}
                        >
                          {c.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>

      <ul
        className="flex flex-col gap-2 md:hidden"
        aria-label={caption}
        aria-busy={loading || undefined}
      >
        {showSkeleton
          ? placeholders.map((i) => (
              <li
                key={i}
                className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4"
              >
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </li>
            ))
          : rows.map((row) => {
              const key = rowKey(row);
              return (
                <li
                  key={key}
                  className={cn(
                    'border-border bg-surface flex flex-col gap-2 rounded-lg border p-4',
                    selectable?.selected.has(key) === true && 'bg-accent-soft',
                  )}
                >
                  {primary === undefined && selectable === undefined ? null : (
                    <div className="flex items-start gap-3">
                      {selectRow(row, key)}
                      {primary === undefined ? null : (
                        <div className="min-w-0 font-medium">{primary.cell(row)}</div>
                      )}
                    </div>
                  )}
                  <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5">
                    {columns
                      .filter((c) => c !== primary && c.hideOnPhone !== true)
                      .map((c) => (
                        <div key={c.id} className="contents">
                          <dt className="text-text-muted text-sm">{c.header}</dt>
                          <dd className={cn('min-w-0 break-words', c.numeric && 'tabular-nums')}>
                            {c.cell(row)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                </li>
              );
            })}
      </ul>

      {loadMore === undefined || showSkeleton ? null : (
        <Button
          variant="secondary"
          className="self-center"
          pending={loadMore.pending}
          onClick={loadMore.onLoadMore}
        >
          {loadMore.label}
        </Button>
      )}
    </div>
  );
}
