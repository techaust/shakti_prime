'use client';

import { useEffect, useState, type ComponentType } from 'react';
import type { ScreenPop as ScreenPopType } from './screen-pop';

type ScreenPopProps = Parameters<typeof ScreenPopType>[0];

/**
 * The screen-pop's code (its asking and its card) is fetched once the page has hydrated, never in
 * its first load, and draws nothing until a call rings. It is loaded in an effect, not through
 * `next/dynamic` with `ssr: false`: that puts a Suspense boundary in the shell which shows its
 * fallback while hydrating, and React then holds back every later Suspense retry's commit (the
 * bell's, the page's own deferred parts) for its 300 ms fallback throttle, so a press in that time
 * on any of them was lost (the bell, a button that opens a dialog).
 */
export function DeferredScreenPop(props: ScreenPopProps) {
  const [ScreenPop, setScreenPop] = useState<ComponentType<ScreenPopProps> | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void import('./screen-pop').then((m) => {
      if (alive) setScreenPop(() => m.ScreenPop);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ScreenPop === undefined ? null : <ScreenPop {...props} />;
}
