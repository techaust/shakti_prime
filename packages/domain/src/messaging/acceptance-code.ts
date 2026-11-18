import { createHmac, timingSafeEqual } from 'node:crypto';
import type { KeyValue } from '../ports/key-value';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';

// The one-time code that confirms accepting a large quote on WhatsApp (question 5 (a),
// docs/03-roadmap-appendix/phase2.md §7.1): a six-digit code sent with the company's
// authentication template, which the customer sends back on the same chat. The code is never
// stored or logged: it is made from the code message's own id under `WHATSAPP_BUTTON_SECRET` (the
// messaging worker makes it again as it sends), and the key-value store holds only a keyed hash of
// it, by chat and quote, with when it lapses; each try counts, and a code missed `otpTries` times
// or older than `otpMinutes` is cleared. Six digits are taken as a code only while one is valid. A plain hash of six digits could be reversed by trying
// all of them, so the hash is an HMAC under the same secret.

const RULES = WORKSHOP_DEFAULTS.whatsapp;
/**
 * How long the store keeps a code's entries. Only a code within its minutes is taken
 * (`codeWaiting`); the rest of the time lets a code checked as it lapses be answered as expired.
 */
const REMEMBER_SECONDS = RULES.otpMinutes * 60 * 3;
const PREFIX = 'whatsapp:acceptance-code';

/**
 * Where a code waits: the company and the customer's number, known before a message is recorded
 * (so the WhatsApp handler can mark a code as the platform's), then the chat's own id.
 */
export interface CodeChat {
  entityId: number;
  waId: string;
}

function secretOf(secret: string): string {
  if (secret.length === 0) throw new Error('the WhatsApp button secret is not set');
  return secret;
}

