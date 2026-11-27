import { defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PROFORMA_MACHINE_STATES = ['issued', 'cancelled'] as const;
export type ProformaMachineState = (typeof PROFORMA_MACHINE_STATES)[number];
export type ProformaEvent = 'issue' | 'cancel';

/** What the proforma commands preload for the guards. */
export interface ProformaRecord {
  state: ProformaMachineState | null;
  /** The order's state when a proforma of it is issued. */
  orderState: string;
}

export interface ProformaParams {
  reason?: string | null;
}

/** The order states a proforma may be issued from: confirmed, and not yet closed or cancelled. */
export const PROFORMA_ORDER_STATES: readonly string[] = [
  'confirmed',
  'partially_dispatched',
  'dispatched',
  'invoiced',
];

const orderConfirmed: Guard<ProformaRecord, ProformaParams> = {
  description: 'the order is confirmed, and not closed or cancelled',
  check: (record) =>
    PROFORMA_ORDER_STATES.includes(record.orderState)
      ? undefined
      : { code: 'conflict', reason: 'proforma_order_not_confirmed' },
};

/**
 * A proforma (docs/03-roadmap-appendix/phase5.md §5, §6.1, question 3 (a)): issued from a
 * confirmed order with its lines and tax copied, and cancelled with a reason; its number stays
 * used either way.
 */
export const proformaMachine = defineMachine<
  ProformaMachineState,
  ProformaEvent,
  ProformaRecord,
  ProformaParams
>({
  name: 'proforma',
  title: 'Proforma',
  summary:
    '`proformas.state`. The proforma the BOS issues to ask for payment, per company and financial year with no gaps in its numbers; tax invoices, receipts and credit notes stay in Tally.',
  sources: [
    'docs/03-roadmap-appendix/phase5.md §5, §6.1, question 3 (a)',
    'PRD FIN-01',
    'DATABASE §6.7 `proformas`',
  ],
  states: PROFORMA_MACHINE_STATES,
  initial: 'issued',
  terminal: ['cancelled'],
  stored: { table: 'proformas', stateColumn: 'state' },
  transitions: [
    {
      from: 'new',
      event: 'issue',
      to: 'issued',
      permission: 'finance.proforma.write',
      scope: 'entity',
      guard: orderConfirmed,
      emits: 'finance.proforma.issued',
      effects: [
        {
          key: 'snapshot',
          description:
            "copy the order's lines, prices, HSN codes, tax rates and tax split, and its totals, exactly as the order holds them",
        },
        {
          key: 'number',
          description:
            "draw the next number of the company's `proforma` series for the financial year",
        },
      ],
      note: 'One proforma of an order is live at a time; a cancelled one stays beside the next.',
    },
    {
      from: ['issued'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'finance.proforma.write',
      scope: 'entity',
      guard: reasonGiven(),
      emits: 'finance.proforma.cancelled',
      effects: [
        { key: 'keep_number', description: 'the number stays used; the series never reuses it' },
      ],
    },
  ],
});
