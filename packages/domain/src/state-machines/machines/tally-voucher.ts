import { defineMachine, type Guard } from '../define-machine';

export const TALLY_VOUCHER_STATES = [
  'received',
  'linked',
  'unlinked',
  'tombstoned',
  'reversed',
] as const;
export type TallyVoucherState = (typeof TALLY_VOUCHER_STATES)[number];
export type TallyVoucherEvent =
  'ingest' | 'match' | 'queue' | 'link' | 'alter' | 'tombstone' | 'reverse';

export interface TallyVoucherRecord {
  state: TallyVoucherState | null;
  /** Reconciliation found the order or proforma (Buyer Order No., then GSTIN or phone). */
  matchFound: boolean;
  /** The voucher's GUID is in the latest daily snapshot of its Tally company. */
  inSnapshot: boolean;
}

export interface TallyVoucherParams {
  /** The order or proforma a person links the voucher to from the review queue. */
  target?: { refType: string; refId: string } | null;
}

type G = Guard<TallyVoucherRecord, TallyVoucherParams>;

const matched: G = {
  description: 'reconciliation found the order or proforma',
  check: (record) =>
    record.matchFound ? undefined : { code: 'conflict', reason: 'voucher_no_match' },
};

const unmatched: G = {
  description: 'reconciliation found nothing',
  check: (record) =>
    record.matchFound ? { code: 'conflict', reason: 'voucher_has_match' } : undefined,
};

const targetGiven: G = {
  description: 'the order or proforma to link is chosen',
  check: (_record, { params }) =>
    params.target
      ? undefined
      : { code: 'validation_failed', reason: 'voucher_link_target_missing' },
};

const goneFromSnapshot: G = {
  description: 'the GUID is missing from the daily snapshot of its Tally company',
  check: (record) =>
    record.inSnapshot ? { code: 'conflict', reason: 'voucher_in_snapshot' } : undefined,
};

const applyEffects = {
  key: 'apply',
  description:
    'receipts update milestones, credit notes adjust balances, dealer outstanding is refreshed',
};

/**
 * Tally voucher (BLUEPRINT §8.8, PRD FIN-02, FIN-03). Tally is read-only: the connector pushes, the
 * BOS never writes back. A voucher that disappears from the daily GUID snapshot becomes a
 * tombstone whose effects are reversed.
 */
export const tallyVoucherMachine = defineMachine<
  TallyVoucherState,
  TallyVoucherEvent,
  TallyVoucherRecord,
  TallyVoucherParams
>({
  name: 'tally_voucher',
  title: 'Tally voucher',
  summary:
    'The reconciliation state of a `tally_vouchers` row (a state column is added with the Phase 5 connector); a tombstone is also written to the append-only `tally_voucher_tombstones`.',
  sources: ['BLUEPRINT §8.8, §19 item 2', 'PRD FIN-02, FIN-03', 'DATABASE §6.7'],
  states: TALLY_VOUCHER_STATES,
  initial: 'received',
  terminal: ['reversed'],
  proposedStates: ['received', 'linked', 'unlinked', 'tombstoned', 'reversed'],
  stateNotes: {
    unlinked: 'In the review queue (`unlinked_vouchers`).',
    tombstoned: 'Deleted or cancelled in Tally; shown in the review queue.',
    reversed: '`reversal_applied_at` set on the tombstone.',
  },
  transitions: [
    {
      from: 'new',
      event: 'ingest',
      to: 'received',
      permission: null,
      system: true,
      note: 'The connector push, idempotent by voucher GUID.',
    },
    {
      from: ['received'],
      event: 'match',
      to: 'linked',
      permission: null,
      system: true,
      guard: matched,
      effects: [
        { key: 'link', description: 'write `reconciliation_links` with how it matched' },
        applyEffects,
      ],
    },
    {
      from: ['received'],
      event: 'queue',
      to: 'unlinked',
      permission: null,
      system: true,
      guard: unmatched,
      effects: [{ key: 'review_queue', description: 'add to the review queue' }],
    },
    {
      from: ['unlinked'],
      event: 'link',
      to: 'linked',
      permission: 'finance.recon.write',
      guard: targetGiven,
      effects: [
        { key: 'link', description: 'write `reconciliation_links` as a manual match' },
        applyEffects,
      ],
    },
    {
      from: ['linked', 'unlinked'],
      event: 'alter',
      to: 'received',
      permission: null,
      system: true,
      effects: [
        {
          key: 'undo_link',
          description: 'reverse the previous link and its effects, then match again',
        },
      ],
      note: 'A re-read with a higher AlterID changed the voucher.',
      proposed: true,
    },
    {
      from: ['received', 'linked', 'unlinked'],
      event: 'tombstone',
      to: 'tombstoned',
      permission: null,
      system: true,
      guard: goneFromSnapshot,
      effects: [
        {
          key: 'tombstone',
          description: 'append to `tally_voucher_tombstones` and set `deleted_at`',
        },
        { key: 'review_queue', description: 'show it in the review queue' },
      ],
    },
    {
      from: ['tombstoned'],
      event: 'reverse',
      to: 'reversed',
      permission: null,
      system: true,
      effects: [
        {
          key: 'reverse',
          description:
            'reverse its effect on milestones, outstanding and reconciliation; set `reversal_applied_at`',
        },
      ],
    },
  ],
});
