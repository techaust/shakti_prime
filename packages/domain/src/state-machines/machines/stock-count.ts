import { STOCK_COUNT_STATES, type StockCountState } from '@shakti/contracts';
import { defineMachine, type Guard } from '../define-machine';

export type { StockCountState };
export type StockCountEvent = 'start' | 'begin' | 'submit' | 'recount' | 'post' | 'cancel';

export interface StockCountRecord {
  state: StockCountState | null;
  /** Items in bins not yet counted (per item in a bin, never per serial). */
  toCount: number;
  /** Items in bins the Inventory Manager has asked for again and nobody has recounted yet. */
  recountOpen: number;
}

type G = Guard<StockCountRecord, Record<string, never>>;

const allCounted: G = {
  description: 'every item in every bin is counted and no recount is open',
  check: (record) => {
    if (record.toCount > 0) return { code: 'conflict', reason: 'stock_count_uncounted' };
    if (record.recountOpen > 0) return { code: 'conflict', reason: 'stock_count_recount_open' };
    return undefined;
  },
};

/**
 * A stock count of one company's stock in one hub (docs/03-roadmap-appendix/phase3.md §7.3). The
 * Inventory Manager starts it and the expected quantities are frozen; counters count blind, item
 * by item in each bin, and send it for review; the Inventory Manager asks for any item in a bin
 * again, then posts each variance as a `count` movement. The hub keeps moving meanwhile: what
 * moves in a counted bin is folded into the expected quantity.
 */
export const stockCountMachine = defineMachine<
  StockCountState,
  StockCountEvent,
  StockCountRecord,
  Record<string, never>
>({
  name: 'stock_count',
  title: 'Stock count',
  summary:
    "`stock_counts.state`. One live count (open, counting or review) per company and hub (`stock_counts_live_unique`), so no variance posts twice. A counter's lines are written by the count's definers; the expected quantity is never read by a counter.",
  sources: [
    'docs/03-roadmap-appendix/phase3.md §7.3',
    'PRD INV-02',
    'DATABASE §6.5 `stock_counts`',
  ],
  states: STOCK_COUNT_STATES,
  stored: { table: 'stock_counts', stateColumn: 'state', changedAtColumn: 'state_changed_at' },
  initial: 'open',
  terminal: ['posted', 'cancelled'],
  stateNotes: {
    open: 'Started; the expected quantities are frozen and nobody has counted yet.',
    counting: 'Counters are counting, or counting again what the Inventory Manager asked for.',
    review: 'Every item in every bin is counted; the Inventory Manager reviews the variances.',
    posted: 'Each variance became a `count` movement; the ledger equals what was counted.',
    cancelled: 'Stopped with a reason before it posted; nothing moved.',
  },
  transitions: [
    {
      from: 'new',
      event: 'start',
      to: 'open',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      note: 'A whole hub, chosen bins or chosen items; refused while the company has a live count in the hub.',
      effects: [
        {
          key: 'freeze_expected',
          description: "`app.stock_count_start()` lists each item and serial in the scope's bins",
        },
      ],
    },
    {
      from: ['open'],
      event: 'begin',
      to: 'counting',
      permission: 'inventory.count.record',
      scope: 'entity',
      note: "The first counter's first count.",
    },
    {
      from: ['counting'],
      event: 'submit',
      to: 'review',
      permission: 'inventory.count.record',
      scope: 'entity',
      guard: allCounted,
    },
    {
      from: ['counting', 'review'],
      event: 'recount',
      to: 'counting',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      note: 'One item in one bin, counted again blind; the recount stands once taken.',
      effects: [
        { key: 'ask_again', description: "`app.stock_count_recount()` marks the item's lines" },
      ],
    },
    {
      from: ['review'],
      event: 'post',
      to: 'posted',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      guard: allCounted,
      effects: [
        {
          key: 'post_variances',
          description:
            'each variance becomes a `count` movement through `app.stock_move()` in one batch: a serial found is reinstated, a serial missing is written off with its reason',
        },
      ],
    },
    {
      from: ['open', 'counting', 'review'],
      event: 'cancel',
      to: 'cancelled',
      permission: 'inventory.stock.adjust',
      scope: 'entity',
      note: 'With a reason; nothing moves.',
    },
  ],
});
