import type { Money } from '@shakti/contracts';
import { fromPaise, toPaise } from '../../money/paise';
import { WORKSHOP_DEFAULTS } from '../../workshop-defaults';
import { allOf, defineMachine, reasonGiven, type Guard } from '../define-machine';

export const DISPATCH_STATES = ['draft', 'ready', 'in_transit', 'delivered', 'cancelled'] as const;
export type DispatchMachineState = (typeof DISPATCH_STATES)[number];
export type DispatchEvent = 'create' | 'eway.record' | 'ready' | 'depart' | 'deliver' | 'cancel';

export interface DispatchRecord {
  state: DispatchMachineState | null;
  consignmentValue: Money;
  ewayBillNo: string | null;
  ewayValidUntil: Date | null;
  vehicleNo: string | null;
  /** A loan gate applies to this dispatch (CRM-08), and whether the loan reached its state. */
  loanGateRequired: boolean;
  loanGateMet: boolean;
  /** DCR/ALMM serials must be validated before dispatch (PM Surya Ghar, PRJ-02). */
  dcrSerialsRequired: boolean;
  dcrSerialsValidated: boolean;
  /** The "materials arrived" photo from the field app. */
  arrivalPhotoFileId: string | null;
}

export interface DispatchParams {
  reason?: string | null;
}

type G = Guard<DispatchRecord, DispatchParams>;

function present(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

/** True when the consignment is above the threshold and so needs an e-way bill. */
export function needsEwayBill(consignmentValue: Money): boolean {
  return toPaise(consignmentValue) > WORKSHOP_DEFAULTS.dispatch.ewayBillThresholdPaise;
}

const ewayGate: G = {
  description: `e-way bill gate: above ₹${fromPaise(WORKSHOP_DEFAULTS.dispatch.ewayBillThresholdPaise)} consignment value, an e-way bill number, a validity not yet passed and the vehicle are recorded`,
  check: (record, { now }) => {
    if (!needsEwayBill(record.consignmentValue)) return undefined;
    if (!present(record.ewayBillNo) || !present(record.vehicleNo) || !record.ewayValidUntil) {
      return { code: 'conflict', reason: 'eway_bill_missing' };
    }
    return record.ewayValidUntil.getTime() > now.getTime()
      ? undefined
      : { code: 'conflict', reason: 'eway_bill_expired' };
  },
};

const loanGate: G = {
  description: 'a loan-gated dispatch waits until the loan reaches its configured state (CRM-08)',
  check: (record) =>
    record.loanGateRequired && !record.loanGateMet
      ? { code: 'conflict', reason: 'loan_gate_pending' }
      : undefined,
};

const dcrSerials: G = {
  description: 'DCR/ALMM serials are validated where the project needs them (PRJ-02)',
  check: (record) =>
    record.dcrSerialsRequired && !record.dcrSerialsValidated
      ? { code: 'conflict', reason: 'dcr_serials_unvalidated' }
      : undefined,
};

const arrivalPhoto: G = {
  description: 'the "materials arrived" photo is recorded',
  check: (record) =>
    record.arrivalPhotoFileId === null
      ? { code: 'validation_failed', reason: 'arrival_photo_missing' }
      : undefined,
};

const ewayEffect = {
  key: 'record_eway',
  description: 'store the e-way bill number, validity and vehicle on the dispatch',
};

/** Dispatch with the e-way bill gate (BLUEPRINT §8.4, PRD INV-05). */
export const dispatchMachine = defineMachine<
  DispatchMachineState,
  DispatchEvent,
  DispatchRecord,
  DispatchParams
>({
  name: 'dispatch',
  title: 'Dispatch',
  summary:
    '`dispatches.state`. One consignment of a sales order from one hub; a split dispatch is several rows.',
  sources: [
    'BLUEPRINT §8.4, §19 item 2',
    'PRD INV-05, CRM-08, PRJ-02',
    'DATABASE §6.5 `dispatches`',
  ],
  states: DISPATCH_STATES,
  initial: 'draft',
  terminal: ['delivered', 'cancelled'],
  transitions: [
    {
      from: 'new',
      event: 'create',
      to: 'draft',
      permission: 'inventory.dispatch.write',
      note: 'Against a confirmed or partially dispatched sales order.',
    },
    {
      from: ['draft'],
      event: 'eway.record',
      to: 'draft',
      permission: 'inventory.eway.write',
      effects: [ewayEffect],
      note: 'Accounts generates the e-way bill in Tally or on the portal and enters it here.',
      proposed: true,
    },
    {
      from: ['ready'],
      event: 'eway.record',
      to: 'ready',
      permission: 'inventory.eway.write',
      effects: [ewayEffect],
      proposed: true,
    },
    {
      from: ['in_transit'],
      event: 'eway.record',
      to: 'in_transit',
      permission: 'inventory.eway.write',
      effects: [ewayEffect],
      note: 'An extension when the validity would lapse in transit.',
      proposed: true,
    },
    {
      from: ['draft'],
      event: 'ready',
      to: 'ready',
      permission: 'inventory.dispatch.write',
      note: 'Picked and packed; the challan can print.',
      proposed: true,
    },
    {
      from: ['ready'],
      event: 'depart',
      to: 'in_transit',
      permission: 'inventory.dispatch.write',
      guard: allOf(ewayGate, loanGate, dcrSerials),
      effects: [
        { key: 'issue_stock', description: 'stock movements out of the hub (append-only ledger)' },
        {
          key: 'watch_eway_validity',
          description: 'alert when the e-way bill validity would lapse in transit',
        },
        { key: 'emit', description: 'event for the dispatched WhatsApp message' },
      ],
    },
    {
      from: ['in_transit'],
      event: 'deliver',
      to: 'delivered',
      permission: 'inventory.dispatch.write',
      guard: arrivalPhoto,
      effects: [
        {
          key: 'advance_order',
          description: 'fire `dispatch.partial` or `dispatch.complete` on the sales order',
        },
      ],
      note: 'Field engineers confirm arrival in the app, but SECURITY §3.2 gives them no dispatch permission: the workshop decides who records arrival.',
    },
    {
      from: ['draft', 'ready'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'inventory.dispatch.write',
      guard: reasonGiven(),
      effects: [{ key: 'release_pick', description: 'return picked stock to its bins' }],
    },
  ],
});
