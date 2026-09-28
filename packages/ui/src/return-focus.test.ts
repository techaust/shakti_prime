import { describe, expect, it } from 'vitest';
import {
  canTakeFocus,
  createFocusTargets,
  firstFocusable,
  returnFocusHandler,
  type FocusCandidate,
} from './return-focus';

/**
 * A stand-in for an element: on the page or not, shown or hidden, and how often it was focused.
 * `state` is read live, so a test can take an element off the page after filing it.
 */
function element(
  name: string,
  state: { connected?: boolean; shown?: boolean; disabled?: boolean } = {},
): HTMLElement & { name: string; focused: number } {
  const el = {
    name,
    focused: 0,
    get isConnected() {
      return state.connected ?? true;
    },
    get disabled() {
      return state.disabled ?? false;
    },
    getClientRects: () => ({ length: (state.shown ?? true) ? 1 : 0 }),
    focus() {
      el.focused += 1;
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

  it('ignores the null React passes to a ref without a cleanup', () => {
    const targets = createFocusTargets<string>();
    const button = element('button');
    targets.ref('row')(button);
    expect(targets.ref('row')(null)).toBeUndefined();
    expect(targets.get('row')).toEqual([button]);
  });
});
