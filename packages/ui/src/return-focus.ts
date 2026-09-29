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

/**
 * What the pattern reads of an element, so the rules run without a browser in the tests. The
 * optional parts are always there on a real element; a stand-in may leave them out.
 */
type Focusable = Pick<HTMLElement, 'isConnected' | 'getClientRects'> & {
  disabled?: unknown;
  tabIndex?: number;
  hasAttribute?: (name: string) => boolean;
  matches?: (selectors: string) => boolean;
  closest?: (selectors: string) => unknown;
  checkVisibility?: (options?: { visibilityProperty?: boolean }) => boolean;
};

/**
 * Ancestors, the element included, that keep everything inside them from taking focus. Only
 * `inert` does: `aria-disabled` tells assistive technology a control does nothing now, but the
 * control keeps its focus (ARIA), so focus may return to it.
 */
const BLOCKED_INSIDE = '[inert]';

/** Shown: not `display: none` (as a hidden phone column is) and not `visibility: hidden`. */
function shown(el: Focusable): boolean {
  if (el.getClientRects().length === 0) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ visibilityProperty: true });
  }
  // A browser without checkVisibility still reports the visibility the element ends up with.
  if (typeof Element === 'function' && el instanceof Element) {
    return getComputedStyle(el).visibility === 'visible';
  }
  return true;
}

/**
 * On the page, shown, not disabled (itself or by a disabled fieldset), not inside an `inert` part
 * of the page, and focusable at all: a control, or an element given a `tabindex`, as a fallback
 * heading is. An `aria-disabled` control still takes focus.
 */
export function canTakeFocus(el: Focusable): boolean {
  if (!el.isConnected || !shown(el)) return false;
  if (el.disabled === true || el.matches?.(':disabled') === true) return false;
  if (el.closest !== undefined && el.closest(BLOCKED_INSIDE) !== null) return false;
  const reachable = el.tabIndex === undefined || el.tabIndex >= 0;
  return reachable || el.hasAttribute?.('tabindex') === true;
}

/** The places that can take focus now, in the order given. */
export function focusableCandidates(
  candidates: readonly (FocusCandidate | readonly FocusCandidate[])[],
): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const entry of candidates) {
    const group: readonly FocusCandidate[] = Array.isArray(entry)
      ? (entry as readonly FocusCandidate[])
      : [entry as FocusCandidate];
    for (const el of group) {
      if (el !== null && el !== undefined && canTakeFocus(el)) found.push(el);
    }
  }
  return found;
}

/** The first of the places, in order, that can take focus now. */
export function firstFocusable(
  candidates: readonly (FocusCandidate | readonly FocusCandidate[])[],
): HTMLElement | undefined {
  return focusableCandidates(candidates)[0];
}

/** Whether focus is on the element now; a stand-in without a document never has it. */
function holdsFocus(el: HTMLElement): boolean {
  const doc = (el as { ownerDocument?: Pick<Document, 'activeElement'> | null }).ownerDocument;
  return doc?.activeElement === el;
}

/**
 * The dialog's `onCloseAutoFocus`: the caller's own handler first, then focus to the first place
 * that takes it. A place that looked able but did not take focus is passed over for the next.
 * Radix's own return is stopped only once focus has landed, so when no place takes it, that
 * return runs unchanged.
 */
export function returnFocusHandler(
  returnFocusTo: ReturnFocusTo | undefined,
  onCloseAutoFocus: ((event: Event) => void) | undefined,
): (event: Event) => void {
  return (event) => {
    onCloseAutoFocus?.(event);
    if (event.defaultPrevented || returnFocusTo === undefined) return;
    for (const target of focusableCandidates(returnFocusTo())) {
      target.focus();
      if (holdsFocus(target)) {
        event.preventDefault();
        return;
      }
    }
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

type FocusRef = (el: HTMLElement | null) => (() => void) | undefined;

export function createFocusTargets<K>(): FocusTargets<K> {
  const filed = new Map<K, HTMLElement[]>();
  const refs = new Map<K, FocusRef>();
  /**
   * A key with nothing left on the page is dropped with its ref, so a long-lived screen does not
   * keep an entry for every row it ever drew. `ref` names the ref whose element left: the key's
   * ref is dropped only while it is still that one.
   */
  const forget = (key: K, ref?: FocusRef) => {
    filed.delete(key);
    if (ref === undefined || refs.get(key) === ref) refs.delete(key);
  };
  const connected = (key: K) => (filed.get(key) ?? []).filter((el) => el.isConnected);
  const onPage = (key: K) => {
    const kept = connected(key);
    if (kept.length === 0) forget(key);
    else filed.set(key, kept);
    return kept;
  };
  return {
    ref(key) {
      let ref = refs.get(key);
      if (ref === undefined) {
        const made: FocusRef = (el) => {
          if (el === null) return undefined;
          // An element attached through this ref keeps it the key's one ref, even when the key's
          // last other element has just left and dropped it (a card moved to another column).
          refs.set(key, made);
          filed.set(key, [el, ...connected(key).filter((e) => e !== el)]);
          return () => {
            const rest = (filed.get(key) ?? []).filter((e) => e !== el);
            if (rest.length === 0) forget(key, made);
            else filed.set(key, rest);
          };
        };
        ref = made;
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
