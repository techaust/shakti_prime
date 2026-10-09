import type {
  ConvertingLeadDto,
  ConvertingPanel,
  NextActionDto,
  NextActionRule,
} from '@shakti/contracts';
import { QUOTE_EXPIRY_NOTICE_MS } from '../notifications/push-plan';

/**
 * The next-best-action list of the Lead Converter workspace (PRD TEL-03): rules only, no model.
 * A lead earns a row for each rule it meets:
 * - `callback_due`: the owner's open callback is due or overdue;
 * - `quote_expiring`: a draft or sent quote lapses within the notice window of the quote-expiry
 *   notice (`QUOTE_EXPIRY_NOTICE_MS`, one day); a quote that has already lapsed is expired, not
 *   about to expire, and an accepted, withdrawn or replaced one is settled;
 * - `order_held`: an order of the lead waits on the dealer credit check;
 * - `sizing_missing`: the lead is at Qualified or past it (it needs a quote) in a business line
 *   that is sized, and has no sizing from today's engine (an older one must be done again).
 *
 * Rows come most urgent rule first (the order of `RULE_ORDER`: a customer waiting for a call, a
 * quote about to lapse, money held, then housekeeping), within a rule the earliest time first
 * (the longest wait first for a missing sizing), and ties by customer name, then lead, so the
 * list never reshuffles between two reads of the same facts.
 */
export const RULE_ORDER: readonly NextActionRule[] = [
  'callback_due',
  'quote_expiring',
  'order_held',
  'sizing_missing',
];

/** The panel of the workspace each rule opens the lead at. */
export const RULE_PANEL: Record<NextActionRule, ConvertingPanel> = {
  callback_due: 'calls',
  quote_expiring: 'quote',
  order_held: 'order',
  sizing_missing: 'sizing',
};

/** Business lines that are not sized: a dealer orders from the price list, not from a sizing. */
const UNSIZED_SEGMENTS: readonly string[] = ['dealer_wholesale'];

type Facts = Pick<
  ConvertingLeadDto,
  | 'opportunityId'
  | 'entityId'
  | 'customerName'
  | 'segment'
  | 'state'
  | 'needsQuote'
  | 'stageSince'
  | 'nextCall'
  | 'sizing'
  | 'quote'
  | 'heldOrder'
>;

/** The time a rule is about, as epoch milliseconds, or null for the sizing rule. */
function when(lead: Facts, rule: NextActionRule): number | null {
  switch (rule) {
    case 'callback_due':
      return lead.nextCall === null ? null : Date.parse(lead.nextCall.dueAt);
    case 'quote_expiring':
      return lead.quote === null ? null : Date.parse(lead.quote.validUntil);
    case 'order_held':
      return lead.heldOrder === null ? null : Date.parse(lead.heldOrder.heldAt);
    case 'sizing_missing':
      return null;
  }
}

/** The rules a lead meets at `now`. Only open leads are worked, so any other state meets none. */
export function rulesMet(lead: Facts, now: Date): NextActionRule[] {
  if (lead.state !== 'open') return [];
  const t = now.getTime();
  const met: NextActionRule[] = [];
  const call = when(lead, 'callback_due');
  if (call !== null && call <= t) met.push('callback_due');
  const lapse = when(lead, 'quote_expiring');
  if (
    lapse !== null &&
    lead.quote !== null &&
    (lead.quote.state === 'draft' || lead.quote.state === 'sent') &&
    lapse > t &&
    lapse <= t + QUOTE_EXPIRY_NOTICE_MS
  ) {
    met.push('quote_expiring');
  }
  if (lead.heldOrder !== null) met.push('order_held');
  if (lead.needsQuote && !UNSIZED_SEGMENTS.includes(lead.segment) && lead.sizing !== 'current') {
    met.push('sizing_missing');
  }
  return met;
}

/** The converter's list for these leads at `now`. */
export function nextBestActions(leads: readonly Facts[], now: Date): NextActionDto[] {
  const rows = leads.flatMap((lead) =>
    rulesMet(lead, now).map((rule) => ({
      lead,
      rule,
      // A missing sizing waits from when the lead reached its stage.
      at: when(lead, rule) ?? (rule === 'sizing_missing' ? Date.parse(lead.stageSince) : null),
    })),
  );
  rows.sort(
    (a, b) =>
      RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule) ||
      (a.at ?? 0) - (b.at ?? 0) ||
      a.lead.customerName.localeCompare(b.lead.customerName, 'en') ||
      (a.lead.opportunityId < b.lead.opportunityId
        ? -1
        : a.lead.opportunityId > b.lead.opportunityId
          ? 1
          : 0),
  );
  return rows.map(({ lead, rule }) => ({
    opportunityId: lead.opportunityId,
    entityId: lead.entityId,
    customerName: lead.customerName,
    rule,
    panel: RULE_PANEL[rule],
    at: rule === 'sizing_missing' ? null : new Date(when(lead, rule) ?? 0).toISOString(),
  }));
}
