import { describe, expect, it } from 'vitest';
import {
  compileSerialPattern,
  parseSerialPattern,
  serialFitsPattern,
  serialPatternProblem,
} from './serial-pattern';

describe('serial patterns', () => {
  it('accepts a plain shape and anchors it, so a serial must match whole', () => {
    expect(serialPatternProblem('SP[0-9]{8}')).toBeUndefined();
    expect(serialFitsPattern('SP[0-9]{8}', 'SP12345678')).toBe(true);
    expect(serialFitsPattern('SP[0-9]{8}', 'XSP12345678')).toBe(false);
    expect(serialFitsPattern('SP[0-9]{8}', 'SP123456789')).toBe(false);
    expect(compileSerialPattern('SP[0-9]{8}')?.source).toBe('^(?:SP[0-9]{8})$');
  });

  it('takes any serial when there is no pattern', () => {
    expect(serialFitsPattern(null, 'anything at all')).toBe(true);
  });

  it('accepts the safe part: literals, ., \\d, \\w, escaped signs, classes and counts up to 64', () => {
    for (const pattern of [
      'SP\\d{8}',
      '[A-Z]{2}-\\d{4,6}',
      '[\\-A-Z]{2}',
      '[A-Za-z0-9]{12}',
      '[^0-9]\\w+',
      'INV\\.\\d+[A-Z]?',
      'X.{0,64}',
      '[-A-Z_]{3}',
      'ab?c',
      '\\d{64}',
    ]) {
      expect({ pattern, problem: serialPatternProblem(pattern) }).toEqual({
        pattern,
        problem: undefined,
      });
    }
  });

  it('refuses groups, alternation, back-references, lookaround, anchors and other escapes', () => {
    for (const pattern of [
      '(SP|SQ)[0-9]+',
      'SP|SQ',
      '(?:AB)+',
      '(a)\\1',
      'SP(?=\\d)',
      '(?<!x)SP',
      '^SP\\d+',
      'SP\\d+$',
      'SP\\s\\d',
      'SP\\b',
      '\\p{L}+',
      '[[A-Z]]',
      '[]',
      '[z-a]',
      'SP]',
      'SP\\-1',
    ]) {
      expect({ pattern, problem: serialPatternProblem(pattern) }).toEqual({
        pattern,
        problem: 'unsupported',
      });
    }
  });

  it('refuses a quantifier with no atom, a lazy or doubled one, a count over 64 and an open range', () => {
    for (const pattern of ['+A', '{2}A', 'A+?', 'A{2}+', 'A{65}', 'A{2,65}', 'A{3,2}', 'A{2,}']) {
      expect({ pattern, problem: serialPatternProblem(pattern) }).toEqual({
        pattern,
        problem: 'unsupported',
      });
    }
  });

  it('refuses more than two repeats whose length varies, or two unbounded ones', () => {
    expect(serialPatternProblem('XA?B?')).toBeUndefined();
    expect(serialPatternProblem('A+B{1,3}')).toBeUndefined();
    expect(serialPatternProblem('XA?B?C?')).toBe('unsupported');
    expect(serialPatternProblem('A+B*')).toBe('unsupported');
    // Exact counts vary nothing, so they are not counted.
    expect(serialPatternProblem('A{2}B{3}C+D?E{4}')).toBeUndefined();
  });

  it('refuses the patterns the review timed as slow (review finding 1)', () => {
    // Alternation under a repeat: doubles with each digit.
    expect(serialPatternProblem('(\\d|\\d)+')).toBe('unsupported');
    expect(serialPatternProblem('(SP|SP)[0-9]+')).toBe('unsupported');
    // Ten unbounded repeats of the same atom: grows as a power of the serial's length.
    expect(serialPatternProblem('\\d+'.repeat(10))).toBe('unsupported');
    expect(serialPatternProblem('[A-Z]+[0-9]+[A-Z]*[0-9]*')).toBe('unsupported');
  });

  it('refuses a pattern that matches an empty serial, and one longer than 200 characters', () => {
    expect(serialPatternProblem('[0-9]*')).toBe('matches_empty');
    expect(serialPatternProblem('A?')).toBe('matches_empty');
    expect(serialPatternProblem('A'.repeat(200))).toBeUndefined();
    expect(serialPatternProblem('A'.repeat(201))).toBe('too_long');
  });

  it('never matches a serial longer than 100 characters, nor through a pattern outside the safe part', () => {
    expect(serialFitsPattern('A+', 'A'.repeat(100))).toBe(true);
    expect(serialFitsPattern('A+', 'A'.repeat(101))).toBe(false);
    expect(parseSerialPattern('(A)+')).toBe(false);
    expect(serialFitsPattern('(A)+', 'AAA')).toBe(false);
  });

  it('answers a 100-character near miss in under 50 ms for the slowest patterns it allows', () => {
    const slowest = ['\\w*\\w{0,64}\\w{30}X', '.*.{0,64}.{64}X', '\\w{0,64}\\w+\\w{20}X'];
    for (const pattern of slowest) {
      expect(serialPatternProblem(pattern)).toBeUndefined();
      for (const serial of ['1'.repeat(100), `${'1'.repeat(99)}Y`]) {
        const started = performance.now();
        expect(serialFitsPattern(pattern, serial)).toBe(false);
        expect(performance.now() - started).toBeLessThan(50);
      }
    }
  });
});
