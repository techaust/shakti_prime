import { describe, expect, it } from 'vitest';
import { checkCatalogues, checkParity, checkString, flatten, messageVariants } from './rules';

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
    expect(checkString('k', 'Namaste Ramesh ji, aapka quotation taiyaar hai.', 'hinglish')).toEqual(
      [],
    );
  });

  it('flags Devanagari anywhere (ADR 0014)', () => {
    expect(checkString('k', 'आपका कोटेशन तैयार है।', 'en').map((i) => i.reason)).toContain(
      'Devanagari text',
    );
    expect(checkString('k', 'Quote ready: कोटेशन', 'en').map((i) => i.reason)).toContain(
      'Devanagari text',
    );
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

  it('measures each wording of a plural message, not the pattern', () => {
    const plural = '{count, plural, one {Add {shown} lead} other {Add {shown} leads}}';
    expect(messageVariants(plural)).toEqual(['Add {shown} lead', 'Add {shown} leads']);
    const limits = [{ keyPattern: '\\.commit$', max: 24 }];
    expect(checkString('imports.check.commit', plural, 'en', limits)).toEqual([]);
    const tooLong = '{count, plural, one {x} other {This label is far too long to fit}}';
    expect(checkString('imports.check.commit', tooLong, 'en', limits)).toEqual([
      { key: 'imports.check.commit', locale: 'en', reason: 'longer than 24 characters' },
    ]);
    expect(messageVariants('No choice here {shown}')).toEqual(['No choice here {shown}']);
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
      ['hinglish', new Map([['a', 'Namaste']])],
    ]);
    expect(checkParity(cats)).toEqual([
      { key: 'b', locale: 'hinglish', reason: 'missing in this language' },
    ]);
  });
});

describe('checkCatalogues', () => {
  it('is clean for a good pair', () => {
    const cats = new Map([
      ['en', new Map([['a', 'Please sign in again.']])],
      ['hinglish', new Map([['a', 'Kripya dobara sign in karein.']])],
    ]);
    expect(checkCatalogues(cats)).toEqual([]);
  });
});
