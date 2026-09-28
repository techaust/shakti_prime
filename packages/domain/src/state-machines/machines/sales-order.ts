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
    'dealer credit check: block when outstanding + confirmed-unpaid orders + this order > `credit_limit`, or `oldest_overdue_days` > `credit_days`, or no limit is set; the block names the limit or the invoice; passes when an Executive set `credit_release_by` with a reason',
  check: (record) => {
    const outcome = creditCheck(record.credit, record.creditRelease);
    return outcome.blocked ? outcome.failure : undefined;
  },
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

/** Sales order (design §7.4). Exposure is per entity; `dealer_outstanding` is keyed by account and entity. */
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
  sources: ['docs/design/backend-weeks-3-5.md §7.4', 'BLUEPRINT §8.3', 'PRD SAL-06, SAL-07'],
  states: SALES_ORDER_STATES,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
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
      effects: [
        { key: 'copy_lines', description: 'lines copied with their tax snapshot' },
        { key: 'number', description: '`so_no` from the series' },
      ],
      note: 'The platform creates the draft when a quote is accepted; a dealer order is created by a person.',
    },
    {
      from: ['draft'],
      event: 'credit.release',
      to: 'draft',
      permission: 'sales.credit.release',
      guard: reasonGiven(),
      effects: [
        {
          key: 'set_credit_release',
          description: 'set `credit_release_by` to the Executive and keep the reason (audited)',
        },
      ],
      proposed: true,
    },
    {
      from: ['draft'],
      event: 'confirm',
      to: 'confirmed',
      permission: 'sales.order.confirm',
      guard: creditClear,
      effects: [
        { key: 'request_reservations', description: 'reservations requested (Phase 3)' },
        { key: 'emit', description: 'event for the order-confirmed WhatsApp message' },
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
      guard: allOf(reasonGiven(), nothingDispatched),
      effects: [{ key: 'release_reservations', description: 'release reservations' }],
    },
  ],
});
