'use client';

import { useSyncExternalStore, type CSSProperties } from 'react';
import { Toaster as Sonner, toast } from 'sonner';

/** Toasts stay four seconds (DESIGN.md §6). */
export const TOAST_DURATION_MS = 4000;

const PHONE_QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

/** True below the `md` breakpoint; false while rendering on the server. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * Where toasts appear (DESIGN.md §6): bottom-right on desktop, at the top on phones, where the
 * keyboard and the thumb do not cover them. Colours come from the tokens; the region is announced
 * politely by screen readers.
 */
export function Toaster({
  theme = 'system',
  label,
}: {
  theme?: 'light' | 'dark' | 'system';
  /** The name screen readers give the notification region, from the catalogue. */
  label: string;
}) {
  const phone = useIsPhone();
  return (
    <Sonner
      theme={theme}
      position={phone ? 'top-center' : 'bottom-right'}
      duration={TOAST_DURATION_MS}
      richColors
      containerAriaLabel={label}
      style={
        {
          '--normal-bg': 'var(--surface)',
          '--normal-text': 'var(--text)',
          '--normal-border': 'var(--border-strong)',
          '--success-bg': 'var(--success-soft)',
          '--success-text': 'var(--success)',
          '--success-border': 'var(--success)',
          '--error-bg': 'var(--danger-soft)',
          '--error-text': 'var(--danger)',
          '--error-border': 'var(--danger)',
          '--border-radius': 'var(--radius-lg)',
          fontFamily: 'var(--font-family)',
        } as CSSProperties
      }
    />
  );
}

export { toast };
