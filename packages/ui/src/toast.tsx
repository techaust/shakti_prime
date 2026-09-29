'use client';

import { useEffect, useState, type ComponentType } from 'react';
import type { ExternalToast, toast as sonnerToast } from 'sonner';
import type { ToasterProps } from './toast-region';

/**
 * Toasts without Sonner in any screen's first load. `Toaster` draws nothing at first and fetches
 * the region (`toast-region.tsx`, Sonner) once the page is idle, well before anyone can finish a
 * form; `toast` asks for it at once if a toast comes first, and every toast waits until the
 * region is listening, so none is lost.
 */

/** Toasts stay four seconds (DESIGN.md §6). */
export const TOAST_DURATION_MS = 4000;

type SonnerToast = typeof sonnerToast;
type Message = Parameters<SonnerToast>[0];

let requestRegion: (() => void) | undefined;
let markReady: () => void = () => undefined;
let ready: Promise<void> = Promise.resolve();
let listening = false;

function waitForRegion(): void {
  ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
}
waitForRegion();

/** The region is on the page and listening: toasts waiting for it show now. */
export function regionMounted(): void {
  listening = true;
  markReady();
}

/**
 * The region left the page: later toasts wait for the next one. Toasts already waiting keep
 * waiting on the same promise, so none is lost when the region goes before it ever mounted.
 */
export function regionUnmounted(): void {
  if (!listening) return;
  listening = false;
  waitForRegion();
}

function withSonner(show: (t: SonnerToast) => void): void {
  requestRegion?.();
  void Promise.all([import('sonner'), ready]).then(([m]) => {
    show(m.toast);
  });
}

/** Shows a toast (Sonner's API for the calls the app makes: plain, success and error). */
export const toast = Object.assign(
  (message: Message, options?: ExternalToast) => {
    withSonner((t) => t(message, options));
  },
  {
    success: (message: Message, options?: ExternalToast) => {
      withSonner((t) => t.success(message, options));
    },
    error: (message: Message, options?: ExternalToast) => {
      withSonner((t) => t.error(message, options));
    },
  },
);

const loadRegion = () => import('./toast-region').then((m) => m.ToastRegion);

/** How long a page waits for the fetch when the browser cannot say it is idle. */
const IDLE_FALLBACK_MS = 1_500;

export function Toaster(props: Omit<ToasterProps, 'onReady' | 'onGone'>) {
  const [Region, setRegion] = useState<ComponentType<ToasterProps> | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadRegion().then((component) => {
        if (!cancelled) setRegion(() => component);
      });
    };
    requestRegion = load;
    const idleSupported = typeof window.requestIdleCallback === 'function';
    const handle = idleSupported
      ? window.requestIdleCallback(load, { timeout: IDLE_FALLBACK_MS })
      : window.setTimeout(load, IDLE_FALLBACK_MS);
    return () => {
      cancelled = true;
      requestRegion = undefined;
      if (idleSupported) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, []);
  return Region === undefined ? null : (
    <Region {...props} onReady={regionMounted} onGone={regionUnmounted} />
  );
}