/** The six-digit code of the code message `messageId`. */
export function acceptanceCode(secret: string, messageId: string): string {
  const mac = createHmac('sha256', secretOf(secret))
    .update(`s3-acceptance-code|v1|${messageId}`)
    .digest();
  return (mac.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
}

function codeHash(secret: string, threadId: string, quoteId: string, code: string): string {
  return createHmac('sha256', secretOf(secret))
    .update(`s3-acceptance-code-hash|v1|${threadId}|${quoteId}|${code}`)
    .digest('base64url');
}

/** A customer's message read as a code: six digits, spaces allowed between them. */
export function codeOf(text: string | null): string | null {
  if (text === null) return null;
  const digits = text.replace(/\s+/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

const chatKey = (chat: CodeChat) => `${PREFIX}:chat:${String(chat.entityId)}:${chat.waId}`;
const codeKey = (threadId: string, quoteId: string) => `${PREFIX}:${threadId}:${quoteId}`;
const triesKey = (threadId: string, quoteId: string) => `${codeKey(threadId, quoteId)}:tries`;

interface Pending {
  threadId: string;
  quoteId: string;
}
interface Held {
  hash: string;
  lapsesAt: number;
}

function readJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    const read: unknown = JSON.parse(value);
    return typeof read === 'object' && read !== null ? (read as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pendingOf(value: string | null): Pending | null {
  const read = readJson(value);
  return typeof read?.threadId === 'string' && typeof read.quoteId === 'string'
    ? { threadId: read.threadId, quoteId: read.quoteId }
    : null;
}

function heldOf(value: string | null): Held | null {
  const read = readJson(value);
  return typeof read?.hash === 'string' && typeof read.lapsesAt === 'number'
    ? { hash: read.hash, lapsesAt: read.lapsesAt }
    : null;
}

/**
 * Holds the code of the code message `messageId` for the quote on the chat: its hash and when it
 * lapses, a fresh count of tries, and the chat's note that a code waits (which replaces an earlier
 * one on the chat).
 */
export async function holdAcceptanceCode(
  kv: KeyValue,
  secret: string,
  chat: CodeChat & Pending,
  messageId: string,
  now: Date,
): Promise<void> {
  const code = acceptanceCode(secret, messageId);
  const held: Held = {
    hash: codeHash(secret, chat.threadId, chat.quoteId, code),
    lapsesAt: now.getTime() + RULES.otpMinutes * 60_000,
  };
  await kv.del(triesKey(chat.threadId, chat.quoteId));
  await kv.set(codeKey(chat.threadId, chat.quoteId), JSON.stringify(held), REMEMBER_SECONDS);
  const pending: Pending = { threadId: chat.threadId, quoteId: chat.quoteId };
  await kv.set(chatKey(chat), JSON.stringify(pending), REMEMBER_SECONDS);
}

/** The quote a code waits for on the chat, or null when none was sent there lately. */
export async function pendingAcceptanceCode(kv: KeyValue, chat: CodeChat): Promise<Pending | null> {
  return pendingOf(await kv.get(chatKey(chat)));
}

/** The code waiting on the chat while it is still within its minutes, or null. */
async function validCode(
  kv: KeyValue,
  chat: CodeChat,
  now: Date,
): Promise<(Pending & { held: Held }) | null> {
  const pending = await pendingAcceptanceCode(kv, chat);
  if (pending === null) return null;
  const held = heldOf(await kv.get(codeKey(pending.threadId, pending.quoteId)));
  return held === null || now.getTime() > held.lapsesAt ? null : { ...pending, held };
}

/**
 * Whether a customer's six digits are taken as a code: only while a code waits on the chat within
 * its minutes (afterwards, and with none, they are the customer's own message for people, a PIN
 * code say); then whether they are that code, read without counting a try, so that only a matching
 * code is hidden from staff (a wrong guess is no secret).
 */
export async function codeWaiting(
  kv: KeyValue,
  secret: string,
  chat: CodeChat,
  code: string,
  now: Date,
): Promise<{ matches: boolean } | null> {
  const waiting = await validCode(kv, chat, now);
  if (waiting === null) return null;
  const expected = Buffer.from(waiting.held.hash);
  const given = Buffer.from(codeHash(secret, waiting.threadId, waiting.quoteId, code));
  return { matches: expected.length === given.length && timingSafeEqual(expected, given) };
}

/**
 * Whether a code for this quote waits on this chat within its minutes, so that another press of
 * Accept sends no second code (the first one still accepts).
 */
export async function acceptanceCodeWaits(
  kv: KeyValue,
  chat: CodeChat & Pending,
  now: Date,
): Promise<boolean> {
  const waiting = await validCode(kv, chat, now);
  return waiting?.threadId === chat.threadId && waiting.quoteId === chat.quoteId;
}

/** What came of a code the customer sent. */
export type CodeCheck =
  | { outcome: 'match'; quoteId: string }
  | { outcome: 'wrong'; quoteId: string; triesLeft: number }
  | { outcome: 'locked'; quoteId: string }
  | { outcome: 'expired'; quoteId: string }
  | { outcome: 'none' };

/** Clears the code waiting on the chat, when one cannot be sent after all. */
export async function dropAcceptanceCode(kv: KeyValue, chat: CodeChat): Promise<void> {
  const pending = await pendingAcceptanceCode(kv, chat);
  if (pending !== null) await clear(kv, chat, pending);
}

async function clear(kv: KeyValue, chat: CodeChat, pending: Pending): Promise<void> {
  await kv.del(chatKey(chat));
  await kv.del(codeKey(pending.threadId, pending.quoteId));
  await kv.del(triesKey(pending.threadId, pending.quoteId));
}

/**
 * Checks a code sent on the chat `threadId` against the one waiting there, in constant time: a
 * match clears it; a miss counts a try and clears it at the last; a code past its minutes is
 * expired and cleared; `none` when no code waits on this chat.
 */
export async function checkAcceptanceCode(
  kv: KeyValue,
  secret: string,
  chat: CodeChat & { threadId: string },
  code: string,
  now: Date,
): Promise<CodeCheck> {
  const pending = await pendingAcceptanceCode(kv, chat);
  if (pending?.threadId !== chat.threadId) return { outcome: 'none' };
  const held = heldOf(await kv.get(codeKey(pending.threadId, pending.quoteId)));
  if (held === null || now.getTime() > held.lapsesAt) {
    await clear(kv, chat, pending);
    return { outcome: 'expired', quoteId: pending.quoteId };
  }
  const tries = await kv.incr(triesKey(pending.threadId, pending.quoteId), REMEMBER_SECONDS);
  if (tries > RULES.otpTries) {
    await clear(kv, chat, pending);
    return { outcome: 'locked', quoteId: pending.quoteId };
  }
  const expected = Buffer.from(held.hash);
  const given = Buffer.from(codeHash(secret, pending.threadId, pending.quoteId, code));
  if (expected.length === given.length && timingSafeEqual(expected, given)) {
    await clear(kv, chat, pending);
    return { outcome: 'match', quoteId: pending.quoteId };
  }
  if (tries >= RULES.otpTries) {
    await clear(kv, chat, pending);
    return { outcome: 'locked', quoteId: pending.quoteId };
  }
  return { outcome: 'wrong', quoteId: pending.quoteId, triesLeft: RULES.otpTries - tries };
}

/**
 * Whether accepting a quote of this grand total (`numeric(14,2)` as stored) on WhatsApp also needs
 * the one-time code: at or above `WORKSHOP_DEFAULTS.whatsapp.otpFromRupees` (question 5 (a)).
 * Compared on the stored digits, so no rounding can move a quote across the line.
 */
export function needsAcceptanceCode(
  grandTotal: string,
  fromRupees: number = RULES.otpFromRupees,
): boolean {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(grandTotal.trim());
  if (match === null) throw new RangeError('the grand total is not a money string');
  const paise = BigInt(match[1] ?? '0') * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  return paise >= BigInt(fromRupees) * 100n;
}
