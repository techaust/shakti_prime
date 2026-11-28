import {
  WARRANTY_CLAIM_STATES,
  type CalendarDate,
  type WarrantyClaimState,
} from '@shakti/contracts';
import { istCalendarDate } from '../../numbering/financial-year';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export { WARRANTY_CLAIM_STATES };
export type { WarrantyClaimState };
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
      : {
          code: 'conflict',
          reason: 'warranty_expired',
          details: { warrantyUntil: record.warrantyUntil },
        },
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
    "`warranty_claims.state`. Raised on a customer or serial; the replacement comes from stock and the supplier RMA follows. Until job costing exists (Phase 5) the replacement's cost and the supplier's credit stay on the claim's restricted costs (`warranty_claim_costs`, `finance.cost.read`; phase3 §2 question 10 (a)).",
  sources: [
    'BLUEPRINT §8.4, §19 item 2',
    'PRD INV-08',
    'DATABASE §6.5 `warranty_claims`',
    'docs/03-roadmap-appendix/phase3.md §7.5, §14',
  ],
  states: WARRANTY_CLAIM_STATES,
  initial: 'raised',
  terminal: ['closed', 'rejected'],
  stored: { table: 'warranty_claims', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
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
      permission: 'inventory.warranty.write',
      scope: 'entity',
      emits: 'inventory.warranty.raised',
      note: 'From Account 360, or from the serial reported, whose customer the claim takes.',
    },
    {
      from: ['raised'],
      event: 'serial.identify',
      to: 'serial_identified',
      permission: 'inventory.warranty.write',
      scope: 'entity',
      guard: allOf(serialGiven, underWarranty),
      emits: 'inventory.warranty.serial_identified',
      note: "The serial is the company's, with the claim's customer; out of warranty it is refused with its date, and the claim is then rejected by hand.",
      effects: [{ key: 'set_serial', description: 'record the failed serial on the claim' }],
    },
    {
      from: ['serial_identified'],
      event: 'replace',
      to: 'replacement_issued',
      permission: 'inventory.warranty.write',
      scope: 'entity',
      guard: replacementGiven,
      emits: 'inventory.warranty.replaced',
      note: 'The failed serial comes back into a quarantine bin as faulty in the same step, or with the RMA.',
      effects: [
        {
          key: 'issue_stock',
          description:
            'the replacement serial leaves stock to the customer (`warranty_replacement`, at the moving average)',
        },
        {
          key: 'cost_entry',
          description:
            "the replacement's cost on the claim's restricted costs; the job cost entry of type `warranty` waits for Phase 5 (question 10 (a))",
        },
      ],
    },
    {
      from: ['replacement_issued'],
      event: 'rma.raise',
      to: 'rma_raised',
      permission: 'procurement.po.write',
      scope: 'entity',
      guard: rmaGiven,
      emits: 'inventory.warranty.rma_raised',
      effects: [
        {
          key: 'return_supplier',
          description:
            'the failed serial leaves its quarantine bin for its supplier (`return_supplier`), back from the customer first if it is not yet',
        },
      ],
    },
    {
      from: ['rma_raised'],
      event: 'settle',
      to: 'closed',
      permission: 'procurement.grn.write',
      scope: 'entity',
      guard: settled,
      emits: 'inventory.warranty.closed',
      effects: [
        {
          key: 'adjust_cost',
          description:
            "the supplier's credit on the claim's restricted costs, or its replacement serial received into stock; Phase 5 offsets the job cost entry with it",
        },
      ],
    },
    {
      from: ['raised', 'serial_identified'],
      event: 'reject',
      to: 'rejected',
      permission: 'inventory.warranty.write',
      scope: 'entity',
      guard: reasonGiven(),
      emits: 'inventory.warranty.rejected',
      proposed: true,
    },
  ],
});
