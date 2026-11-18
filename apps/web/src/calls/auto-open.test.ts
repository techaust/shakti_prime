import { describe, expect, it } from 'vitest';
import { isTyping, opensOnArrival } from './auto-open';

describe('where the screen-pop opens a page by itself', () => {
  it('opens from home, the lists and a customer’s Account 360 while nothing is typed', () => {
    for (const path of [
      '/home',
      '/customers',
      '/customers/01a1e99a-af91-76d1-83ca-7bab32272e3b',
      '/customers/01a1e99a-af91-76d1-83ca-7bab32272e3b/',
      '/leads',
      '/leads/board',
    ]) {
      expect({ path, opens: opensOnArrival(path, false) }).toEqual({ path, opens: true });
    }
  });

  it('never opens from a form, nor from any page where the person has typed', () => {
    for (const path of ['/leads/new', '/leads/walk-in', '/calling', '/quotes/new', '/settings']) {
      expect({ path, opens: opensOnArrival(path, false) }).toEqual({ path, opens: false });
    }
    expect(opensOnArrival('/customers', true)).toBe(false);
    expect(opensOnArrival('/home', true)).toBe(false);
  });

  it('counts typing in a box, a list or an editable area, never in the card itself', () => {
    const card = { contains: (node: unknown) => node === inCard } as unknown as Node;
    const inCard = { tagName: 'INPUT' } as unknown as EventTarget;
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTyping({ tagName } as unknown as EventTarget, card)).toBe(true);
    }
    expect(
      isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget, card),
    ).toBe(true);
    expect(isTyping({ tagName: 'BUTTON' } as unknown as EventTarget, card)).toBe(false);
    expect(isTyping(inCard, card)).toBe(false);
    expect(isTyping(null, card)).toBe(false);
  });
});
