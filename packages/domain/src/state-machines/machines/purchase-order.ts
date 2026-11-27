import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const PURCHASE_ORDER_MACHINE_STATES = [
  'draft',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderMachineState = (typeof PURCHASE_ORDER_MACHINE_STATES)[number];
export type PurchaseOrderEvent =
  | 'create'
  | 'update'
  | 'approve'
  | 'send'
  | 'receive'
  | 'receive_all'
  | 'unreceive'
  | 'unreceive_part'
  | 'close'
  | 'cancel';

export interface PurchaseOrderRecord {
  state: PurchaseOrderMachineState | null;
  lineCount: number;
  /** Every line has its rate (`po_line_rates`) and its GST rate. */
  linesComplete: boolean;
  /**
   * The grand total including GST in paise, worked out by the tax engine with the vendor's state
   * and the place of supply; null until every line is complete. Read only by an approver, who
   * holds `procurement.rate.read`.
   */
  grandTotalPaise: bigint | null;
  /** Who last wrote the draft (the platform for a reorder draft no person has edited). */
  draftedBy: string;
}

export interface PurchaseOrderParams {
  reason?: string | null;
}

type G = Guard<PurchaseOrderRecord, PurchaseOrderParams>;

const EXECUTIVE = 'executive';

const hasLines: G = {
  description: 'the order has at least one line',
  check: (record) =>
    record.lineCount > 0 ? undefined : { code: 'validation_failed', reason: 'po_lines_missing' },
};

const linesComplete: G = {
  description: 'every line has its rate and its GST rate',
  check: (record) =>
    record.lineCount > 0 && record.linesComplete && record.grandTotalPaise !== null
      ? undefined
      : { code: 'validation_failed', reason: 'po_lines_incomplete' },
};

const notOwnDraft: G = {
  description: 'the approver did not draft the order, unless they are an Executive (question 5 (a))',
  check: (record, { actor }) =>
    actor.kind === 'principal' &&
    actor.principal.id === record.draftedBy &&
    actor.principal.roleKey !== EXECUTIVE
      ? { code: 'forbidden', reason: 'po_self_approval' }
      : undefined,
};

/** The limit below which a person other than an Executive approves, in paise. */
export const PO_APPROVAL_LIMIT_PAISE =
  BigInt(WORKSHOP_DEFAULTS.procurement.poApprovalFromRupees) * 100n;

const withinLimit: G = {
  description: `an approver who is not an Executive approves only a grand total including GST below ₹${WORKSHOP_DEFAULTS.procurement.poApprovalFromRupees.toLocaleString('en-IN')} (\`WORKSHOP_DEFAULTS.procurement.poApprovalFromRupees\`)`,
  check: (record, { actor }) =>
    actor.kind === 'principal' &&
    actor.principal.roleKey !== EXECUTIVE &&
    (record.grandTotalPaise === null || record.grandTotalPaise >= PO_APPROVAL_LIMIT_PAISE)
      ? { code: 'forbidden', reason: 'po_approval_limit' }
      : undefined,
};

/**
 * Purchase order (docs/03-roadmap-appendix/phase3.md §7.2): `draft` → `approved` → `sent` →
 * `partially_received` → `received` → `closed`, with `cancelled` from draft, approved or sent.
 * A receipt's reversal takes the order back to what is still received.
 */
export const purchaseOrderMachine = defineMachine<
  PurchaseOrderMachineState,
  PurchaseOrderEvent,
  PurchaseOrderRecord,
  PurchaseOrderParams
>({
  name: 'purchase_order',
  title: 'Purchase order',
  summary:
    '`purchase_orders.state`. A purchase order of one company to one vendor for one hub; its rates and amounts are `po_line_rates`, behind `procurement.rate.read`.',
  sources: [
    'docs/03-roadmap-appendix/phase3.md §7.2',
    'docs/03-roadmap-appendix/phase3.md §2 question 5 (a)',
    'BLUEPRINT §8.4',
    'PRD INV-04',
  ],
  states: PURCHASE_ORDER_MACHINE_STATES,
  initial: 'draft',
  terminal: ['closed', 'cancelled'],
  stored: { table: 'purchase_orders', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  stateNotes: {
    draft: 'Lines, quantities and rates change; whoever writes the draft becomes its drafter.',
    approved: 'Approved within the approver’s limit; ready to send.',
    sent: 'With the vendor, by email with its PDF or marked sent by hand; goods may come in.',
    partially_received: 'Some goods came in; the rest may come, or the order is short-closed.',
    received: 'Every line came in full.',
  },
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'procurement.po.write',
      scope: 'entity',
      system: true,
      emits: 'procurement.po.drafted',
      guard: hasLines,
      effects: [
        { key: 'number', description: '`po_no` from the `purchase_order` series' },
        {
          key: 'tax_rates',
          description: 'each line’s GST rate resolved by the tax engine for its HSN on the day',
        },
      ],
      note: 'The reorder job (`procurement.reorder.draft`, platform-only) drafts one order per company, preferred vendor and hub, with no rate.',
    },
    {
      from: ['draft'],
      event: 'update',
      to: 'draft',
      permission: 'procurement.po.write',
      scope: 'entity',
      guard: hasLines,
      note: 'A rate is typed or filled from the vendor’s valid quote only under the editor’s own `procurement.rate.read`.',
    },
    {
      from: ['draft'],
      event: 'approve',
      to: 'approved',
      permission: 'procurement.po.approve',
      scope: 'entity',
      emits: 'procurement.po.approved',
      guard: allOf(linesComplete, notOwnDraft, withinLimit),
    },
    {
      from: ['approved'],
      event: 'send',
      to: 'sent',
      permission: 'procurement.po.write',
      scope: 'entity',
      emits: 'procurement.po.sent',
      effects: [
        {
          key: 'email_pdf',
          description: 'by email: the PDF to the vendor’s person through the mailer (worker on the event)',
        },
      ],
    },
    {
      from: ['sent', 'partially_received'],
      event: 'receive',
      to: 'partially_received',
      permission: 'procurement.grn.write',
      scope: 'entity',
      emits: 'procurement.receipt.posted',
      effects: [
        { key: 'stock_in', description: '`receipt` movements through `app.stock_move()`' },
      ],
      note: 'A receipt that leaves some line short.',
    },
    {
      from: ['sent', 'partially_received'],
      event: 'receive_all',
      to: 'received',
      permission: 'procurement.grn.write',
      scope: 'entity',
      emits: 'procurement.receipt.posted',
      effects: [
        { key: 'stock_in', description: '`receipt` movements through `app.stock_move()`' },
      ],
      note: 'A receipt after which every line is received in full.',
    },
    {
      from: ['partially_received', 'received'],
      event: 'unreceive',
      to: 'sent',
      permission: 'procurement.grn.write',
      scope: 'entity',
      emits: 'procurement.receipt.reversed',
      note: 'The reversal of the order’s only receipt still standing.',
    },
    {
      from: ['partially_received', 'received'],
      event: 'unreceive_part',
      to: 'partially_received',
      permission: 'procurement.grn.write',
      scope: 'entity',
      emits: 'procurement.receipt.reversed',
      note: 'The reversal of one receipt while another still stands.',
    },
    {
      from: ['partially_received', 'received'],
      event: 'close',
      to: 'closed',
      permission: 'procurement.po.write',
      scope: 'entity',
      emits: 'procurement.po.closed',
      guard: reasonGiven(),
      note: 'Short-closed from partially received: what is still to come is no longer expected.',
    },
    {
      from: ['draft', 'approved', 'sent'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'procurement.po.write',
      scope: 'entity',
      emits: 'procurement.po.cancelled',
      guard: reasonGiven(),
    },
  ],
});
