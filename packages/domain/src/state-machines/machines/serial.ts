import { SERIAL_STATES, type SerialState } from '@shakti/contracts';
import { defineMachine, type Guard } from '../define-machine';

export type { SerialState };
export type SerialEvent =
  | 'stock_in'
  | 'transfer'
  | 'scrap'
  | 'reinstate'
  | 'reserve'
  | 'release'
  | 'pick'
  | 'unpick'
  | 'depart'
  | 'arrive'
  | 'deliver'
  | 'replace'
  | 'return_customer'
  | 'return_faulty'
  | 'repair'
  | 'rma_raise'
  | 'supplier_return'
  | 'settle';

export interface SerialRecord {
  state: SerialState | null;
  /** The bin the serial is in, or null once it has left the company's stock. */
  binId: string | null;
}

export interface SerialParams {
  /** The bin the movement takes the serial from. */
  fromBinId?: string | null;
}

type G = Guard<SerialRecord, SerialParams>;

const inFromBin: G = {
  description: 'the serial is in the bin the movement takes it from',
  check: (record, { params }) =>
    params.fromBinId !== undefined && params.fromBinId !== null && record.binId === params.fromBinId
      ? undefined
      : { code: 'conflict', reason: 'stock_serial_not_in_bin' },
};

/** Later slices fire these; each names its slice. */
const later = (slice: string, what: string) => `${slice}: ${what}.`;

/**
 * A serial of a serial-tracked item (docs/03-roadmap-appendix/phase3.md §5). The ledger's definer
 * `app.stock_move()` keeps `serials.state` and `bin_id` in step with each movement; the commands
 * fire the event first, so a move the machine does not have is refused before the definer runs.
 */
export const serialMachine = defineMachine<SerialState, SerialEvent, SerialRecord, SerialParams>({
  name: 'serial',
  title: 'Serial',
  summary:
    "`serials.state`, kept with `serials.bin_id` by the ledger's definer `app.stock_move()` as each movement posts. One serial moves per movement; a serial is in one bin while the company holds it and in none once it has left. R3's installed-base import enters a serial sold before go-live directly as `with_customer`, with no movement.",
  sources: [
    'docs/03-roadmap-appendix/phase3.md §5, §6.2',
    'BLUEPRINT §8.4',
    'PRD INV-02, INV-08',
    'DATABASE §6.5 `serials`',
  ],
  states: SERIAL_STATES,
  stored: { table: 'serials', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  initial: 'in_stock',
  terminal: [],
  stateNotes: {
    in_stock: 'In a bin of a hub, free or held.',
    reserved: 'Set aside for an order line (H2).',
    picked: "Moved to the hub's dispatch bin for a dispatch (D2).",
    in_transit: 'Left the hub on a dispatch, or between two hubs (D2).',
    with_customer: 'Delivered; its warranty runs from the delivery (D2, R3).',
    faulty: 'Back from a customer as a fault, in quarantine (R3).',
    with_supplier: 'Sent to the supplier under their warranty or returned to them (R3, R2).',
    scrapped:
      'Written off by an adjustment, damage or a count; a reversal or a later find brings it back.',
  },
  transitions: [
    {
      from: 'new',
      event: 'stock_in',
      to: 'in_stock',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      note: 'Opening stock or an adjustment gain of a new serial number (H1); a goods receipt (U2).',
      effects: [{ key: 'create_serial', description: 'the serial enters the bin of its movement' }],
    },
    {
      from: ['in_stock'],
      event: 'transfer',
      to: 'in_stock',
      permission: 'inventory.stock.move',
      scope: 'entity',
      guard: inFromBin,
      note: 'Moved between two bins of a hub, or back by the reversal of such a move (H1).',
      effects: [{ key: 'move_bin', description: "the serial's bin becomes the movement's" }],
    },
    {
      from: ['in_stock', 'faulty'],
      event: 'scrap',
      to: 'scrapped',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      guard: inFromBin,
      note: 'An adjustment loss, damage or a count loss, or the reversal of the movement that brought it in (H1).',
      effects: [{ key: 'clear_bin', description: 'the serial leaves its bin' }],
    },
    {
      from: ['scrapped'],
      event: 'reinstate',
      to: 'in_stock',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      note: 'An adjustment gain or a count of the same serial number, or the reversal of the loss (H1).',
      effects: [{ key: 'move_bin', description: "the serial's bin becomes the movement's" }],
    },
    {
      from: ['in_stock'],
      event: 'reserve',
      to: 'reserved',
      permission: 'sales.order.confirm',
      system: true,
      proposed: true,
      note: later('H2', 'confirming an order, or the backorder fill, sets the serial aside'),
    },
    {
      from: ['reserved'],
      event: 'release',
      to: 'in_stock',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      system: true,
      proposed: true,
      note: later('H2', 'a released or lapsed reservation frees the serial'),
    },
    {
      from: ['in_stock', 'reserved'],
      event: 'pick',
      to: 'picked',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: later('D2', 'picked by scan into the dispatch bin'),
    },
    {
      from: ['picked'],
      event: 'unpick',
      to: 'in_stock',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: later('D2', 'a cancelled dispatch puts picked stock back'),
    },
    {
      from: ['picked'],
      event: 'depart',
      to: 'in_transit',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: later('D2', 'the dispatch departs through the e-way bill gate'),
    },
    {
      from: ['in_transit'],
      event: 'arrive',
      to: 'in_stock',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: later('D2', 'a transfer between hubs arrives at the receiving hub'),
    },
    {
      from: ['in_transit'],
      event: 'deliver',
      to: 'with_customer',
      permission: 'inventory.dispatch.write',
      scope: 'entity',
      proposed: true,
      note: later('D2', 'delivered with the arrival photo; the warranty runs from today'),
    },
    {
      from: ['in_stock'],
      event: 'replace',
      to: 'with_customer',
      permission: 'inventory.stock.move',
      scope: 'entity',
      proposed: true,
      note: later('R3', 'issued from stock as a warranty replacement'),
    },
    {
      from: ['with_customer'],
      event: 'return_customer',
      to: 'in_stock',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      proposed: true,
      note: later('R2', 'returned after delivery into quarantine'),
    },
    {
      from: ['with_customer'],
      event: 'return_faulty',
      to: 'faulty',
      permission: 'inventory.warranty.write',
      scope: 'entity',
      proposed: true,
      note: later('R3', 'the failed serial of a claim comes back into quarantine'),
    },
    {
      from: ['faulty'],
      event: 'repair',
      to: 'in_stock',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      proposed: true,
      note: later('R3', 'found sound and moved back to storage'),
    },
    {
      from: ['faulty'],
      event: 'rma_raise',
      to: 'with_supplier',
      permission: 'procurement.po.write',
      scope: 'entity',
      proposed: true,
      note: later('R3', 'sent to the supplier under their warranty'),
    },
    {
      from: ['in_stock'],
      event: 'supplier_return',
      to: 'with_supplier',
      permission: 'procurement.grn.write',
      scope: 'entity',
      proposed: true,
      note: later('R2', 'returned to the supplier against its receipt'),
    },
    {
      from: ['with_supplier'],
      event: 'settle',
      to: 'scrapped',
      permission: 'procurement.grn.write',
      scope: 'entity',
      proposed: true,
      note: later(
        'R3',
        "the supplier's credit or replacement settles it; a replacement is a new serial",
      ),
    },
  ],
});
