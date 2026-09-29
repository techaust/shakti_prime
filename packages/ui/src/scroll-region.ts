'use client';

import { useEffect, useState } from 'react';

/**
 * Whether an element scrolls (its content is wider or taller than its box), watched as its size
 * and content change. A region that scrolls takes focus so the keyboard can scroll it (WCAG
 * 2.1.1); one that does not, such as a board laid out in a column on a phone, is no tab stop.
 * Returns a callback ref for the element and the answer, false until the element is measured.
 */
export function useScrolls(): [(el: HTMLElement | null) => void, boolean] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    if (element === null) return;
    const check = () => {
      setScrolls(
        element.scrollWidth > element.clientWidth + 1 ||
          element.scrollHeight > element.clientHeight + 1,
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
