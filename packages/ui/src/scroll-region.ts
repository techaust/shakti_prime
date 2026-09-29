'use client';

import { useEffect, useState } from 'react';

/**
 * Whether an element scrolls (its content is wider or taller than its box), watched as its size
 * and content change. A region that scrolls takes focus so the keyboard can scroll it (WCAG
 * 2.1.1); one that does not, such as a board laid out in a column on a phone, is no tab stop.
 * Returns a callback ref for the element and the answer. Until the element is measured the answer
 * is yes, so the server's page and a page still loading keep the region reachable.
 */
export function useScrolls(): [(el: HTMLElement | null) => void, boolean] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [scrolls, setScrolls] = useState(true);
  useEffect(() => {
    if (element === null) return;
    const check = () => {
      setScrolls(
        element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight,
      );
    };
    check();
    const resized = new ResizeObserver(check);
    resized.observe(element);
    const changed = new MutationObserver(check);
    changed.observe(element, { childList: true, subtree: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [element]);
  return [setElement, scrolls];
}
