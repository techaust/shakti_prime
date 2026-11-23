import { describe, expect, it } from 'vitest';
import { compileSerialPattern, serialFitsPattern, serialPatternProblem } from './serial-pattern';

describe('serial patterns', () => {
  it('accepts a plain shape and anchors it, so a serial must match whole', () => {
    expect(serialPatternProblem('SP[0-9]{8}')).toBeUndefined();
    expect(serialFitsPattern('SP[0-9]{8}', 'SP12345678')).toBe(true);
    expect(serialFitsPattern('SP[0-9]{8}', 'XSP12345678')).toBe(false);
    expect(serialFitsPattern('SP[0-9]{8}', 'SP123456789')).toBe(false);
    // An alternation is anchored as a whole, not branch by branch.
    expect(serialFitsPattern('AB|CD', 'ABX')).toBe(false);
    expect(compileSerialPattern('AB|CD')?.source).toBe('^(?:AB|CD)$');
  });

  it('takes any serial when there is no pattern', () => {
    expect(serialFitsPattern(null, 'anything at all')).toBe(true);
  });

  it('refuses a pattern that does not compile with the u flag, or matches an empty serial', () => {
    expect(serialPatternProblem('SP[0-9')).toBe('not_compiling');
    // Valid without `u`, refused with it: a lone escape of a plain letter.
    expect(serialPatternProblem('\\q')).toBe('not_compiling');
    expect(serialPatternProblem('[0-9]*')).toBe('matches_empty');
    expect(serialPatternProblem('A?')).toBe('matches_empty');
  });

  it('refuses a pattern longer than 200 characters', () => {
    expect(serialPatternProblem('A'.repeat(200))).toBeUndefined();
    expect(serialPatternProblem('A'.repeat(201))).toBe('too_long');
  });

  it('refuses a repeat around a repeating group, which can run for ever', () => {
    expect(serialPatternProblem('(a+)+')).toBe('nested_repeat');
    expect(serialPatternProblem('(\\d*)*X')).toBe('nested_repeat');
    expect(serialPatternProblem('((ab)+c)+')).toBe('nested_repeat');
    expect(serialPatternProblem('(?:[A-Z]{2}){3}')).toBeUndefined();
    expect(serialPatternProblem('(SP|SQ)[0-9]+')).toBeUndefined();
    expect(serialPatternProblem('[(+)]+X')).toBeUndefined();
    expect(serialPatternProblem('\\(\\d+\\)+')).toBeUndefined();
  });

  it('never matches a serial longer than 100 characters', () => {
    expect(serialFitsPattern('A+', 'A'.repeat(100))).toBe(true);
    expect(serialFitsPattern('A+', 'A'.repeat(101))).toBe(false);
  });
});
