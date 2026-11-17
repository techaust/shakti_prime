import { newId, type Principal, type WhatsAppAnswerQueued } from '@shakti/contracts';
import {
  executeCommand,
  queueWhatsAppAnswer,
  WORKSHOP_DEFAULTS,
  type StatusLine,
} from '@shakti/domain';
import { createTranslator } from 'next-intl';
import en from '../../../messages/en.json';
import { formatDate, formatRupees } from '../../print/format';

/*
 * The platform's own answers on a customer's WhatsApp chat (docs/03-roadmap-appendix/phase2.md
 * §7.1): fixed sentences from the message catalogue with the customer's own records filled in,
 * never a model's words. A worker has no person's locale; the catalogue is English (ADR 0014).
 * Amounts and dates are formatted by the print formatters from the stored values, never computed.
 */

/** The catalogue's answers. */
export function answerWords() {
  return createTranslator({ locale: 'en', messages: en, namespace: 'whatsappAnswers' });
}

type Words = ReturnType<typeof answerWords>;

const QUOTE_STATES = {
  sent: 'quoteStates.sent',
  accepted: 'quoteStates.accepted',
  expired: 'quoteStates.expired',
} as const;

const ORDER_STATES = {
  draft: 'orderStates.draft',
  confirmed: 'orderStates.confirmed',
  partially_dispatched: 'orderStates.partially_dispatched',
  dispatched: 'orderStates.dispatched',
  invoiced: 'orderStates.invoiced',
  closed: 'orderStates.closed',
  cancelled: 'orderStates.cancelled',
} as const;

function stateWords(t: Words, line: StatusLine): string {
  const key =
    line.kind === 'quote'
      ? QUOTE_STATES[line.state as keyof typeof QUOTE_STATES]
      : ORDER_STATES[line.state as keyof typeof ORDER_STATES];
  return key === undefined ? t('unknownState') : t(key);
}

/**
 * The STATUS answer (PRD WA-03): the customer's own quotes and orders in the company, newest
 * first, as `app.status_summary()` read them for the chat; a plain sentence when there are none.
 */
export function statusAnswer(lines: readonly StatusLine[]): string {
  const t = answerWords();
  if (lines.length === 0) return t('statusNone');
  const rows = lines.map((line) => {
    const values = {
      ref: line.ref,
      state: stateWords(t, line),
      total: formatRupees(line.grandTotal),
    };
    if (line.kind === 'order') return t('statusOrder', values);
    return line.state === 'sent' && line.validUntil !== null
      ? t('statusQuoteOpen', { ...values, date: formatDate(line.validUntil) })
      : t('statusQuote', values);
  });
  return [t('statusHeading'), ...rows].join('\n');
}

/** A quote accepted on WhatsApp, or pressed again after it was. */
export function acceptedAnswer(quoteNo: string, soNo: string, already: boolean): string {
  const t = answerWords();
  return already ? t('alreadyAccepted', { quoteNo, soNo }) : t('accepted', { quoteNo, soNo });
}

/** A code that did not match, that missed too often, or that lapsed. */
export function codeAnswer(
  outcome: { outcome: 'wrong'; triesLeft: number } | { outcome: 'locked' | 'expired' },
): string {
  const t = answerWords();
  if (outcome.outcome === 'wrong') return t('codeWrong', { left: outcome.triesLeft });
  if (outcome.outcome === 'locked') {
    return t('codeLocked', { tries: WORKSHOP_DEFAULTS.whatsapp.otpTries });
  }
  return t('codeExpired');
}

/** What an answer is: a text, the one-time code, or the answer on a quote no longer open. */
export type Answer =
  | { kind: 'text'; body: string }
  | { kind: 'acceptance_code' }
  | { kind: 'quote_expired'; quoteNo: string };

/**
 * Queues an answer on the chat as the platform (`messaging.answer.queue`); the messaging worker
 * checks and sends it. `messageId` may be given (the code is made from it).
 */
export function queueAnswer(
  principal: Principal,
  requestId: string,
  chat: { entityId: number; threadId: string },
  answer: Answer,
  messageId: string = newId(),
): Promise<WhatsAppAnswerQueued> {
  return executeCommand(
    principal,
    { entityIds: [chat.entityId], requestId },
    queueWhatsAppAnswer,
    { entityId: chat.entityId, threadId: chat.threadId, messageId, answer },
  );
}
