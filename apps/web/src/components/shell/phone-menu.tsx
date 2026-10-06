'use client';

import { Sheet, SheetContent, SheetTitle } from '@shakti/ui';
import type { ReactNode } from 'react';

/**
 * The phone menu's sheet (docs/08-design-system.md §5), loaded by the shell when the menu is first opened, so
 * the dialog code is not part of a screen's first load. The shell draws the button and the menu.
 */
export function PhoneMenu({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's name for screen readers. */
  title: string;
  closeLabel: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" closeLabel={closeLabel} className="w-72 gap-2 p-2">
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
