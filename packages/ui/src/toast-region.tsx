'use client';

import { useEffect, type CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';
import { TOAST_DURATION_MS } from './toast';
import { useIsPhone } from './use-is-phone';

export interface ToasterProps {
  theme?: 'light' | 'dark' | 'system';
  /** The name screen readers give the notification region, from the catalogue. */
  label: string;
  /** Called once the region is on the page and listening for toasts. */
  onReady?: () => void;
}

/**
 * Where toasts appear (DESIGN.md §6): bottom-right on desktop, at the top on phones, where the
 * keyboard and the thumb do not cover them. Colours come from the tokens; the region is announced
 * politely by screen readers. `toast.tsx` loads this module after the page (Sonner is not part of
 * any screen's first load).
 */
export function ToastRegion({ theme = 'system', label, onReady }: ToasterProps) {
  const phone = useIsPhone();
  useEffect(() => {
    onReady?.();
  }, [onReady]);
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
