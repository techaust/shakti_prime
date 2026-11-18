import { DomainError, newId, type DeliveredEvent, type Principal } from '@shakti/contracts';
import {
  acceptanceCodeWaits,
  acceptQuoteRemote,
  checkAcceptanceCode,
  dropAcceptanceCode,
  executeCommand,
  executeQuery,
  holdAcceptanceCode,
  needsAcceptanceCode,
  notifyEvent,
  readInboundFacts,
  readMilestoneSubject,
  recordWhatsAppHandOff,
  verifyQuoteButtonToken,
  type KeyValue,
  type Logger,
} from '@shakti/domain';
import { logger as appLogger } from '../../log';
import { deliverNoticeBatch } from '../notify/deliver-notices';
import { acceptedAnswer, codeAnswer, queueAnswer } from './answers';

/*
 * Accepting a quote on WhatsApp (docs/03-roadmap-appendix/phase2.md §7.1, PRD SAL-05), as the
 * platform (`system:workers`, which holds the platform-only `sales.quote.accept.remote` and
 * `messaging.process`): the press of a quote's Accept or Talk to us button, and the one-time code
 * a customer sends back for a large quote. Nothing is accepted without a button made with the
 * secret for this quote, this chat and this chat's number, on a quote still sent and within its
 * validity, and from ₹2,00,000 without the code sent on this chat. Every answer is a message on
 * the chat that the lead's owner sees there. Customer text is never logged: ids and outcomes only.
 */

export interface QuotePressDeps {
  /** `system:workers` of the event's company. */
  principal: Principal;
  keyValue: KeyValue;
  requestId: string;
  now: () => Date;
  /** `WHATSAPP_BUTTON_SECRET`; without it no button verifies and no code is made. */
  buttonSecret: string | undefined;
  logger?: Logger;
}

/** What came of a press or a code, for the logs and the tests. */
export type PressOutcome =
  | 'accepted'
  | 'already_accepted'
  | 'code_sent'
  | 'code_waiting'
  | 'code_unavailable'
  | 'code_wrong'
  | 'code_locked'
  | 'code_expired'
  | 'quote_expired'
  | 'handed_to_people'
  | 'not_customer'
  | 'unverified'
  | 'ignored';

/** Why a chat goes to people when the customer presses Talk to us, or no code can be sent. */
const ASKED_FOR_PEOPLE = 'request';

interface Chat {
  entityId: number;
  threadId: string;
  waId: string;
  accountId: string | null;
}

function scopeOf(deps: QuotePressDeps, entityId: number) {
  return { entityIds: [entityId], requestId: deps.requestId };
}

/**
 * The `messaging.button.pressed` worker: the pressed message's chat and button id, the button
 * checked against the secret, the quote, the chat and its number in constant time; Talk to us
 * hands the chat to people; Accept on a quote already accepted, or withdrawn because the customer
 * accepted another quote of the lead, answers that acceptance and its order; on a quote no longer
 * open otherwise it answers `quote_expired` and tells the lead's owner; below the code's value it
 * accepts (`whatsapp_reply`); from it, it sends the company's authentication template with a code
 * and waits for it, sending no second code while that one is valid. A press that verifies to
 * nothing (forged, of another chat or number, or no quote button at all) changes nothing.
 */
