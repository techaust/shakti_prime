'use client';

import type { ReactNode } from 'react';
import { Button } from './button';
import { cn } from './cn';
import { Skeleton } from './skeleton';

export interface DataGridColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Amounts and counts are right-aligned (DESIGN.md §6). */
  align?: 'start' | 'end';
  /** Tabular numerals, so digits line up down the column. */
  numeric?: boolean;
  /** On phones the card shows this column as its title instead of as a labelled line. */
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
  density?: 'comfortable' | 'compact';
  className?: string;
}

const alignClass = (align: DataGridColumn<unknown>['align']) =>
  align === 'end' ? 'text-right' : 'text-left';

/**
 * Data grid (DESIGN.md §5, §6): a table with a sticky header on wider screens and a list of cards
 * below `md`, so no page scrolls sideways on a phone. Paging is by "Load more", never numbered
 * pages, because the lists are keyset-paginated.
 */
export function DataGrid<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading = false,
  skeletonRows = 5,
  empty,
  loadMore,
  density = 'comfortable',
  className,
}: DataGridProps<T>) {
  const showSkeleton = loading && rows.length === 0;
  if (!showSkeleton && rows.length === 0) return <>{empty}</>;
  const rowHeight = density === 'compact' ? 'h-row-compact text-body-dense' : 'h-row';
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const placeholders = Array.from({ length: skeletonRows }, (_, i) => i);
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="border-border bg-surface hidden max-h-[calc(100dvh-12rem)] overflow-auto rounded-lg border md:block">
        <table className="w-full border-collapse" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  scope="col"
                  className={cn(
                    'bg-surface-2 text-text-muted border-border sticky top-0 z-10 h-9 border-b px-3 text-xs font-[510] whitespace-nowrap',
                    alignClass(c.align),
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {showSkeleton
              ? placeholders.map((i) => (
                  <tr key={i} className={cn('border-border border-b last:border-b-0', rowHeight)}>
                    {columns.map((c) => (
                      <td key={c.id} className="px-3">
                        <Skeleton className="h-4 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={cn(
                      'border-border hover:bg-surface-2 border-b last:border-b-0',
                      rowHeight,
                    )}
                  >
                    {columns.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          'px-3 align-middle',
                          alignClass(c.align),
                          c.numeric && 'font-[510] tabular-nums',
                          c.className,
                        )}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))}
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
          : rows.map((row) => (
              <li
                key={rowKey(row)}
                className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4"
              >
                {primary === undefined ? null : (
                  <div className="font-[510]">{primary.cell(row)}</div>
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
            ))}
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
