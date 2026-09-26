import { describe, expect, it } from 'vitest';
import { checkCatalogues, checkParity, checkString, flatten } from './rules.js';

describe('flatten', () => {
  it('produces dotted keys', () => {
    expect([...flatten({ a: { b: 'x', c: { d: 'y' } } })]).toEqual([
      ['a.b', 'x'],
      ['a.c.d', 'y'],
    ]);
  });
});

describe('checkString', () => {
  it('accepts plain final copy', () => {
    expect(
      checkString(
        'k',
        "We couldn't save this quote. Check your internet connection and try again.",
        'en',
      ),
    ).toEqual([]);
    expect(checkString('k', 'नमस्ते रमेश जी, आपका कोटेशन तैयार है।', 'hi')).toEqual([]);
  });

  it.each([
    ['Request failed with 403', 'request'],
    ['Session expired, log in', 'session expired'],
    ['Lorem ipsum dolor', 'Lorem ipsum'],
    ['Coming soon', 'coming soon'],
    ['Invalid input', 'invalid'],
    ['Saved to the database', 'database'],
    ['Sample customer', 'sample'],
    ['A test lead', 'test'],
  ])('flags "%s"', (value, phrase) => {
    const reasons = checkString('k', value, 'en').map((i) => i.reason);
    expect(reasons).toContain(`banned word "${phrase}"`);
  });

  it('matches whole words only', () => {
    expect(checkString('k', 'Your latest requests were saved', 'en')).toEqual([]);
    expect(checkString('k', 'Contested', 'en')).toEqual([]);
  });

  it('flags empty strings and exclamation marks', () => {
    expect(checkString('k', '  ', 'en').map((i) => i.reason)).toContain('empty string');
    expect(checkString('k', 'Saved!', 'en').map((i) => i.reason)).toContain('exclamation mark');
  });

  it('enforces length limits by key pattern', () => {
    const limits = [{ keyPattern: '\\.button\\.', max: 5 }];
    expect(checkString('x.button.save', 'Save now', 'en', limits).map((i) => i.reason)).toContain(
      'longer than 5 characters',
    );
    expect(checkString('x.title', 'Save now', 'en', limits)).toEqual([]);
  });
});

describe('checkParity', () => {
  it('reports keys missing in one language', () => {
    const cats = new Map([
      [
        'en',
        new Map([
          ['a', 'x'],
          ['b', 'y'],
        ]),
      ],
      ['hi', new Map([['a', 'क']])],
    ]);
    expect(checkParity(cats)).toEqual([
      { key: 'b', locale: 'hi', reason: 'missing in this language' },
    ]);
  });
});

describe('checkCatalogues', () => {
  it('is clean for a good pair', () => {
    const cats = new Map([
      ['en', new Map([['a', 'Please sign in again.']])],
      ['hi', new Map([['a', 'कृपया फिर से साइन इन करें।']])],
    ]);
    expect(checkCatalogues(cats)).toEqual([]);
  });
});
