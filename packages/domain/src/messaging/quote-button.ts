import { createHmac, timingSafeEqual } from 'node:crypto';

// The two quick-reply buttons of a quote sent on WhatsApp (docs/03-roadmap-appendix/phase2.md
// §7.1): the template's first button accepts the quote, its second asks for a person. Each button's
// payload, which WhatsApp sends back when the customer presses it, is a token bound to the quote,
// the chat and the customer's number by an HMAC under `WHATSAPP_BUTTON_SECRET`, so a press counts
// only for that quote, from that number, on that chat: a press from another number or chat, or a
// token anyone made without the secret, verifies to nothing. The token holds no customer data: the
// quote's id and the MAC; the chat and the number come from the press itself.

/** What a quote's button does: accept the quote, or ask to talk to a person about it. */
export const QUOTE_BUTTON_ACTIONS = ['accept', 'talk'] as const;
export type QuoteButtonAction = (typeof QUOTE_BUTTON_ACTIONS)[number];

/** The order of the actions on the template's buttons, the payload of each in this order. */
const CODE: Record<QuoteButtonAction, string> = { accept: 'a', talk: 't' };
const VERSION = 'q1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAC = /^[A-Za-z0-9_-]{43}$/;

/** Who the button was sent to: the chat and the customer's number as WhatsApp names it. */
export interface QuoteButtonAudience {
  threadId: string;
  waId: string;
}

function mac(
  secret: string,
  action: QuoteButtonAction,
  quoteId: string,
  to: QuoteButtonAudience,
): string {
  if (secret.length === 0) throw new Error('the WhatsApp button secret is not set');
  return createHmac('sha256', secret)
    .update(`s3-quote-button|${VERSION}|${action}|${quoteId}|${to.threadId}|${to.waId}`)
    .digest('base64url');
}

/** The payload of one button of a quote sent on the chat `to.threadId` to the number `to.waId`. */
export function quoteButtonToken(
  secret: string,
  action: QuoteButtonAction,
  quoteId: string,
  to: QuoteButtonAudience,
): string {
  return `${VERSION}.${CODE[action]}.${quoteId}.${mac(secret, action, quoteId, to)}`;
}

/** The payloads of a quote's two buttons, in the template's order: Accept, then Talk to us. */
export function quoteButtonTokens(
  secret: string,
  quoteId: string,
  to: QuoteButtonAudience,
): string[] {
  return QUOTE_BUTTON_ACTIONS.map((action) => quoteButtonToken(secret, action, quoteId, to));
}

/**
 * The quote and the action a pressed button's payload stands for, when the payload is a quote
 * button made with `secret` for this chat and this number (`from`, the press's own); null for
 * anything else, compared in constant time.
 */
export function verifyQuoteButtonToken(
  secret: string,
  payload: string,
  from: QuoteButtonAudience,
): { action: QuoteButtonAction; quoteId: string } | null {
  if (secret.length === 0) return null;
  const [version, code, quoteId, given, ...rest] = payload.split('.');
  if (version !== VERSION || rest.length > 0 || quoteId === undefined || given === undefined) {
    return null;
  }
  const action = QUOTE_BUTTON_ACTIONS.find((a) => CODE[a] === code);
  if (action === undefined || !UUID.test(quoteId) || !MAC.test(given)) return null;
  const expected = Buffer.from(mac(secret, action, quoteId, from));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return { action, quoteId };
}
