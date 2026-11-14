import { describe, expect, it } from 'vitest';
import { matchKeyword } from './keywords';

describe('matchKeyword (docs/03-roadmap-appendix/phase2.md §6.1)', () => {
  it('reads STOP, HUMAN and STATUS in English and Roman Hindi, whatever the case or punctuation', () => {
    expect(matchKeyword('STOP')).toBe('stop');
    expect(matchKeyword('  Stop! ')).toBe('stop');
    expect(matchKeyword('Band karo')).toBe('stop');
    expect(matchKeyword('mat bhejo 🙏')).toBe('stop');
    expect(matchKeyword('human.')).toBe('human');
    expect(matchKeyword('Insaan se baat')).toBe('human');
    expect(matchKeyword('status?')).toBe('status');
  });

  it('never reads a keyword inside a longer message, nor in nothing', () => {
    expect(matchKeyword("don't stop the visit")).toBeNull();
    expect(matchKeyword('I want to talk to a human about the pump')).toBeNull();
    expect(matchKeyword('')).toBeNull();
    expect(matchKeyword('   ')).toBeNull();
    expect(matchKeyword(null)).toBeNull();
  });

  it('reads the lists it is given', () => {
    const keywords = { stop: ['ruko'], human: [], status: [] };
    expect(matchKeyword('Ruko', keywords)).toBe('stop');
    expect(matchKeyword('stop', keywords)).toBeNull();
  });
});
