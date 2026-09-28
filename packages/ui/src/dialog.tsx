'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';
import { returnFocusHandler, type ReturnFocusTo } from './return-focus';

/** Dialogs for confirmations and short forms (DESIGN.md §6); side sheets for records. */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      {...props}
      className={cn(
        'bg-bg/70 data-[state=open]:animate-overlay-in fixed inset-0 z-50 backdrop-blur-[2px]',
        className,
      )}
    />
  );
}

/** The close button's accessible name comes from the caller's catalogue. */
function CloseButton({ label }: { label: string }) {
  return (
    <DialogPrimitive.Close
      aria-label={label}
      className="text-text-muted hover:bg-highlight hover:text-text absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md max-md:size-control-phone"
    >
      <X aria-hidden className="size-4" />
    </DialogPrimitive.Close>
  );
}

/**
 * Where focus goes when the dialog closes, best first (`return-focus.ts`). A dialog opened from a
 * menu item needs it: without it focus falls to the page, because the item has gone by then.
 */
interface ReturnFocusProps {
  returnFocusTo?: ReturnFocusTo | undefined;
}

export function DialogContent({
  className,
  children,
  closeLabel,
  returnFocusTo,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string } & ReturnFocusProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        {...props}
        onCloseAutoFocus={returnFocusHandler(returnFocusTo, onCloseAutoFocus)}
        className={cn(
          'bg-surface text-text border-border shadow-2 fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-xl border p-6',
          'data-[state=open]:animate-dialog-in max-h-[calc(100dvh-2rem)] overflow-y-auto focus:outline-none',
          className,
        )}
      >
        {children}
        <CloseButton label={closeLabel} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('flex flex-col gap-1.5 pr-8', className)} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title {...props} className={cn('text-h3', className)} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description {...props} className={cn('text-text-muted', className)} />;
}

/** A side sheet (DESIGN.md §6); on phones the app's sidebar opens as one from the left. */
export function SheetContent({
  side = 'right',
  className,
  children,
  closeLabel,
  returnFocusTo,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'left' | 'right';
  closeLabel: string;
  children: ReactNode;
} & ReturnFocusProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        {...props}
        onCloseAutoFocus={returnFocusHandler(returnFocusTo, onCloseAutoFocus)}
        className={cn(
          'bg-surface text-text border-border shadow-2 fixed inset-y-0 z-50 flex w-[min(24rem,calc(100%-3rem))] flex-col gap-4 overflow-y-auto p-6 focus:outline-none',
          side === 'right'
            ? 'data-[state=open]:animate-sheet-in-right right-0 border-l'
            : 'data-[state=open]:animate-sheet-in-left left-0 border-r',
          className,
        )}
      >
        {children}
        <CloseButton label={closeLabel} />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
export const SheetHeader = DialogHeader;
