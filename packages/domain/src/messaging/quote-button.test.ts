import { describe, expect, it } from 'vitest';
import { quoteButtonToken, quoteButtonTokens, verifyQuoteButtonToken } from './quote-button';

// A test phrase, never a deployed secret (CLAUDE.md, secret scan).
const SECRET = 'quote button test phrase';
const QUOTE = '01990000-0000-7000-8000-0000000000a1';
const OTHER_QUOTE = '01990000-0000-7000-8000-0000000000a2';
const TO = { threadId: '01990000-0000-7000-8000-0000000000b1', waId: '919812345678' };

describe('quote button tokens', () => {
  it('verify for their own quote, chat and number, with their action', () => {
    const [accept, talk] = quoteButtonTokens(SECRET, QUOTE, TO);
    expect(verifyQuoteButtonToken(SECRET, accept ?? '', TO)).toEqual({
      action: 'accept',
      quoteId: QUOTE,
    });
    expect(verifyQuoteButtonToken(SECRET, talk ?? '', TO)).toEqual({
      action: 'talk',
      quoteId: QUOTE,
    });
    expect((accept ?? '').length).toBeLessThanOrEqual(128);
  });

  it('verify to nothing from another number or another chat', () => {
    const token = quoteButtonToken(SECRET, 'accept', QUOTE, TO);
    expect(verifyQuoteButtonToken(SECRET, token, { ...TO, waId: '919800000000' })).toBeNull();
    expect(
      verifyQuoteButtonToken(SECRET, token, {
        ...TO,
        threadId: '01990000-0000-7000-8000-0000000000b2',
      }),
    ).toBeNull();
  });

  it('verify to nothing when forged, changed, or made with another secret', () => {
    const token = quoteButtonToken(SECRET, 'talk', QUOTE, TO);
    const [version, code, , tag] = token.split('.');
    // The quote swapped under the same MAC, the action swapped, the MAC changed by one character.
    expect(verifyQuoteButtonToken(SECRET, `${version}.${code}.${OTHER_QUOTE}.${tag}`, TO)).toBe(
      null,
    );
    expect(verifyQuoteButtonToken(SECRET, `${version}.a.${QUOTE}.${tag}`, TO)).toBeNull();
    const flipped = `${tag?.slice(0, -1) ?? ''}${tag?.endsWith('A') ? 'B' : 'A'}`;
    expect(verifyQuoteButtonToken(SECRET, `${version}.${code}.${QUOTE}.${flipped}`, TO)).toBe(null);
    expect(
      verifyQuoteButtonToken(SECRET, quoteButtonToken('another phrase', 'accept', QUOTE, TO), TO),
    ).toBeNull();
    for (const junk of ['', 'accept', `q1.a.${QUOTE}`, `q2.a.${QUOTE}.${tag}`, `${token}.x`]) {
      expect(verifyQuoteButtonToken(SECRET, junk, TO)).toBeNull();
    }
  });

  it('refuse to make a token without a secret', () => {
    expect(() => quoteButtonToken('', 'accept', QUOTE, TO)).toThrow();
  });
});
