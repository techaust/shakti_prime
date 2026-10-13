import type { ReactNode } from 'react';
import { cn } from './cn';

/** One labelled line of a card: a column's header and this row's value in it. */
export interface CardField {
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** Tabular numerals, so digits line up from card to card. */
  numeric?: boolean;
}

/** One row of a table as a card: its title (the row's own name), its lines and any actions. */
export interface CardListItem {
  key: string;
  title: ReactNode;
  fields: readonly CardField[];
  actions?: ReactNode;
}

/**
 * A table's rows as cards below `md` (docs/08-design-system.md §5: "tables become card lists"), drawn
 * as `DataGrid` draws its phone cards: the row's title, then each column as a label and its value.
 * The caller keeps its table for wider screens inside `hidden md:block` and renders this beside it,
 * so every amount stays on screen without a sideways scroll. Plain markup, so a server component
 * can render it too.
 */
export function CardList({
  label,
  items,
  className,
}: {
  /** What the list holds, for screen readers: the table's caption. */
  label: string;
  items: readonly CardListItem[];
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-col gap-2 md:hidden', className)} aria-label={label}>
      {items.map((item) => (
        <li
          key={item.key}
          className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-4"
        >
          <div className="min-w-0 font-medium break-words">{item.title}</div>
          <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5">
            {item.fields.map((field) => (
              <div key={field.id} className="contents">
                <dt className="text-text-muted text-sm">{field.label}</dt>
                <dd className={cn('min-w-0 break-words', field.numeric === true && 'tabular-nums')}>
                  {field.value}
                </dd>
              </div>
            ))}
          </dl>
          {item.actions === undefined ? null : (
            <div className="flex flex-wrap gap-2">{item.actions}</div>
          )}
        </li>
      ))}
    </ul>
  );
}
