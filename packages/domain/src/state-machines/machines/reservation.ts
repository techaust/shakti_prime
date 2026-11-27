import { RESERVATION_STATES, type ReservationState } from '@shakti/contracts';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export type { ReservationState };
export type ReservationEvent =
  'reserve' | 'fill' | 'extend' | 'release' | 'order_cancel' | 'move' | 'lapse' | 'pick';

export interface ReservationRecord {
  state: ReservationState | null;
  /** When it was extended, if it was: a reservation is extended once. */
  extendedAt: Date | null;
}

export interface ReservationParams {
  reason?: string | null;
}

type G = Guard<ReservationRecord, ReservationParams>;

const notExtended: G = {
  description: 'it has not been extended before',
  check: (record) =>
    record.extendedAt === null
      ? undefined
      : { code: 'conflict', reason: 'reservation_already_extended' },
};

const reasonOf: G = reasonGiven();

const RELEASE_EFFECT = {
  key: 'unreserve',
  description:
    "the quantity leaves its bin's `qty_reserved` (`app.stock_unreserve()`), and is back on order unless the order was cancelled",
};

/**
 * Stock set aside for an order line (docs/03-roadmap-appendix/phase3.md §7.1, question 3 (a)):
 * `reservations.state`. A reservation holds a quantity of one item in one storage bin until
 * `expires_at`; while active it counts in the bin's `stock_balances.qty_reserved`, which only
 * `app.stock_reserve()` and `app.stock_unreserve()` change. What confirmation could not reserve is
 * the line's backorder (`reservation_needs.qty_backordered`, `sales_order_lines.qty_backordered`).
 */
export const reservationMachine = defineMachine<
  ReservationState,
  ReservationEvent,
  ReservationRecord,
  ReservationParams
>({
  name: 'reservation',
  title: 'Reservation',
  summary:
    "`reservations.state`, written only by the reservation definers. An active reservation's quantity counts in its bin's `stock_balances.qty_reserved`, so it is not free stock and no outbound movement may take the bin below it (`app.stock_move()`, `stock_reserved_insufficient`). The hold and the reminder before it lapses are `WORKSHOP_DEFAULTS.stock.reservationHoldDays` and `.reservationReminderDays` (STOCK-4).",
  sources: [
    'docs/03-roadmap-appendix/phase3.md §2 question 3, §5, §7.1',
    'BLUEPRINT §8.4',
    'PRD INV-03, SAL-06',
  ],
  states: RESERVATION_STATES,
  stored: {
    table: 'reservations',
    stateColumn: 'state',
    changedAtColumn: 'state_changed_at',
  },
  initial: 'active',
  terminal: ['picked', 'released', 'lapsed'],
  stateNotes: {
    active: 'Held for the order line in its bin until it lapses, is picked, released or moved.',
    picked: "Taken into the hub's dispatch bin for a dispatch (D2).",
    released: 'Freed by a person, by the order’s cancellation, or moved to another hub.',
    lapsed: 'Freed when its hold ran out; the quantity is back on order.',
  },
  transitions: [
    {
      from: 'new',
      event: 'reserve',
      to: 'active',
      permission: 'sales.order.confirm',
      note: "Confirming an order reserves each line's free stock (a kit line, each component), hubs in the order's preferred order: those whose PIN codes list the site's first (`app.reserve_order()`).",
      effects: [
        {
          key: 'reserve',
          description:
            "free stock of the company's storage bins, bin by bin, is added to their `qty_reserved` (`app.stock_reserve()`); what is short is the line's backorder",
        },
      ],
    },
    {
      from: 'new',
      event: 'fill',
      to: 'active',
      permission: null,
      system: true,
      note: 'Stock entering a storage bin fills the backorders of that item and company in order of confirmation (`inventory.reservation.fill`, `app.fill_backorders()`).',
      emits: 'inventory.reservation.filled',
      effects: [
        {
          key: 'reserve',
          description: "the new free stock is added to its bins' `qty_reserved`",
        },
      ],
    },
    {
      from: ['active'],
      event: 'extend',
      to: 'active',
      permission: null,
      permissionByInput:
        '`inventory.stock.adjust` for the company (the Inventory Manager), or `sales.order.cancel` (the General Manager), named by the input',
      guard: allOf(notExtended, reasonOf),
      emits: 'inventory.reservation.extended',
      effects: [
        {
          key: 'extend',
          description:
            'held one more hold period from its date, with the reason; a new reminder is due before it',
        },
      ],
    },
    {
      from: ['active'],
      event: 'release',
      to: 'released',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      guard: reasonOf,
      emits: 'inventory.reservation.released',
      note: 'By hand, with a reason; the quantity waits behind the backorders already queued.',
      effects: [RELEASE_EFFECT],
    },
    {
      from: ['active'],
      event: 'order_cancel',
      to: 'released',
      permission: 'sales.order.cancel',
      scope: 'entity',
      guard: reasonOf,
      note: "The order's cancellation (the sales order machine's `release_reservations`): nothing of it stays backordered.",
      effects: [RELEASE_EFFECT],
    },
    {
      from: ['active'],
      event: 'move',
      to: 'released',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      emits: 'inventory.reservation.moved',
      note: "Reserved instead from another hub's free stock, whole or not at all, held to the same date (`app.reservation_move()`).",
      effects: [
        RELEASE_EFFECT,
        { key: 'reserve_elsewhere', description: 'new reservations in the other hub' },
      ],
    },
    {
      from: ['active'],
      event: 'lapse',
      to: 'lapsed',
      permission: null,
      system: true,
      emits: 'inventory.reservation.lapsed',
      note: 'The daily scan lapses a reservation past `expires_at`; the next backorder in the queue takes its stock (`inventory.reservation.scan`).',
      effects: [RELEASE_EFFECT],
    },
    {
      from: ['active'],
      event: 'pick',
      to: 'picked',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: "D2: picked by scan into the hub's dispatch bin.",
    },
  ],
});
