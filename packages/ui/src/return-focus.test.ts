import { describe, expect, it } from 'vitest';
import {
  canTakeFocus,
  createFocusTargets,
  firstFocusable,
  returnFocusHandler,
  type FocusCandidate,
} from './return-focus';

/** The page the stand-ins live on: which of them holds focus. */
const page: { activeElement: unknown } = { activeElement: null };

interface ElementState {
  connected?: boolean;
  /** Laid out at all (`display: none` is not). */
  shown?: boolean;
  /** `visibility: hidden`. */
  invisible?: boolean;
  disabled?: boolean;
  /** Inside a disabled fieldset. */
  fieldsetDisabled?: boolean;
  /** Inside an `inert` part of the page, or an `aria-disabled="true"` one. */
  blockedBy?: 'inert' | 'aria-disabled';
  /** Not focusable at all: a plain element with no `tabindex`. */
  plain?: boolean;
  /** Given `tabindex="-1"`, as a fallback heading is. */
  programmatic?: boolean;
  /** Looks able but does not take focus when asked. */
  refuses?: boolean;
}

/**
 * A stand-in for an element: on the page or not, shown or hidden, and how often it was focused.
 * `state` is read live, so a test can take an element off the page after filing it.
 */
function element(
  name: string,
  state: ElementState = {},
): HTMLElement & { name: string; focused: number } {
  const el = {
    name,
    focused: 0,
    ownerDocument: page,
    get isConnected() {
      return state.connected ?? true;
    },
    get disabled() {
      return state.disabled ?? false;
    },
    get tabIndex() {
      return state.plain === true || state.programmatic === true ? -1 : 0;
    },
    hasAttribute: (attribute: string) => attribute === 'tabindex' && state.programmatic === true,
    matches: (selectors: string) => selectors === ':disabled' && state.fieldsetDisabled === true,
    // The one ancestor the state names, matched by the selector a browser would match it by.
    closest: (selectors: string) => {
      const list = selectors.split(',').map((s) => s.trim());
      if (state.blockedBy === 'inert' && list.includes('[inert]')) return {};
      if (
        state.blockedBy === 'aria-disabled' &&
        list.some((s) => s === '[aria-disabled]' || s === '[aria-disabled="true"]')
      ) {
        return {};
      }
      return null;
    },
    checkVisibility: (options?: { visibilityProperty?: boolean }) =>
      (state.shown ?? true) && !(options?.visibilityProperty === true && state.invisible === true),
    getClientRects: () => ({ length: (state.shown ?? true) ? 1 : 0 }),
    focus() {
      el.focused += 1;
      if (state.refuses !== true) page.activeElement = el;
    },
  };
  return el as unknown as HTMLElement & { name: string; focused: number };
}

const closeEvent = () => new Event('focusScope.autoFocusOnUnmount', { cancelable: true });

describe('canTakeFocus', () => {
  it('takes an element on the page that shows and is not disabled', () => {
    expect(canTakeFocus(element('actions'))).toBe(true);
  });

  it('skips an element that has left the page, is hidden or is disabled', () => {
    expect(canTakeFocus(element('gone', { connected: false }))).toBe(false);
    expect(canTakeFocus(element('hidden column', { shown: false }))).toBe(false);
    expect(canTakeFocus(element('off', { disabled: true }))).toBe(false);
  });

  it('skips an element hidden by visibility, in a disabled fieldset or inert', () => {
    expect(canTakeFocus(element('invisible', { invisible: true }))).toBe(false);
    expect(canTakeFocus(element('in a fieldset', { fieldsetDisabled: true }))).toBe(false);
    expect(canTakeFocus(element('behind a modal', { blockedBy: 'inert' }))).toBe(false);
  });

  it('takes an aria-disabled control, which keeps its focus under ARIA', () => {
    expect(canTakeFocus(element('greyed out', { blockedBy: 'aria-disabled' }))).toBe(true);
    const opener = element('menu button', { blockedBy: 'aria-disabled' });
    expect(firstFocusable([opener, element('heading', { programmatic: true })])).toBe(opener);
  });

  it('skips an element that is not focusable, and takes one given a tabindex', () => {
    expect(canTakeFocus(element('plain text', { plain: true }))).toBe(false);
    expect(canTakeFocus(element('column heading', { programmatic: true }))).toBe(true);
  });
});

describe('firstFocusable', () => {
  it('picks the first place that can take focus, in the order given', () => {
    const heading = element('heading');
    const region = element('region');
    expect(
      firstFocusable([undefined, null, element('gone', { connected: false }), heading, region]),
    ).toBe(heading);
  });

  it('looks through a group, such as the two copies of a row a data grid draws', () => {
    const tableCopy = element('table copy', { shown: false });
    const phoneCopy = element('phone copy');
    expect(firstFocusable([[tableCopy, phoneCopy], element('fallback')])).toBe(phoneCopy);
  });

  it('answers nothing when no place can take focus', () => {
    expect(firstFocusable([])).toBeUndefined();
    expect(firstFocusable([[], element('gone', { connected: false })])).toBeUndefined();
  });
});

