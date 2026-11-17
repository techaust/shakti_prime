import { describe, expect, it } from 'vitest';
import { memoryKeyValue } from '../ports/key-value';
import {
  acceptanceCode,
  checkAcceptanceCode,
  codeOf,
  holdAcceptanceCode,
  needsAcceptanceCode,
  pendingAcceptanceCode,
} from './acceptance-code';

// A low-entropy phrase, so the secret scan never mistakes it for a key (CLAUDE.md).
const SECRET = 'acceptance-code-test-phrase';
const CHAT = {
  entityId: 2,
  waId: '919000000002',
  threadId: '01990000-0000-7000-8000-0000000000c1',
  quoteId: '01990000-0000-7000-8000-0000000000c2',
};
const MESSAGE = '01990000-0000-7000-8000-0000000000c3';
const T0 = new Date('2026-11-17T10:00:00Z');
const later = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function held() {
  let now = T0.getTime();
  const kv = memoryKeyValue(() => now);
  await holdAcceptanceCode(kv, SECRET, CHAT, MESSAGE, T0);
  return { kv, at: (minutes: number) => (now = later(minutes).getTime()) };
}

describe('the one-time code of a WhatsApp acceptance (docs/03-roadmap-appendix/phase2.md §7.1)', () => {
  it('is six digits made from the message id and the secret, never the same for another', () => {
    const code = acceptanceCode(SECRET, MESSAGE);
    expect(code).toMatch(/^\d{6}$/);
    expect(acceptanceCode(SECRET, MESSAGE)).toBe(code);
    expect(acceptanceCode('another-test-phrase', MESSAGE)).not.toBe(code);
    expect(() => acceptanceCode('', MESSAGE)).toThrow();
  });

  it('keeps only a hash: the code itself is nowhere in the store', async () => {
    const { kv } = await held();
    const code = acceptanceCode(SECRET, MESSAGE);
    const stored = await kv.get(`whatsapp:acceptance-code:${CHAT.threadId}:${CHAT.quoteId}`);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(code);
    expect(await pendingAcceptanceCode(kv, CHAT)).toEqual({
      threadId: CHAT.threadId,
      quoteId: CHAT.quoteId,
    });
  });

  it('matches the code on its own chat once, and then no more', async () => {
    const { kv } = await held();
    const code = acceptanceCode(SECRET, MESSAGE);
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, code, later(1))).toEqual({
      outcome: 'match',
      quoteId: CHAT.quoteId,
    });
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, code, later(1))).toEqual({
      outcome: 'none',
    });
  });

  it('never matches on another chat of the same number', async () => {
    const { kv } = await held();
    const code = acceptanceCode(SECRET, MESSAGE);
    const other = { ...CHAT, threadId: '01990000-0000-7000-8000-0000000000c9' };
    expect(await checkAcceptanceCode(kv, SECRET, other, code, later(1))).toEqual({
      outcome: 'none',
    });
  });

  it('clears the code after three wrong tries, so the right one then accepts nothing', async () => {
    const { kv } = await held();
    const code = acceptanceCode(SECRET, MESSAGE);
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, wrong, later(1))).toMatchObject({
      outcome: 'wrong',
      triesLeft: 2,
    });
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, wrong, later(1))).toMatchObject({
      outcome: 'wrong',
      triesLeft: 1,
    });
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, wrong, later(1))).toMatchObject({
      outcome: 'locked',
    });
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, code, later(1))).toEqual({
      outcome: 'none',
    });
  });

  it('answers a code after 5 minutes as expired and accepts nothing', async () => {
    const { kv, at } = await held();
    at(6);
    const code = acceptanceCode(SECRET, MESSAGE);
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, code, later(6))).toEqual({
      outcome: 'expired',
      quoteId: CHAT.quoteId,
    });
    expect(await checkAcceptanceCode(kv, SECRET, CHAT, code, later(6))).toEqual({
      outcome: 'none',
    });
  });

  it('reads six digits as a code, spaces allowed, and nothing else', () => {
    expect(codeOf('123456')).toBe('123456');
    expect(codeOf(' 123 456 ')).toBe('123456');
    expect(codeOf('12345')).toBeNull();
    expect(codeOf('1234567')).toBeNull();
    expect(codeOf('code 123456')).toBeNull();
    expect(codeOf(null)).toBeNull();
  });

  it('asks for a code from ₹2,00,000 of grand total, on the stored digits', () => {
    expect(needsAcceptanceCode('199999.99')).toBe(false);
    expect(needsAcceptanceCode('200000.00')).toBe(true);
    expect(needsAcceptanceCode('200000')).toBe(true);
    expect(needsAcceptanceCode('1250000.5')).toBe(true);
    expect(() => needsAcceptanceCode('-1')).toThrow();
  });
});
