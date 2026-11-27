'use client';

import { CardList, cn } from '@shakti/ui';
import type { ReactNode } from 'react';

export interface RowsColumn {
  id: string;
  label: string;
  numeric?: boolean;
}

export interface RowsItem {
  key: string;
  /** The row's name: the first cell of the table, the card's title on a phone. */
  title: ReactNode;
  cells: Readonly<Record<string, ReactNode>>;
  actions?: ReactNode;
}

/**
 * Rows as a table on wider screens and a card each on a phone (docs/08-design-system.md §5), from
 * one list of columns, so the two never differ. An empty cell is left out of a card.
 */
export function RowsTable({
  caption,
  titleLabel,
  columns,
  rows,
  actionsLabel,
}: {
  caption: string;
  titleLabel: string;
  columns: readonly RowsColumn[];
  rows: readonly RowsItem[];
  actionsLabel: string;
}) {
  const withActions = rows.some((row) => row.actions !== undefined);
  return (
    <>
      <CardList
        label={caption}
        items={rows.map((row) => ({
          key: row.key,
          title: row.title,
          fields: columns
            .filter((column) => row.cells[column.id] !== undefined)
            .map((column) => ({
              id: column.id,
              label: column.label,
              value: row.cells[column.id],
              ...(column.numeric === true ? { numeric: true } : {}),
            })),
          ...(row.actions === undefined ? {} : { actions: row.actions }),
        }))}
      />
      {/* A wide table scrolls in a narrow window: the region takes focus, so the keyboard can scroll it. */}
      <div
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="border-border hidden overflow-x-auto rounded-lg border md:block"
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-2 text-text-muted text-left">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {titleLabel}
              </th>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  className={cn('px-3 py-2 font-medium', column.numeric === true && 'text-right')}
                >
                  {column.label}
                </th>
              ))}
              {withActions ? (
                <th scope="col" className="px-3 py-2 font-medium">
                  <span className="sr-only">{actionsLabel}</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-border border-t align-top">
                <th scope="row" className="px-3 py-2 text-left font-normal break-words">
                  {row.title}
                </th>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      'px-3 py-2',
                      column.numeric === true && 'text-right tabular-nums',
                    )}
                  >
                    {row.cells[column.id]}
                  </td>
                ))}
                {withActions ? (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-2">{row.actions}</div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
