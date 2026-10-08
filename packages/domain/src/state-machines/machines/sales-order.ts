import type { AccountType, Money } from '@shakti/contracts';
import { toPaise } from '../../money/paise';
import { creditCheck, type CreditFacts, type CreditRelease } from '../../sales/credit-check';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const SALES_ORDER_STATES = [
  'draft',
  'confirmed',
  'partially_dispatched',
  'dispatched',
  'invoiced',
  'closed',
  'cancelled',
] as const;
export type SalesOrderMachineState = (typeof SALES_ORDER_STATES)[number];
export type SalesOrderEvent =
  | 'create'
  | 'credit.hold'
  | 'credit.release'
  | 'confirm'
  | 'dispatch.partial'
  | 'dispatch.complete'
  | 'invoice'
  | 'close'
  | 'cancel';

export interface SalesOrderRecord {
  state: SalesOrderMachineState | null;
  accountType: AccountType;
  /** The order comes from a quote in state `accepted`. */
  fromAcceptedQuote: boolean;
  credit: CreditFacts;
  /** `credit_held_at` is set: the credit check held a confirmation and no release has cleared it. */
  creditHeld: boolean;
  /** `credit_release_by` and its reason, set by the `credit.release` event. */
  creditRelease: CreditRelease | null;
  /** A dispatch of this order exists that is not cancelled. */
  hasActiveDispatch: boolean;
  /** A Tally sales voucher is linked to the order. */
  voucherLinked: boolean;
  /** What remains to be paid on the order. */
  balanceDue: Money;
}

export interface SalesOrderParams {
  reason?: string | null;
}

type G = Guard<SalesOrderRecord, SalesOrderParams>;

const quoteOrDealer: G = {
  description: 'from an accepted quote, or a dealer account ordering without a quote',
  check: (record) =>
    record.fromAcceptedQuote || record.accountType === 'dealer'
      ? undefined
      : { code: 'conflict', reason: 'order_needs_accepted_quote' },
};

const creditClear: G = {
  description:
    'dealer credit check: block when outstanding + confirmed-unpaid orders + this order > `credit_limit`, or the oldest unpaid invoice is older than `credit_days`, or no limit is set; the block names the limit or the invoice; passes when an Executive set `credit_release_by` with a reason',
  check: (record, ctx) => {
    const outcome = creditCheck(record.credit, record.creditRelease, ctx.now);
    return outcome.blocked ? outcome.failure : undefined;
  },
};

const creditBlocked: G = {
  description:
    'the dealer credit check blocks the confirmation and no release lets it through (the hold keeps the rule and its facts)',
  check: (record, ctx) =>
    creditCheck(record.credit, record.creditRelease, ctx.now).blocked
      ? undefined
      : { code: 'conflict', reason: 'order_credit_clear' },
};

const creditHeld: G = {
  description: 'the order is held for credit (`credit_held_at` is set)',
  check: (record) =>
    record.creditHeld ? undefined : { code: 'conflict', reason: 'order_not_held' },
};

const voucherLinked: G = {
  description: 'a Tally sales voucher is linked',
  check: (record) =>
    record.voucherLinked ? undefined : { code: 'conflict', reason: 'order_voucher_missing' },
};

const paymentsSettled: G = {
  description: 'payments are settled (nothing remains due)',
  check: (record) =>
    toPaise(record.balanceDue) === 0n
      ? undefined
      : { code: 'conflict', reason: 'order_payments_outstanding' },
};

const nothingDispatched: G = {
  description: 'nothing is dispatched (no dispatch other than a cancelled one)',
  check: (record) =>
    record.hasActiveDispatch ? { code: 'conflict', reason: 'order_already_dispatched' } : undefined,
};

/**
 * Sales order (design §7.4, docs/03-roadmap-appendix/phase1.md §8.3). Exposure is per entity; `dealer_terms`
 * and `dealer_outstanding` are keyed by account and entity. Phase 1 builds create, the credit
 * hold and release, confirm and cancel; the dispatch moves wait for the stock ledger (Phase 3),
 * invoice and close for the Tally link (Phase 5).
 */
export const salesOrderMachine = defineMachine<
  SalesOrderMachineState,
  SalesOrderEvent,
  SalesOrderRecord,
  SalesOrderParams
