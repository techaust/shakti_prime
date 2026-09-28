'use client';

import { useEffect } from 'react';

// The palette's keyboard shortcut, apart from the palette itself: the shell listens for it on
// every screen, while the palette (cmdk and its dialog) loads only when it is first opened.

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
