'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { cn } from './cn';
import { DialogOverlay } from './dialog';

export interface PaletteItem {
  id: string;
  label: string;
  /** Other words that find this item, such as a phone number or a company code. */
  keywords?: string[];
  hint?: ReactNode;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface PaletteGroup {
  /** `goto`, `search` or `actions` (DESIGN.md §6), or any other stable id. */
  id: string;
  heading: string;
  items: readonly PaletteItem[];
  /**
   * Items the caller has already matched to the typed text (a search on the server): shown as
   * they are, not filtered again by the palette.
   */
  prefiltered?: boolean;
}

/** True for ⌘K on a Mac and Ctrl+K elsewhere. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>) {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey);
}

/** Opens the palette on ⌘K or Ctrl+K anywhere on the page. */
export function usePaletteShortcut(toggle: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [toggle]);
}

/**
 * The ⌘K command palette (DESIGN.md §6): groups Go to, Search and Actions, keyboard first. Every
 * word comes from the caller's catalogue.
 */
export function CommandPalette({
  open,
  onOpenChange,
  groups,
  title,
  inputLabel,
  emptyLabel,
  query,
  onQueryChange,
  status,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly PaletteGroup[];
  /** The dialog's name for screen readers. */
  title: string;
  /** The search box's label and hint. */
  inputLabel: string;
  emptyLabel: ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  /**
   * A sentence read out when it changes, such as how many matches a search found (WCAG 4.1.3).
   * Screen readers only: the list itself shows the matches.
   */
  status?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'bg-surface text-text border-border-strong shadow-2 fixed top-[12vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border',
            'data-[state=open]:animate-dialog-in focus:outline-none max-md:top-4',
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <Command label={title} loop>
            <div className="border-border flex items-center gap-2 border-b px-3">
              <Search aria-hidden className="text-text-subtle size-4 shrink-0" />
              <Command.Input
                value={query}
                onValueChange={onQueryChange}
                aria-label={inputLabel}
                placeholder={inputLabel}
                className="placeholder:text-text-subtle h-12 w-full bg-transparent outline-none"
              />
            </div>
            <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
              {status ?? ''}
            </div>
            <Command.List className="max-h-[min(24rem,60dvh)] overflow-y-auto p-2">
              {/* cmdk leaves force-mounted items out of its count, so a search that found
                  something of its own must not show the empty message. */}
              {groups.some((g) => g.prefiltered === true && g.items.length > 0) ? null : (
                <Command.Empty className="text-text-muted px-3 py-6 text-center">
                  {emptyLabel}
                </Command.Empty>
              )}
              {groups
                .filter((g) => g.items.length > 0)
                .map((group) => (
                  <Command.Group
                    key={group.id}
                    heading={group.heading}
                    forceMount={group.prefiltered === true}
                    className="[&_[cmdk-group-heading]]:text-text-subtle [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-[510]"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${group.id}:${item.id} ${item.label}`}
                        // A match found by the caller's own search may not read like the typed
                        // text (a phone's last digits find a name), so it is always shown and
                        // carries the text as a keyword for cmdk's ranking.
                        keywords={
                          group.prefiltered === true
                            ? [...(item.keywords ?? []), query]
                            : (item.keywords ?? [])
                        }
                        forceMount={group.prefiltered === true}
                        onSelect={() => {
                          onOpenChange(false);
                          item.onSelect();
                        }}
                        className="data-[selected=true]:bg-highlight flex h-9 cursor-default items-center gap-2 rounded-md px-2 select-none max-md:h-control-phone [&_svg]:text-text-muted [&_svg]:size-4"
                      >
                        {item.icon ?? null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint === undefined ? null : (
                          <span className="text-text-subtle text-xs">{item.hint}</span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