>({
  name: 'sales_order',
  title: 'Sales order',
  summary:
    '`sales_orders.state`. The backbone of fulfilment: reservations, dispatches, proforma, payment milestones and projects hang off it.',
  sources: [
    'docs/03-roadmap-appendix/backend-weeks-3-5.md §7.4',
    'docs/03-roadmap-appendix/phase1.md §8.3',
    'BLUEPRINT §8.3',
    'PRD SAL-06, SAL-07',
  ],
  states: SALES_ORDER_STATES,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  stored: { table: 'sales_orders', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  stateNotes: {
    partially_dispatched: 'Some lines delivered; backorders stay open.',
    invoiced: 'Linked to the Tally sales voucher (Phase 5 sync).',
  },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'sales.order.create',
      system: true,
      guard: quoteOrDealer,
      emits: 'sales.order.created',
      effects: [
        {
          key: 'copy_lines',
          description:
            "from a quote, its lines copied with their prices and tax snapshot; a dealer's order priced from the live list of the dealer's tier and taxed by the engine",
        },
        { key: 'number', description: '`so_no` from the series' },
      ],
      note: '`sales.quote.accept` makes the draft as the person who records the signed copy (the platform will, for a WhatsApp acceptance in Phase 2); `sales.order.create` makes a dealer order without a quote.',
    },
    {
      from: ['draft'],
      event: 'credit.hold',
      to: 'draft',
      permission: 'sales.order.confirm',
      guard: creditBlocked,
      emits: 'sales.order.credit_held',
      effects: [
        {
          key: 'set_credit_hold',
          description:
            'keep `credit_held_at`, the rule and the facts its sentence names (the limit and the exposure, or the overdue invoice); the order stays a draft',
        },
      ],
      note: 'Fired by `sales.order.confirm` in place of `confirm` when the credit check blocks: a hold is kept, not refused.',
      proposed: true,
    },
    {
      from: ['draft'],
      event: 'credit.release',
      to: 'draft',
      permission: 'sales.credit.release',
      scope: 'all',
      guard: allOf(reasonGiven(), creditHeld),
      emits: 'sales.order.credit_released',
      effects: [
        {
          key: 'set_credit_release',
          description:
            'set `credit_release_by` to the Executive and keep the reason (audited); clear the hold, so the next confirmation passes the check once',
        },
      ],
    },
    {
      from: ['draft'],
      event: 'confirm',
      to: 'confirmed',
      permission: 'sales.order.confirm',
      guard: creditClear,
      emits: 'sales.order.confirmed',
      effects: [
        {
          key: 'win_lead',
          description:
            'an order of a lead wins the lead (`crm.opportunity.win`), and ends its open callbacks and nurture calls',
        },
        {
          key: 'accrue_commission',
          description:
            "the lead's referral partner earns commission by the partner's rule in force that day (`commission_accruals`)",
        },
        { key: 'request_reservations', description: 'reservations requested (Phase 3)' },
      ],
    },
    {
      from: ['confirmed', 'partially_dispatched'],
      event: 'dispatch.partial',
      to: 'partially_dispatched',
      permission: null,
      system: true,
      note: 'Driven by the dispatch machine (Phase 3) when a dispatch is delivered and lines remain; the e-way bill gate is on the dispatch.',
    },
    {
      from: ['confirmed', 'partially_dispatched'],
      event: 'dispatch.complete',
      to: 'dispatched',
      permission: null,
      system: true,
      note: 'Driven by the dispatch machine when the last line is delivered.',
    },
    {
      from: ['dispatched'],
      event: 'invoice',
      to: 'invoiced',
      permission: null,
      system: true,
      guard: voucherLinked,
      note: 'Tally sync (Phase 5) links the voucher by Buyer Order No.',
    },
    {
      from: ['invoiced'],
      event: 'close',
      to: 'closed',
      permission: 'sales.order.confirm',
      guard: paymentsSettled,
    },
    {
      from: ['draft', 'confirmed'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'sales.order.cancel',
      scope: 'entity',
      guard: allOf(reasonGiven(), nothingDispatched),
      emits: 'sales.order.cancelled',
      effects: [
        {
          key: 'cancel_commission',
          description: "a confirmed order's commission is cancelled; the lead stays won",
        },
        { key: 'release_reservations', description: 'release reservations (Phase 3)' },
      ],
    },
  ],
});
