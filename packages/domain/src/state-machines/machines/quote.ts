import type { Segment } from '@shakti/contracts';
import { istCalendarDate } from '../../numbering/financial-year';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const QUOTE_STATES = [
  'draft',
  'sent',
  'accepted',
  'expired',
  'superseded',
  'withdrawn',
] as const;
export type QuoteMachineState = (typeof QUOTE_STATES)[number];
export type QuoteEvent = 'create' | 'send' | 'accept' | 'expire' | 'requote' | 'withdraw';

export const QUOTE_ACCEPTED_VIA = ['whatsapp_reply', 'whatsapp_otp', 'signed_upload'] as const;
export type QuoteAcceptedVia = (typeof QUOTE_ACCEPTED_VIA)[number];

export interface QuoteRecord {
  state: QuoteMachineState | null;
  segment: Segment;
  /**
   * The customer's price tier: their own (`accounts.tier_id`), else the workshop map by customer
   * type (PRICE-1, empty until the workshop answers); null when neither gives one.
   */
  tierId: string | null;
  /** The live price list of the tier for the lead's company, else for the group, if any. */
  priceListId: string | null;
  /** TDH and kW sizing is complete (required for pumps and rooftop). */
  sizingComplete: boolean;
  /** The chosen pump runs inside its curve at the sized duty point. */
  pumpCurveInBounds: boolean;
  /** Sanctioned-load and DCR rules are met (rooftop subsidy). */
  dcrRuleMet: boolean;
  pdfFileId: string | null;
  /** End of day IST, 15 calendar days after creation (`quoteValidUntil`). */
  validUntil: Date | null;
}

export interface QuoteParams {
  acceptedVia?: QuoteAcceptedVia | null;
  reason?: string | null;
}

type G = Guard<QuoteRecord, QuoteParams>;

/** India has one time zone and no daylight saving: a fixed offset is exact. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * `valid_until` of a quote created at `createdAt`: the created calendar date in IST plus the
 * validity days, at the last millisecond of that day in IST (BLUEPRINT §8.3, design §7.3).
 */
export function quoteValidUntil(
  createdAt: Date,
  validityDays: number = WORKSHOP_DEFAULTS.quote.validityDays,
): Date {
  const [year = 0, month = 1, day = 1] = istCalendarDate(createdAt).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + validityDays, 23, 59, 59, 999) - IST_OFFSET_MS);
}

function stillValid(record: QuoteRecord, now: Date): boolean {
  return record.validUntil !== null && now.getTime() <= record.validUntil.getTime();
}

const SIZED_SEGMENTS: readonly Segment[] = ['farmer_pumps', 'residential_rooftop'];

const priceListReady: G = {
  description:
    'the customer has a price tier (their own, else the workshop map by customer type) and a live price list exists for the tier in the company or the group',
  check: (record) =>
    record.tierId === null
      ? { code: 'validation_failed', reason: 'quote_tier_missing' }
      : record.priceListId === null
        ? { code: 'validation_failed', reason: 'quote_price_list_missing' }
        : undefined,
};

const sized: G = {
  description: 'sizing is complete for the pump and rooftop segments',
  check: (record) =>
    SIZED_SEGMENTS.includes(record.segment) && !record.sizingComplete
      ? { code: 'validation_failed', reason: 'sizing_incomplete' }
      : undefined,
};

const pumpCurve: G = {
  description: 'the pump runs inside its curve (pump segment)',
  check: (record) =>
    record.segment === 'farmer_pumps' && !record.pumpCurveInBounds
      ? { code: 'validation_failed', reason: 'pump_curve_out_of_bounds' }
      : undefined,
};

const dcrRule: G = {
  description: 'the sanctioned-load and DCR rules are met where they apply (rooftop subsidy)',
  check: (record) =>
    record.dcrRuleMet ? undefined : { code: 'validation_failed', reason: 'dcr_rule_failed' },
};

const pdfRendered: G = {
  description: 'the PDF is rendered',
  check: (record) =>
    record.pdfFileId === null ? { code: 'conflict', reason: 'quote_pdf_missing' } : undefined,
};

