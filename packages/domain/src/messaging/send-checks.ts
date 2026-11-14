import type { MessagingRefusal, MessagingRetryable } from '@shakti/contracts';
import { WORKSHOP_DEFAULTS } from '../workshop-defaults';
import { filterOutbound, type OutputFilterRules } from './output-filter';

/** What `app.whatsapp_send_facts()` answers of a queued message, as the checks read it. */
export interface SendFacts {
  kind: string;
  status: string;
  sendAttempted: boolean;
  templateName: string | null;
  templateParams: readonly string[];
  body: string | null;
  windowOpenUntil: Date | null;
  optedOut: boolean;
  /** The message is the confirmation of the number's last STOP. */
  confirmation: boolean;
  templateCategory: string | null;
  templateStatus: string | null;
  sentLastHour: number;
}

/**
 * The portfolio's budget as the worker found it: business-initiated conversations to distinct
 * customers in the rolling 24 hours, the limit Meta reports, and whether this customer already
 * counts in it (a second message to them opens no new conversation).
 */
export interface SendBudget {
  used: number;
  limit: number;
  alreadyCounted: boolean;
}

export type SendDecision =
  | { kind: 'skip' }
  | { kind: 'refuse'; refusal: MessagingRefusal }
  | { kind: 'wait'; until: MessagingRetryable }
  /** Send it; `businessInitiated` when the window is closed, so it counts in the budget. */
  | { kind: 'send'; businessInitiated: boolean };

export interface SendRules extends OutputFilterRules {
  marketingHoldShare: number;
  messagesPerThreadHour: number;
}

export const DEFAULT_SEND_RULES = {
  marketingHoldShare: WORKSHOP_DEFAULTS.whatsapp.marketingHoldShare,
  messagesPerThreadHour: WORKSHOP_DEFAULTS.whatsapp.messagesPerThreadHour,
  linkHosts: WORKSHOP_DEFAULTS.whatsapp.linkHosts,
};

/**
 * Whether the messaging worker may send a queued WhatsApp message now (docs/06-api.md §6, design
 * phase2 §6.1), its checks in the design's order, the first that fails deciding:
 * 1. a message no longer queued, or already handed to Meta once, is skipped (never sent twice);
 * 2. a number that opted out is refused, but for the one confirmation of its STOP;
 * 3. a free-text message outside the customer's 24-hour window is refused;
 * 4. a template Meta has not approved (or the company never registered) is refused;
 * 5. a business-initiated message (window closed) needs room in the portfolio's budget: a
 *    marketing template waits once the hold share is used, any other is refused at the limit;
 * 6. the output filter (length, links, identity and bank numbers, phones but the company's);
 * 7. at most `messagesPerThreadHour` on a thread in an hour, or it waits and is tried again.
 * Pure: the worker reads the facts and the budget and acts on the answer.
 */
export function decideSend(
  facts: SendFacts,
  budget: SendBudget,
  now: Date,
  rules: SendRules,
): SendDecision {
  if (facts.status !== 'queued' || facts.sendAttempted) return { kind: 'skip' };
  if (facts.optedOut && !(facts.kind === 'system' && facts.confirmation)) {
    return { kind: 'refuse', refusal: 'opted_out' };
  }
  const windowOpen = facts.windowOpenUntil !== null && facts.windowOpenUntil > now;
  if (facts.kind === 'text' && !windowOpen) return { kind: 'refuse', refusal: 'window_closed' };
  if (facts.kind !== 'text' && facts.templateStatus !== 'approved') {
    return { kind: 'refuse', refusal: 'template_not_approved' };
  }
  const businessInitiated = !windowOpen;
  if (businessInitiated && !budget.alreadyCounted) {
    const marketing = facts.templateCategory === 'marketing';
    if (marketing && budget.used >= Math.floor(budget.limit * rules.marketingHoldShare)) {
      return { kind: 'wait', until: 'marketing_held' };
    }
    if (budget.used >= budget.limit) return { kind: 'refuse', refusal: 'tier_budget_reached' };
  }
  const texts = facts.kind === 'text' ? [facts.body ?? ''] : [...facts.templateParams];
  if (!filterOutbound(texts, rules).ok) return { kind: 'refuse', refusal: 'output_filter' };
  if (facts.sentLastHour >= rules.messagesPerThreadHour) {
    return { kind: 'wait', until: 'rate_limited' };
  }
  return { kind: 'send', businessInitiated };
}
