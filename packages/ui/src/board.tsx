'use client';

import { Children, useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { Avatar } from './avatar';
import { Button } from './button';
import { cn } from './cn';
import { Skeleton } from './skeleton';

/** The six lead-stage colours (DESIGN.md §2.4), for a column's 3 px top bar. */
export type BoardStageTone = 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';

/** Whole class names, so the style build sees every one of them. */
const STAGE_BAR: Record<BoardStageTone, string> = {
  new: 'bg-stage-new',
  contacted: 'bg-stage-contacted',
  qualified: 'bg-stage-qualified',
  quoted: 'bg-stage-quoted',
  won: 'bg-stage-won',
  lost: 'bg-stage-lost',
};

/** How the SLA dot reads (DESIGN.md §2.4): on time, due soon, or late. */
export type BoardSlaTone = 'ok' | 'warn' | 'breach';

const SLA_DOT: Record<BoardSlaTone, string> = {
  ok: 'bg-sla-ok',
  warn: 'bg-sla-warn',
  breach: 'bg-sla-breach',
};

export interface BoardColumnProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** The stage's name. */
  title: ReactNode;
  /** The stage's colour, on the column's top bar. */
  tone: BoardStageTone;
  /** How many cards the stage holds, in words, such as "12 leads". */
  count: ReactNode;
  /** A line under the heading, such as "Showing the newest 100 of 240 leads". */
  note?: ReactNode;
  /** Shown in place of the cards when the stage holds none. */
  emptyLabel: ReactNode;
  /** Under `md` a board shows one column at a time: the others are hidden there. */
  hiddenOnPhone?: boolean;
  /** Ringed while a dragged card is over it. */
  highlighted?: boolean;
  /** The heading level that fits the page: `h2` on a board screen. */
  headingLevel?: 'h2' | 'h3' | 'h4';
  /** The cards, each a `BoardCard`. */
  children?: ReactNode;
  /** The column's "Load more", while the stage holds more cards than it shows. */
  loadMore?: BoardLoadMore | undefined;
}

/** A column's "Load more" (DESIGN.md §6: keyset pages, never numbered ones). */
export interface BoardLoadMore {
  /** The button's words, such as "Load more". */
  label: ReactNode;
  /** The button's full name for screen readers, naming the stage; it starts with `label`. */
  accessibleLabel?: string | undefined;
  /** How many cards show out of how many, such as "Showing the newest 100 of 240 leads". */
  status: ReactNode;
  onLoadMore: () => void;
  /** While the next page is on its way: the button waits and skeleton cards hold its place. */
  pending: boolean;
}

/**
 * A kanban column (DESIGN.md §6, Kanban board): the stage colour on a 3 px top bar, the stage's
 * name and count, then its cards, or a sentence when it holds none, and a "Load more" at the foot
 * while the stage holds more cards than it shows. Drop handlers and other
 * section attributes pass through, so the screen decides what a drop means. Every word comes
 * from the caller's catalogue.
 */
export function BoardColumn({
  title,
  tone,
  count,
  note,
  emptyLabel,
  hiddenOnPhone = false,
  highlighted = false,
  headingLevel: Heading = 'h2',
  className,
  children,
  loadMore,
  ...props
}: BoardColumnProps) {
  const headingId = useId();
  const statusId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // After the last page the button goes; focus moves to the column's heading, not the page top.
  const pressed = useRef(false);
  const more = loadMore !== undefined;
  useEffect(() => {
    if (more || !pressed.current) return;
    pressed.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) heading.current?.focus();
  }, [more]);
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'bg-surface-2 border-border flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border max-md:w-full',
        hiddenOnPhone && 'max-md:hidden',
        highlighted && 'ring-focus ring-2',
        className,
      )}
      {...props}
    >
      <div aria-hidden className={cn('h-[3px]', STAGE_BAR[tone])} />
      <header className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
        <Heading id={headingId} ref={heading} tabIndex={-1} className="text-sm font-semibold">
          {title}
        </Heading>
        <span className="text-text-muted text-xs tabular-nums">{count}</span>
      </header>
      {note === undefined ? null : <p className="text-text-subtle px-3 pb-1 text-xs">{note}</p>}
      {Children.count(children) === 0 ? (
        <p className="text-text-subtle px-3 pt-1 pb-3 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2 p-2">
          {children}
          {loadMore?.pending === true ? (
            <>
              <li aria-hidden>
                <Skeleton className="h-row" />
              </li>
              <li aria-hidden>
                <Skeleton className="h-row" />
              </li>
            </>
          ) : null}
        </ul>
      )}
      {loadMore === undefined ? null : (
        <footer className="flex flex-col gap-2 px-2 pb-2">
          <p id={statusId} role="status" className="text-text-subtle px-1 text-xs tabular-nums">
            {loadMore.status}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            aria-label={loadMore.accessibleLabel}
            aria-describedby={statusId}
            pending={loadMore.pending}
            onClick={() => {
              pressed.current = true;
              loadMore.onLoadMore();
            }}
          >
            {loadMore.label}
          </Button>
        </footer>
      )}
    </section>
  );
}

export interface BoardCardProps {
  /** The customer's name. */
  title: ReactNode;
  /** The line under the name, such as the village. */
  subtitle: ReactNode;
  /** The card's menu button, top right. */
  menu?: ReactNode;
  /** A status badge under the subtitle, when the board shows more than one status. */
  badge?: ReactNode;
  /** A line of facts under the subtitle, such as the sized kW or HP and the time in the stage. */
  detail?: ReactNode;
  /** How long the lead has been in its status, such as "Open for 3 days". */
  age: ReactNode;
  /** Who works on the lead. */
  owner: ReactNode;
  /** The owner's full name, for the avatar beside `owner`; none while nobody owns the lead. */
  ownerName?: string | undefined;
  /** The SLA dot and what it means, read out by screen readers; none while no rule applies. */
  sla?: { tone: BoardSlaTone; label: string } | undefined;
  /** When set, the card can be dragged to another column and carries this id. */
  dragId?: string | undefined;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/**
 * A kanban card (DESIGN.md §6): name, village, the size in kW or HP and the time in the stage,
 * age, owner with their avatar, and the SLA dot. It is dragged only when the screen passes
 * `dragId`; the menu, badge and facts come from the screen.
 */
export function BoardCard({
  title,
  subtitle,
  menu,
  badge,
  detail,
  age,
  owner,
  ownerName,
  sla,
  dragId,
  onDragStart,
  onDragEnd,
}: BoardCardProps) {
  const draggable = dragId !== undefined;
  return (
    <li
      draggable={draggable}
      onDragStart={(e) => {
        if (dragId === undefined) return;
        e.dataTransfer.setData('text/plain', dragId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'bg-surface border-border flex flex-col gap-1 rounded-lg border p-3',
        draggable && 'cursor-grab active:cursor-grabbing',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-medium break-words">{title}</p>
        {menu}
      </div>
      <p className="text-text-muted text-sm break-words">{subtitle}</p>
      {detail === undefined ? null : (
        <p className="text-text-muted text-xs break-words tabular-nums">{detail}</p>
      )}
      {badge}
      <div className="text-text-subtle flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
        <span className="tabular-nums">{age}</span>
        <span className="flex min-w-0 items-center gap-1.5">
          {sla === undefined ? null : (
            <span
              role="img"
              aria-label={sla.label}
              className={cn('size-2 shrink-0 rounded-full', SLA_DOT[sla.tone])}
            />
          )}
          {ownerName === undefined ? null : <Avatar name={ownerName} />}
          <span className="break-words">{owner}</span>
        </span>
      </div>
    </li>
  );
}