export async function handleQuotePress(
  event: DeliveredEvent,
  deps: QuotePressDeps,
): Promise<PressOutcome> {
  const log = deps.logger ?? appLogger;
  const messageId = String(event.payload.messageId);
  const facts = await executeQuery(
    deps.principal,
    scopeOf(deps, event.entityId),
    (ctx) => readInboundFacts(ctx, messageId),
    { name: 'messaging.press.facts' },
  );
  if (facts?.kind !== 'button' || facts.buttonPayload === null || facts.waId === null) {
    return 'ignored';
  }
  const secret = deps.buttonSecret ?? '';
  const pressed =
    secret === ''
      ? null
      : verifyQuoteButtonToken(secret, facts.buttonPayload, {
          threadId: facts.threadId,
          waId: facts.waId,
        });
  if (pressed === null) {
    log.log('info', 'messaging.press_unverified', { requestId: deps.requestId, messageId });
    return 'unverified';
  }
  const chat: Chat = {
    entityId: facts.entityId,
    threadId: facts.threadId,
    waId: facts.waId,
    accountId: facts.accountId,
  };
  if (pressed.action === 'talk') {
    await executeCommand(deps.principal, scopeOf(deps, chat.entityId), recordWhatsAppHandOff, {
      entityId: chat.entityId,
      threadId: chat.threadId,
      reason: ASKED_FOR_PEOPLE,
    });
    return 'handed_to_people';
  }
  const outcome = await acceptPressed(chat, pressed.quoteId, event.id, deps);
  log.log('info', 'messaging.press_answered', {
    requestId: deps.requestId,
    messageId,
    quoteId: pressed.quoteId,
    outcome,
  });
  return outcome;
}

/** Accept pressed on a verified button of the quote: answered by the quote as it is now. */
async function acceptPressed(
  chat: Chat,
  quoteId: string,
  noticeEventId: string,
  deps: QuotePressDeps,
): Promise<PressOutcome> {
  const subject = await readQuote(chat, quoteId, deps);
  if (subject === null) return 'unverified';
  if (subject.accountId !== chat.accountId) return 'not_customer';
  // Accepted, or withdrawn for another accepted quote: the acceptance answers its own order.
  if (subject.state === 'accepted' || subject.state === 'withdrawn') {
    return accept(chat, quoteId, subject.ref, 'whatsapp_reply', noticeEventId, deps);
  }
  if (!open(subject, deps.now())) {
    return quoteNoLongerOpen(chat, quoteId, subject.ref, noticeEventId, deps);
  }
  if (!needsAcceptanceCode(subject.grandTotal)) {
    return accept(chat, quoteId, subject.ref, 'whatsapp_reply', noticeEventId, deps);
  }
  // From the code's value: the code first, once while it is valid (a second press, or a double
  // tap, sends no other). Its hash is held before the message is queued, so a customer who
  // answers at once finds it waiting.
  const where = { entityId: chat.entityId, waId: chat.waId };
  const waiting = { ...where, threadId: chat.threadId, quoteId };
  if (await acceptanceCodeWaits(deps.keyValue, waiting, deps.now())) return 'code_waiting';
  const codeMessageId = newId();
  await holdAcceptanceCode(
    deps.keyValue,
    deps.buttonSecret ?? '',
    waiting,
    codeMessageId,
    deps.now(),
  );
  const queued = await queueAnswer(
    deps.principal,
    deps.requestId,
    chat,
    { kind: 'acceptance_code' },
    codeMessageId,
  );
  if (queued.outcome === 'queued') return 'code_sent';
  // No code template, or the number stopped meanwhile: nothing waits, and a person follows up.
  await dropAcceptanceCode(deps.keyValue, where);
  if (queued.outcome === 'no_template') {
    await executeCommand(deps.principal, scopeOf(deps, chat.entityId), recordWhatsAppHandOff, {
      entityId: chat.entityId,
      threadId: chat.threadId,
      reason: ASKED_FOR_PEOPLE,
    });
  }
  return 'code_unavailable';
}

/**
 * A code the customer sent on a chat where one waits (the WhatsApp handler found it waiting): a
 * match accepts the quote (`whatsapp_otp`), a miss says how many tries are left, the last miss or
 * a lapsed code says to press Accept again. `messageId` is the code's own message, which names
 * the notice when the quote lapsed meanwhile.
 */