const notExpired: G = {
  description:
    'now ≤ `valid_until` (acceptance after expiry answers `quote_expired` and the app offers a re-quote)',
  check: (record, { now }) =>
    stillValid(record, now) ? undefined : { code: 'conflict', reason: 'quote_expired' },
};

const acceptedViaRecorded: G = {
  description: '`accepted_via` is recorded (WhatsApp reply, WhatsApp OTP or signed upload)',
  check: (_record, { params }) =>
    params.acceptedVia
      ? undefined
      : { code: 'validation_failed', reason: 'quote_acceptance_missing' },
};

const pastValidity: G = {
  description: 'now > `valid_until`',
  check: (record, { now }) =>
    stillValid(record, now) ? { code: 'conflict', reason: 'quote_still_valid' } : undefined,
};

/** Quote (design §7.3). Prices on lines are never accepted from input (SAL-03). */
export const quoteMachine = defineMachine<QuoteMachineState, QuoteEvent, QuoteRecord, QuoteParams>({
  name: 'quote',
  title: 'Quote',
  summary:
    '`quotes.state`. Lines snapshot Price Master prices and the tax-rate version at creation.',
  sources: [
    'docs/03-roadmap-appendix/backend-weeks-3-5.md §7.3',
    'docs/03-roadmap-appendix/phase1.md §7.3',
    'BLUEPRINT §8.3',
    'PRD SAL-03, SAL-04, SAL-05',
  ],
  states: QUOTE_STATES,
  initial: 'draft',
  terminal: ['accepted', 'superseded', 'withdrawn'],
  stored: { table: 'quotes', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  stateNotes: {
    expired: 'Past `valid_until`; only a re-quote at current prices continues the sale.',
    superseded: 'Replaced by a newer quote; the old one is kept in `quote_versions`.',
  },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'sales.quote.create',
      emits: 'sales.quote.created',
      guard: allOf(priceListReady, sized, pumpCurve, dcrRule),
      effects: [
        { key: 'price_lines', description: 'lines priced from the price list (never from input)' },
        {
          key: 'compute_tax',
          description: 'tax computed by the tax engine and snapshotted per line',
        },
        {
          key: 'set_valid_until',
          description: `\`valid_until\` = created date + ${String(WORKSHOP_DEFAULTS.quote.validityDays)} calendar days, end of day IST`,
        },
        { key: 'number', description: '`quote_no` from the series' },
      ],
    },
    {
      from: ['draft'],
      event: 'send',
      to: 'sent',
      permission: 'sales.quote.send',
      emits: 'sales.quote.sent',
      guard: allOf(pdfRendered, notExpired),
      effects: [
        { key: 'whatsapp_dispatch', description: 'send the PDF on WhatsApp (worker on the event)' },
      ],
    },
    {
      from: ['sent'],
      event: 'accept',
      to: 'accepted',
      permission: 'sales.quote.send',
      system: true,
      guard: allOf(notExpired, acceptedViaRecorded),
      effects: [{ key: 'create_order_draft', description: 'create the sales order draft' }],
    },
    {
      from: ['draft', 'sent'],
      event: 'expire',
      to: 'expired',
      permission: null,
      system: true,
      emits: 'sales.quote.expired',
      guard: pastValidity,
      note: 'A daily job, plus a lazy check when the quote is read.',
    },
    {
      from: ['draft', 'sent', 'expired'],
      event: 'requote',
      to: 'superseded',
      permission: 'sales.quote.create',
      emits: 'sales.quote.superseded',
      effects: [
        { key: 'new_quote', description: 'a new quote at current prices and current tax rates' },
        { key: 'snapshot_version', description: '`quote_versions` snapshot of the old quote' },
      ],
    },
    {
      from: ['draft', 'sent'],
      event: 'withdraw',
      to: 'withdrawn',
      permission: 'sales.quote.send',
      emits: 'sales.quote.withdrawn',
      guard: reasonGiven(),
    },
  ],
});
