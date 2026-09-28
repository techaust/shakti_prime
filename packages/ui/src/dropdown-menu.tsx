'use client';

import * as Menu from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';

/** Menus such as the profile menu: a popover with the `shadow-1` elevation (DESIGN.md §4). */
export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Menu.Content>) {
  return (
    <Menu.Portal>
      <Menu.Content
        sideOffset={sideOffset}
        {...props}
        className={cn(
          'bg-surface text-text border-border-strong shadow-1 z-50 min-w-56 overflow-hidden rounded-lg border p-1',
          'data-[state=open]:animate-overlay-in',
          className,
        )}
      />
    </Menu.Portal>
  );
}

const itemClasses =
  'relative flex h-8 cursor-default items-center gap-2 rounded-sm px-2 outline-none select-none max-md:h-control-phone data-[disabled]:opacity-60 data-[highlighted]:bg-highlight data-[highlighted]:text-highlight-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-text-muted';

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof Menu.Item>) {
  return <Menu.Item {...props} className={cn(itemClasses, className)} />;
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem {...props} className={cn(itemClasses, 'pl-8', className)}>
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <span aria-hidden className="bg-accent block size-2 rounded-full" />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.RadioItem>
  );
}

/** A menu item that is ticked or not, such as a column in the column chooser. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.CheckboxItem>) {
  return (
    <Menu.CheckboxItem {...props} className={cn(itemClasses, 'pl-8', className)}>
      <span className="absolute left-2 inline-flex size-4 items-center justify-center">
        <Menu.ItemIndicator>
          <Check aria-hidden />
        </Menu.ItemIndicator>
      </span>
      {children}
    </Menu.CheckboxItem>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.Label>) {
  return <Menu.Label {...props} className={cn('text-text-muted px-2 py-1.5 text-xs', className)} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator {...props} className={cn('bg-border -mx-1 my-1 h-px', className)} />;
}
