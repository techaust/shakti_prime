import { describe, expect, it } from 'vitest';
import { draftKeyAction, draftLineKey } from './keys';

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

describe('draftLineKey', () => {
  it('reads the draft again for a new message and on each read of the chat', () => {
    const newest = '01990000-0000-7000-8000-00000000e001';
    expect(draftLineKey(newest, 1)).not.toBe(draftLineKey(newest, 0));
    expect(draftLineKey('01990000-0000-7000-8000-00000000e002', 0)).not.toBe(
      draftLineKey(newest, 0),
    );
    expect(draftLineKey(newest, 2)).toBe(draftLineKey(newest, 2));
  });
});