describe('returnFocusHandler', () => {
  it("focuses the first place that can take it and stops Radix's own return", () => {
    const actions = element('actions');
    const event = closeEvent();
    returnFocusHandler(() => [actions], undefined)(event);
    expect(actions.focused).toBe(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('reads the places when the dialog closes, not when it opens', () => {
    let where: FocusCandidate = element('old', { connected: false });
    const handler = returnFocusHandler(() => [where], undefined);
    const moved = element('moved card');
    where = moved;
    handler(closeEvent());
    expect(moved.focused).toBe(1);
  });

  it('passes over a place that did not take focus, and stops Radix only once focus has landed', () => {
    const refusing = element('refusing', { refuses: true });
    const heading = element('heading', { programmatic: true });
    const event = closeEvent();
    returnFocusHandler(() => [refusing, heading], undefined)(event);
    expect(refusing.focused).toBe(1);
    expect(heading.focused).toBe(1);
    expect(page.activeElement).toBe(heading);
    expect(event.defaultPrevented).toBe(true);

    // When nothing takes focus, Radix's own return runs.
    const nothing = closeEvent();
    returnFocusHandler(() => [element('also refusing', { refuses: true })], undefined)(nothing);
    expect(nothing.defaultPrevented).toBe(false);
  });

  it("leaves Radix's return alone when no place can take focus or none is named", () => {
    const none = closeEvent();
    returnFocusHandler(() => [element('gone', { connected: false })], undefined)(none);
    expect(none.defaultPrevented).toBe(false);
    const unnamed = closeEvent();
    returnFocusHandler(undefined, undefined)(unnamed);
    expect(unnamed.defaultPrevented).toBe(false);
  });

  it("runs the caller's own handler first and respects its choice", () => {
    const actions = element('actions');
    const seen: string[] = [];
    const event = closeEvent();
    returnFocusHandler(
      () => [actions],
      (e) => {
        seen.push(e.type);
        e.preventDefault();
      },
    )(event);
    expect(seen).toEqual(['focusScope.autoFocusOnUnmount']);
    expect(actions.focused).toBe(0);
  });
});

describe('createFocusTargets', () => {
  it('files elements by key and gives one stable ref per key', () => {
    const targets = createFocusTargets<string>();
    expect(targets.ref('lead-1')).toBe(targets.ref('lead-1'));
    expect(targets.ref('lead-1')).not.toBe(targets.ref('lead-2'));
    const button = element('lead 1 actions');
    targets.ref('lead-1')(button);
    expect(targets.get('lead-1')).toEqual([button]);
    expect(targets.get('lead-2')).toEqual([]);
  });

  it('keeps both copies of a row, newest first', () => {
    const targets = createFocusTargets<string>();
    const tableCopy = element('table copy');
    const phoneCopy = element('phone copy');
    targets.ref('user-1')(tableCopy);
    targets.ref('user-1')(phoneCopy);
    expect(targets.get('user-1')).toEqual([phoneCopy, tableCopy]);
  });

  it('forgets an element when React detaches it, or once it has left the page', () => {
    const targets = createFocusTargets<string>();
    const first = element('first');
    const detach = targets.ref('lead-1')(first);
    detach?.();
    expect(targets.get('lead-1')).toEqual([]);

    // A card moved to another column mounts a new button; the old one leaves the page.
    const oldState = { connected: true };
    targets.ref('lead-1')(element('old', oldState));
    const remounted = element('remounted');
    targets.ref('lead-1')(remounted);
    oldState.connected = false;
    expect(targets.get('lead-1')).toEqual([remounted]);
  });

  it('drops a key and its ref once nothing is filed under it, and keeps a ref still in use', () => {
    const targets = createFocusTargets<string>();
    const first = targets.ref('lead-1');
    const detach = first(element('first'));
    detach?.();
    // Dropped: the next row drawn under the key gets a fresh ref.
    expect(targets.ref('lead-1')).not.toBe(first);

    // A card moved to another column: the old button leaves as the new one arrives through the
    // same ref, which stays the key's one ref.
    const board = createFocusTargets<string>();
    const ref = board.ref('lead-2');
    const leave = ref(element('old'));
    leave?.();
    const moved = element('moved');
    ref(moved);
    expect(board.ref('lead-2')).toBe(ref);
    expect(board.get('lead-2')).toEqual([moved]);

    // A key whose elements all left the page without a cleanup is dropped when it is read.
    const quiet = createFocusTargets<string>();
    const state = { connected: true };
    const kept = quiet.ref('row');
    kept(element('row', state));
    state.connected = false;
    expect(quiet.get('row')).toEqual([]);
    expect(quiet.ref('row')).not.toBe(kept);
  });

  it('ignores the null React passes to a ref without a cleanup', () => {
    const targets = createFocusTargets<string>();
    const button = element('button');
    targets.ref('row')(button);
    expect(targets.ref('row')(null)).toBeUndefined();
    expect(targets.get('row')).toEqual([button]);
  });
});
