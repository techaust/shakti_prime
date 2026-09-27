import type { CalendarDate } from '@shakti/contracts';
import { istCalendarDate } from '../../numbering/financial-year';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const WARRANTY_CLAIM_STATES = [
  'raised',
  'serial_identified',
  'replacement_issued',
  'rma_raised',
  'closed',
  'rejected',
] as const;
export type WarrantyClaimState = (typeof WARRANTY_CLAIM_STATES)[number];
export type WarrantyClaimEvent =
  'raise' | 'serial.identify' | 'replace' | 'rma.raise' | 'settle' | 'reject';

export interface WarrantyClaimRecord {
  state: WarrantyClaimState | null;
  /** `serials.warranty_until` of the failed serial, once identified. */
  warrantyUntil: CalendarDate | null;
  replacementSerialId: string | null;
  supplierRmaRef: string | null;
  /** Supplier credit or a replacement from the supplier is recorded. */
  supplierSettled: boolean;
}

export interface WarrantyClaimParams {
  serialId?: string | null;
  reason?: string | null;
}

type G = Guard<WarrantyClaimRecord, WarrantyClaimParams>;

const serialGiven: G = {
  description: 'the failed serial is given',
  check: (_record, { params }) =>
    params.serialId ? undefined : { code: 'validation_failed', reason: 'warranty_serial_missing' },
};

const underWarranty: G = {
  description: "the serial's warranty runs to today or later (IST)",
  check: (record, { now }) =>
    record.warrantyUntil !== null && record.warrantyUntil >= istCalendarDate(now)
      ? undefined
      : { code: 'conflict', reason: 'warranty_expired' },
};

const replacementGiven: G = {
  description: 'the replacement serial is recorded',
  check: (record) =>
    record.replacementSerialId
      ? undefined
      : { code: 'validation_failed', reason: 'replacement_serial_missing' },
};

const rmaGiven: G = {
  description: "the supplier's RMA reference is recorded",
  check: (record) =>
    record.supplierRmaRef ? undefined : { code: 'validation_failed', reason: 'rma_ref_missing' },
};

const settled: G = {
  description: 'supplier credit or a supplier replacement is received',
  check: (record) =>
    record.supplierSettled
      ? undefined
      : { code: 'conflict', reason: 'supplier_settlement_missing' },
};

const NEW_PERMISSION = 'inventory.warranty.write';

/** Warranty claim and supplier return, the five steps of BLUEPRINT §8.4 (PRD INV-08). */
export const warrantyClaimMachine = defineMachine<
  WarrantyClaimState,
  WarrantyClaimEvent,
  WarrantyClaimRecord,
  WarrantyClaimParams
>({
  name: 'warranty_claim',
  title: 'Warranty claim',
  summary:
    '`warranty_claims.state`. Raised on a customer or serial; the replacement comes from stock and the supplier RMA follows; the cost lands in job costing.',
  sources: ['BLUEPRINT §8.4, §19 item 2', 'PRD INV-08', 'DATABASE §6.5 `warranty_claims`'],
  states: WARRANTY_CLAIM_STATES,
  initial: 'raised',
  terminal: ['closed', 'rejected'],
  proposedStates: [
    'raised',
    'serial_identified',
    'replacement_issued',
    'rma_raised',
    'closed',
    'rejected',
  ],
  stateNotes: {
    raised: 'Step 1: the claim is raised on a customer or serial.',
    serial_identified: 'Step 2: the failed serial is identified.',
    replacement_issued: 'Step 3: a replacement is issued from stock.',
    rma_raised: "Step 4: a supplier RMA is raised under the supplier's warranty terms.",
    closed: 'Step 5: supplier credit or a replacement is received.',
    rejected: 'Out of warranty or not a fault.',
  },
  transitions: [
    {
      from: 'new',
      event: 'raise',
      to: 'raised',
      permission: 'crm.account.write',
      newPermission: NEW_PERMISSION,
    },
    {
      from: ['raised'],
      event: 'serial.identify',
      to: 'serial_identified',
      permission: 'inventory.stock.move',
      newPermission: NEW_PERMISSION,
      guard: allOf(serialGiven, underWarranty),
      effects: [{ key: 'set_serial', description: 'record the failed serial on the claim' }],
    },
    {
      from: ['serial_identified'],
      event: 'replace',
      to: 'replacement_issued',
      permission: 'inventory.stock.move',
      guard: replacementGiven,
      effects: [
        { key: 'issue_stock', description: 'stock movement out for the replacement serial' },
        { key: 'cost_entry', description: 'job cost entry of type `warranty` (restricted)' },
      ],
    },
    {
      from: ['replacement_issued'],
      event: 'rma.raise',
      to: 'rma_raised',
      permission: 'procurement.po.write',
      guard: rmaGiven,
    },
    {
      from: ['rma_raised'],
      event: 'settle',
      to: 'closed',
      permission: 'procurement.grn.write',
      guard: settled,
      effects: [
        {
          key: 'adjust_cost',
          description: 'offset the warranty cost entry by the supplier credit or replacement',
        },
      ],
    },
    {
      from: ['raised', 'serial_identified'],
      event: 'reject',
      to: 'rejected',
      permission: 'inventory.stock.move',
      newPermission: NEW_PERMISSION,
      guard: reasonGiven(),
      proposed: true,
    },
  ],
});
