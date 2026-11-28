// The notification centre's pure helpers (docs/03-roadmap-appendix/phase1.md §8.1): where a notice takes its
// person, shared by the centre, the push the notify worker sends and their tests. Browser code:
// types only from the contracts.
import type { NoticeType } from '@shakti/contracts';
import type { Route } from 'next';
import { customerHref } from './customers';
import { messagesHref } from './messaging/links';
import { orderHref } from './orders';
import { quoteHref } from './quotes';

/** What a notice's link is made from. */
export interface NoticeLinkFacts {
  type: NoticeType;
  entityId: number;
  accountId: string | null;
  quoteId: string | null;
  /** The record the notice is about; an order's page for a held order. */
  subjectId: string;
}

/**
 * The screen the person acts on: their calling queue for a call that fell due or a missed call's
 * callback (due calls come first there), the quote for one about to lapse, accepted, pressed on
 * WhatsApp after it lapsed (where its order is, or the re-quote), or sent on WhatsApp but not
 * delivered (where its PDF is), their Agent Inbox for an enquiry passed to them
 * (where its interest and note are, and Done), the order for one held for credit (where the
 * Executive releases it) and for an order whose loan was turned down (where its Loan tab is), the chat for a WhatsApp customer waiting for a reply, and the customer's
 * Account 360, in the notice's
 * company, for a lead given to them, a possible duplicate or a late first call.
 */
export function noticeHref(notice: NoticeLinkFacts): Route {
  switch (notice.type) {
    case 'call_due':
    case 'missed_call':
      return '/calling';
    case 'enquiry_routed':
      return '/inbox';
    case 'order_credit_held':
    case 'loan_rejected':
      return orderHref(notice.entityId, notice.subjectId);
    case 'whatsapp_reply_waiting':
      return messagesHref(notice.entityId, notice.subjectId);
    case 'quote_expiring':
    case 'quote_accepted':
    case 'whatsapp_quote_expired':
    case 'whatsapp_quote_not_sent':
      return notice.quoteId === null ? '/quotes' : quoteHref(notice.entityId, notice.quoteId);
    default:
      return notice.accountId === null ? '/home' : customerHref(notice.accountId, notice.entityId);
  }
}

/** How often the bell asks for its count while the page is in view (DECISIONS 29-09-2026). */
export const BELL_POLL_MS = 15_000;