export async function handleCodeReply(
  chat: Chat,
  code: string,
  messageId: string,
  deps: QuotePressDeps,
): Promise<PressOutcome> {
  const secret = deps.buttonSecret ?? '';
  if (secret === '') return 'ignored';
  const check = await checkAcceptanceCode(deps.keyValue, secret, chat, code, deps.now());
  if (check.outcome === 'none') return 'ignored';
  if (check.outcome !== 'match') {
    await queueAnswer(deps.principal, deps.requestId, chat, {
      kind: 'text',
      body: codeAnswer(check),
    });
    return check.outcome === 'wrong'
      ? 'code_wrong'
      : check.outcome === 'locked'
        ? 'code_locked'
        : 'code_expired';
  }
  const subject = await readQuote(chat, check.quoteId, deps);
  if (subject === null) return 'unverified';
  if (subject.state !== 'accepted' && subject.state !== 'withdrawn' && !open(subject, deps.now())) {
    return quoteNoLongerOpen(chat, check.quoteId, subject.ref, messageId, deps);
  }
  return accept(chat, check.quoteId, subject.ref, 'whatsapp_otp', messageId, deps);
}

interface QuoteNow {
  accountId: string;
  ref: string;
  grandTotal: string;
  validUntil: Date | null;
  state: string;
}

function open(quote: QuoteNow, now: Date): boolean {
  return quote.state === 'sent' && quote.validUntil !== null && quote.validUntil >= now;
}

async function readQuote(
  chat: Chat,
  quoteId: string,
  deps: QuotePressDeps,
): Promise<QuoteNow | null> {
  return executeQuery(
    deps.principal,
    scopeOf(deps, chat.entityId),
    (ctx) =>
      readMilestoneSubject(ctx, {
        entityId: chat.entityId,
        milestone: 'quote_sent',
        subjectKind: 'quote',
        subjectId: quoteId,
        threadId: chat.threadId,
      }),
    { name: 'messaging.press.quote' },
  );
}

/**
 * The platform's acceptance (`sales.quote.accept_remote`), which checks every fact again under
 * the quote's lock (from the code's value only `whatsapp_otp` accepts) and makes one order however
 * many presses arrive; answered on the chat with the accepted quote and its order.
 */
async function accept(
  chat: Chat,
  quoteId: string,
  quoteNo: string,
  via: 'whatsapp_reply' | 'whatsapp_otp',
  noticeEventId: string,
  deps: QuotePressDeps,
): Promise<PressOutcome> {
  let accepted: { quoteNo: string; soNo: string; accepted: boolean };
  try {
    accepted = await executeCommand(
      deps.principal,
      scopeOf(deps, chat.entityId),
      acceptQuoteRemote,
      { entityId: chat.entityId, quoteId, threadId: chat.threadId, acceptedVia: via },
    );
  } catch (error) {
    const reason = error instanceof DomainError ? error.details?.reason : undefined;
    // Lapsed, or withdrawn for no accepted quote: no longer open.
    if (reason === 'quote_expired' || reason === 'quote_transition_not_allowed') {
      return quoteNoLongerOpen(chat, quoteId, quoteNo, noticeEventId, deps);
    }
    if (reason === 'whatsapp_quote_not_customer') return 'not_customer';
    throw error;
  }
  await queueAnswer(deps.principal, deps.requestId, chat, {
    kind: 'text',
    // The accepted quote's own number: a withdrawn quote's press names the one accepted.
    body: acceptedAnswer(accepted.quoteNo, accepted.soNo, !accepted.accepted),
  });
  return accepted.accepted ? 'accepted' : 'already_accepted';
}

/**
 * Accept on a quote no longer open: the company's `quote_expired` template (a new quote will
 * follow) and a notice to the lead's owner, once a quote.
 */
async function quoteNoLongerOpen(
  chat: Chat,
  quoteId: string,
  quoteNo: string,
  noticeEventId: string,
  deps: QuotePressDeps,
): Promise<PressOutcome> {
  await queueAnswer(deps.principal, deps.requestId, chat, { kind: 'quote_expired', quoteNo });
  const batch = await executeCommand(deps.principal, scopeOf(deps, chat.entityId), notifyEvent, {
    event: 'messaging.button.pressed',
    entityId: chat.entityId,
    eventId: noticeEventId,
    quoteId,
  });
  await deliverNoticeBatch(deps.principal, batch, { requestId: deps.requestId });
  return 'quote_expired';
}
