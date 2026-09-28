'use client';

import { useState } from 'react';

/**
 * Where keyboard focus goes when a dialog or sheet closes (WCAG 2.4.3, DESIGN.md §9).
 *
 * Radix returns focus to whatever held it when the dialog mounted. A dialog opened from a menu
 * item mounts after the item has left the page, so that is `<body>` and a keyboard user loses
 * their place. A screen names the places instead, best first: the button that opened the menu,
 * then a fallback such as a column heading for when that button has moved out of sight or gone.
 */
export type FocusCandidate = HTMLElement | null | undefined;

/** Read when the dialog closes, after the screen has redrawn, so moved elements are found. */
export type ReturnFocusTo = () => readonly (FocusCandidate | readonly FocusCandidate[])[];

/** What the pattern reads of an element, so the rules run without a browser in the tests. */
type Focusable = Pick<HTMLElement, 'isConnected' | 'getClientRects'> & { disabled?: unknown };

/** On the page, shown (not `display: none`, as a hidden phone column is) and not disabled. */
export function canTakeFocus(el: Focusable): boolean {
  return el.isConnected && el.getClientRects().length > 0 && el.disabled !== true;
}

/** The first of the places, in order, that can take focus now. */
export function firstFocusable(
  candidates: readonly (FocusCandidate | readonly FocusCandidate[])[],
): HTMLElement | undefined {
  for (const entry of candidates) {
    const group: readonly FocusCandidate[] = Array.isArray(entry)
      ? (entry as readonly FocusCandidate[])
      : [entry as FocusCandidate];
    for (const el of group) {
      if (el !== null && el !== undefined && canTakeFocus(el)) return el;
    }
  }
  return undefined;
}

/**
 * The dialog's `onCloseAutoFocus`: the caller's own handler first, then focus to the first place
 * that can take it. When none can, Radix's own return runs unchanged.
 */
export function returnFocusHandler(
  returnFocusTo: ReturnFocusTo | undefined,
  onCloseAutoFocus: ((event: Event) => void) | undefined,
): (event: Event) => void {
  return (event) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented || returnFocusTo === undefined) return;
    const target = firstFocusable(returnFocusTo());
    if (target === undefined) return;
    event.preventDefault();
    target.focus();
  };
}

/**
 * The elements a screen may return focus to, filed by a key such as a row's id. A key can hold
 * more than one element: a data grid draws each row twice, as a table row and as a phone card.
 */
export interface FocusTargets<K> {
  /** A ref for the element filed under `key`; one stable function per key. */
  ref: (key: K) => (el: HTMLElement | null) => (() => void) | undefined;
  /** The elements under `key` that are still on the page, newest first. */
  get: (key: K) => HTMLElement[];
}

export function createFocusTargets<K>(): FocusTargets<K> {
  const filed = new Map<K, HTMLElement[]>();
  const refs = new Map<K, (el: HTMLElement | null) => (() => void) | undefined>();
  const onPage = (key: K) => {
    const kept = (filed.get(key) ?? []).filter((el) => el.isConnected);
    if (kept.length === 0) filed.delete(key);
    else filed.set(key, kept);
    return kept;
  };
  return {
    ref(key) {
      let ref = refs.get(key);
      if (ref === undefined) {
        ref = (el) => {
          if (el === null) return undefined;
          filed.set(key, [el, ...onPage(key).filter((e) => e !== el)]);
          return () => {
            const rest = (filed.get(key) ?? []).filter((e) => e !== el);
            if (rest.length === 0) filed.delete(key);
            else filed.set(key, rest);
          };
        };
        refs.set(key, ref);
      }
      return ref;
    },
    get: (key) => [...onPage(key)],
  };
}

/** `createFocusTargets` kept for the life of the screen. */
export function useFocusTargets<K>(): FocusTargets<K> {
  const [targets] = useState(() => createFocusTargets<K>());
  return targets;
}
