import type * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as MenuPrimitive from '@radix-ui/react-dropdown-menu';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CommandPalette, type PaletteGroup } from './command-palette';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Sheet,
  SheetContent,
  SheetTitle,
} from './dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

/*
 * Dialogs, sheets, menus and the palette open in a portal, which renders only in a browser. Here
 * the portal renders its content in place, so the static markup shows what a browser would put in
 * the portal: the roles, names and relations screen readers use.
 */
const { inPlace } = vi.hoisted(() => ({
  inPlace: ({ children }: { children?: ReactNode }) => children,
}));
vi.mock('@radix-ui/react-dialog', async (original) => ({
  ...(await original<typeof DialogPrimitive>()),
  Portal: inPlace,
}));
vi.mock('@radix-ui/react-dropdown-menu', async (original) => ({
  ...(await original<typeof MenuPrimitive>()),
  Portal: inPlace,
}));

/** The value of `attribute` on the first element that carries `marker`. */
function attributeNear(html: string, marker: string, attribute: string): string | undefined {
  const tag = html.split('<').find((t) => t.includes(marker));
  return tag?.match(new RegExp(`${attribute}="([^"]*)"`))?.[1];
}

describe('Dialog', () => {
  const dialog = (open: boolean) =>
    renderToStaticMarkup(
      <Dialog open={open}>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>Delete this view</DialogTitle>
            <DialogDescription>The view goes for everyone who uses it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button">Keep it</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

  it('is a dialog over a dimmed page, with its title, description and a named close button', () => {
    const html = dialog(true);
    expect(html).toContain('role="dialog"');
    // Radix ties the dialog to these ids (aria-labelledby, aria-describedby) once they mount.
    expect(attributeNear(html, 'Delete this view', 'id')).toMatch(/^radix-/);
    expect(attributeNear(html, 'The view goes for everyone', 'id')).toMatch(/^radix-/);
    expect(html).toMatch(/<h2 [^>]*class="text-h3">Delete this view<\/h2>/);
    expect(html).toMatch(/<button[^>]*aria-label="Close"/);
    expect(html).toContain('bg-bg/70');
    expect(html).toContain('rounded-xl');
    expect(html).toContain('data-state="open"');
  });

  it('draws nothing while closed', () => {
    expect(dialog(false)).toBe('');
  });

  it('opens a side sheet from the side it is asked for', () => {
    const sheet = (side: 'left' | 'right') =>
      renderToStaticMarkup(
        <Sheet open>
          <SheetContent side={side} closeLabel="Close" aria-describedby={undefined}>
            <SheetTitle>Sessions</SheetTitle>
          </SheetContent>
        </Sheet>,
      );
    expect(sheet('right')).toContain('right-0 border-l');
    expect(sheet('left')).toContain('left-0 border-r');
    expect(sheet('left')).toContain('role="dialog"');
  });
});

describe('DropdownMenu', () => {
  const menu = renderToStaticMarkup(
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Columns</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked>Village</DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem checked={false}>Company</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value="compact">
          <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );

  it('is a menu the trigger opens, with the popover elevation', () => {
    expect(menu).toContain('role="menu"');
    expect(menu).toMatch(/<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="true"/);
    expect(menu).toContain('shadow-1');
  });

  it('marks ticked and chosen items for screen readers', () => {
    expect(menu).toMatch(/role="menuitemcheckbox"[^>]*aria-checked="true"[^>]*>.*?Village/);
    expect(menu).toMatch(/role="menuitemcheckbox"[^>]*aria-checked="false"[^>]*>.*?Company/);
    expect(menu).toMatch(/role="menuitemradio"[^>]*aria-checked="true"[^>]*>.*?Compact/);
    expect(menu).toMatch(/role="menuitemradio"[^>]*aria-checked="false"[^>]*>.*?Comfortable/);
    expect(menu).toMatch(/role="menuitem"[^>]*>Sign out/);
    expect(menu).toContain('role="separator"');
    expect(menu).toContain('>Columns</div>');
  });

  it('gives items the phone target size (DESIGN.md §1)', () => {
    expect(menu).toContain('max-md:h-control-phone');
  });
});

describe('CommandPalette', () => {
  const noop = () => undefined;
  const groups = (search: PaletteGroup['items'] = []): PaletteGroup[] => [
    {
      id: 'goto',
      heading: 'Go to',
      items: [
        { id: 'leads', label: 'Leads', onSelect: noop },
        { id: 'prices', label: 'Price lists', keywords: ['rates'], hint: 'G P', onSelect: noop },
      ],
    },
    { id: 'search', heading: 'Search', items: search, prefiltered: true },
    { id: 'actions', heading: 'Actions', items: [] },
  ];
  const palette = (list: PaletteGroup[], status?: string) =>
    renderToStaticMarkup(
      <CommandPalette
        open
        onOpenChange={noop}
        groups={list}
        title="Search and go"
        inputLabel="Type a name, phone or screen"
        emptyLabel="Nothing matches."
        query=""
        onQueryChange={noop}
        {...(status === undefined ? {} : { status })}
      />,
    );

  it('shows the groups in order with their headings, leaving out a group with nothing in it', () => {
    const html = palette(groups());
    expect(html.indexOf('Go to')).toBeGreaterThan(-1);
    expect(html.indexOf('Go to')).toBeLessThan(html.indexOf('Leads'));
    expect(html.indexOf('Leads')).toBeLessThan(html.indexOf('Price lists'));
    expect(html).not.toContain('>Search<');
    expect(html).not.toContain('>Actions<');
    expect(html).toContain('>G P</span>');
  });

  it('is a named dialog with a labelled search box and a polite status line', () => {
    const html = palette(groups(), '3 leads found');
    expect(html).toContain('role="dialog"');
    expect(html).toMatch(/<h2[^>]*class="sr-only"[^>]*>Search and go<\/h2>/);
    expect(html).toMatch(/<input[^>]*aria-label="Type a name, phone or screen"/);
    expect(html).toMatch(
      /<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">3 leads found<\/div>/,
    );
  });

  it('keeps the empty sentence ready, except while its own search has found something', () => {
    // cmdk shows the sentence only when the typed text matches nothing.
    expect(palette(groups())).toContain('Nothing matches.');
    const found = palette(groups([{ id: 'lead-1', label: 'Ramesh Patil', onSelect: noop }]));
    expect(found).not.toContain('Nothing matches.');
    expect(found).toContain('Ramesh Patil');
    expect(found.indexOf('Price lists')).toBeLessThan(found.indexOf('Ramesh Patil'));
  });

  /** Every element of a tree, depth first, without rendering it. */
  function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement<Record<string, unknown>>(node)) return [];
    return [node, ...elements(node.props.children as ReactNode)];
  }

  it('closes and runs an item when it is chosen, by Enter or by click, and loops the arrows', () => {
    const order: string[] = [];
    const tree = CommandPalette({
      open: true,
      onOpenChange: (open) => order.push(`open:${String(open)}`),
      groups: [
        {
          id: 'goto',
          heading: 'Go to',
          items: [{ id: 'leads', label: 'Leads', onSelect: () => order.push('leads') }],
        },
      ],
      title: 'Search and go',
      inputLabel: 'Type a name, phone or screen',
      emptyLabel: 'Nothing matches.',
      query: '',
      onQueryChange: noop,
    });
    const all = elements(tree);
    // cmdk moves the choice with the arrow keys, wrapping at either end, and Enter chooses it.
    expect(all.some((e) => e.props.loop === true)).toBe(true);
    const item = all.find((e) => e.props.value === 'goto:leads Leads');
    const choose = item?.props.onSelect as (() => void) | undefined;
    expect(choose).toBeTypeOf('function');
    choose?.();
    expect(order).toEqual(['open:false', 'leads']);
  });
});
