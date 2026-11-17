import { afterEach, describe, expect, it, vi } from 'vitest';
import { handOverPhone, NEW_LEAD_PHONE_EVENT, takeHandedPhone, typedPhone } from './new-lead-phone';

/** The tab's session storage and its events, as the browser keeps them. */
function fakeWindow() {
  const kept = new Map<string, string>();
  const target = new EventTarget();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => kept.set(k, v),
      removeItem: (k: string) => kept.delete(k),
    },
    dispatchEvent: (e: Event) => target.dispatchEvent(e),
    addEventListener: target.addEventListener.bind(target),
  });
  return { kept, target };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the number from the screen-pop to the New lead form', () => {
  it('is taken once, within two minutes, and tells a form already open', () => {
    const w = fakeWindow();
    const heard = vi.fn();
    w.target.addEventListener(NEW_LEAD_PHONE_EVENT, heard);
    handOverPhone('+919812345678', 1_000);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(takeHandedPhone(2_000)).toBe('+919812345678');
    expect(takeHandedPhone(2_000)).toBeUndefined();
    handOverPhone('+919812345678', 1_000);
    expect(takeHandedPhone(1_000 + 120_001)).toBeUndefined();
  });

  it('takes nothing that is not a number', () => {
    const w = fakeWindow();
    w.kept.set('bos.screen-pop.new-lead-phone', JSON.stringify({ phone: '98123', at: 1 }));
    expect(takeHandedPhone(2)).toBeUndefined();
    w.kept.set('bos.screen-pop.new-lead-phone', 'not kept as JSON');
    expect(takeHandedPhone(2)).toBeUndefined();
  });

  it('writes an Indian mobile as a caller types it', () => {
    expect(typedPhone('+919812345678')).toBe('98123 45678');
    expect(typedPhone('+14155550123')).toBe('+14155550123');
  });
});
