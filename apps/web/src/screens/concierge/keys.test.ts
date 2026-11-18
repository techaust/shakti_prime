import { describe, expect, it } from 'vitest';
import { draftKeyAction } from './keys';

const key = (
  k: string,
  mods: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {},
) => draftKeyAction({ key: k, altKey: false, ctrlKey: false, metaKey: false, ...mods });

describe('draftKeyAction', () => {
  it('sends, edits and discards with S, E and D in either case', () => {
    expect([key('s'), key('S'), key('e'), key('E'), key('d'), key('D')]).toEqual([
      'send',
      'send',
      'edit',
      'edit',
      'discard',
      'discard',
    ]);
  });

  it('leaves every other key and every key with a modifier alone', () => {
    expect(key('a')).toBeUndefined();
    expect(key('Enter')).toBeUndefined();
    expect(key('s', { ctrlKey: true })).toBeUndefined();
    expect(key('d', { metaKey: true })).toBeUndefined();
    expect(key('e', { altKey: true })).toBeUndefined();
  });
});
