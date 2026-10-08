// The notification centre's pure helpers (docs/03-roadmap-appendix/phase1.md §8.1): where a notice takes its
// person, shared by the centre, the push the notify worker sends and their tests. Browser code:
// types only from the contracts.
import type { NoticeType } from '@shakti/contracts';
import type { Route } from 'next';
import { customerHref } from './customers';
import { quoteHref } from './quotes';

/** What a notice's link is made from. */
export interface NoticeLinkFacts {
  type: NoticeType;
  entityId: number;
  accountId: string | null;
  quoteId: string | null;
}

/**
 * The screen the person acts on: their calling queue for a call that fell due (due calls come
 * first there), the quote for one about to lapse, their Agent Inbox for an enquiry passed to them
 * (where its interest and note are, and Done), and the customer's Account 360, in the notice's
 * company, for a lead given to them, a possible duplicate or a late first call.
 */
export function noticeHref(notice: NoticeLinkFacts): Route {
  switch (notice.type) {
    case 'call_due':
      return '/calling';
    case 'enquiry_routed':
      return '/inbox';
    case 'quote_expiring':
      return notice.quoteId === null ? '/quotes' : quoteHref(notice.entityId, notice.quoteId);
    default:
      return notice.accountId === null ? '/home' : customerHref(notice.accountId, notice.entityId);
  }
}

/** How often the bell asks for its count while the page is in view (DECISIONS 29-09-2026). */
export const BELL_POLL_MS = 15_000;
