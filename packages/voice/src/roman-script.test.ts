import { describe, expect, it } from 'vitest';
import { hasDevanagari, isRomanScript, romanOnly } from './roman-script';

// Other scripts are built from code points, so no file of the repository holds them (ADR 0014).
const text = (...points: number[]) => String.fromCodePoint(...points);

describe('Roman script only', () => {
  it('accepts Latin letters, digits, accents, punctuation and symbols', () => {
    for (const ok of [
      'paanch HP ka pump, ₹1,25,000 mein',
      'café – naïve',
      'SS/SO/2026-27/0042?',
      '',
    ]) {
      expect(isRomanScript(ok), ok).toBe(true);
    }
  });

  it('refuses Devanagari, the danda and Devanagari digits', () => {
    expect(isRomanScript(`pump ${text(0x092a, 0x0902, 0x092a)}`)).toBe(false);
    expect(isRomanScript(`stock hai${text(0x0964)}`)).toBe(false);
    expect(isRomanScript(`order ${text(0x0966, 0x0967)}`)).toBe(false);
    expect(hasDevanagari(text(0x0964))).toBe(true);
  });

  it('refuses the other Indian scripts and Urdu', () => {
    expect(isRomanScript(text(0x0a2a))).toBe(false); // Gurmukhi
    expect(isRomanScript(text(0x0aaa))).toBe(false); // Gujarati
    expect(isRomanScript(text(0x067e))).toBe(false); // Arabic script, as Urdu writes it
    expect(isRomanScript(text(0x0baa))).toBe(false); // Tamil
  });

  it('throws an error that names no text', () => {
    const gujarati = `stock ${text(0x0aaa)}`;
    expect(() => romanOnly('sarvam', gujarati)).toThrow(
      expect.objectContaining({ failure: 'invalid_response', vendorCode: 'not_roman_script' }),
    );
    try {
      romanOnly('anthropic', gujarati);
    } catch (error) {
      expect(String(error)).not.toContain('stock');
      expect((error as Error).cause).toBeUndefined();
    }
    expect(romanOnly('sarvam', 'stock hai')).toBe('stock hai');
  });
});
