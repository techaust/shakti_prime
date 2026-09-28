import { describe, expect, it } from 'vitest';
import {
  containsPattern,
  matchesBySimilarity,
  phoneDigits,
  startsWithPattern,
} from './search-text';

describe('startsWithPattern', () => {
  it('finds the text at the start, with typed wildcards literal', () => {
    expect(startsWithPattern('Ram')).toBe('Ram%');
    expect(startsWithPattern('50%')).toBe('50\\%%');
    expect(startsWithPattern('a_b')).toBe('a\\_b%');
  });
});

describe('matchesBySimilarity', () => {
  it('matches names of three characters or more by spelling similarity', () => {
    expect(matchesBySimilarity('Rmesh')).toBe(true);
    expect(matchesBySimilarity('Ram')).toBe(true);
  });

  it('keeps shorter text and phone digits to the exact match', () => {
    expect(matchesBySimilarity('Ra')).toBe(false);
    expect(matchesBySimilarity(' Ra ')).toBe(false);
    expect(matchesBySimilarity('98765')).toBe(false);
    expect(matchesBySimilarity('+91 98765 43210')).toBe(false);
  });
});

describe('containsPattern', () => {
  it('finds the text anywhere', () => {
    expect(containsPattern('Nashik')).toBe('%Nashik%');
  });

  it('keeps typed wildcards and the escape character literal', () => {
    expect(containsPattern('50%')).toBe('%50\\%%');
    expect(containsPattern('a_b')).toBe('%a\\_b%');
    expect(containsPattern('a\\b')).toBe('%a\\\\b%');
  });
});

describe('phoneDigits', () => {
  it('reads the digits of a number however it is written', () => {
    expect(phoneDigits('43210')).toBe('43210');
    expect(phoneDigits('+91 98765 43210')).toBe('919876543210');
    expect(phoneDigits('98765-43210')).toBe('9876543210');
    expect(phoneDigits('(0253) 2345')).toBe('02532345');
  });

  it('treats any other text as a name', () => {
    expect(phoneDigits('Ramesh')).toBeUndefined();
    expect(phoneDigits('Ward 12')).toBeUndefined();
    expect(phoneDigits('7')).toBeUndefined();
    expect(phoneDigits('1234567890123456')).toBeUndefined();
  });
});
