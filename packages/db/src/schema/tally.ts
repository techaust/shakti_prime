import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { entities } from './entities';
import { principals } from './principals';

/**
 * The Tally mirror (docs/05-database.md §6.7, docs/03-roadmap-appendix/phase5.md §5 and §6.3). A
 * connector on the office PC reads each Tally company by AlterID and pushes signed batches; the
 * BOS stores what Tally says and never writes back (ADR 0013). Every row of a company is written
 * by a definer that checks the connector's principal (`tally.connector.sync`) and the companies
 * mapped to it; people read with `finance.read`, purchase vouchers only with
 * `procurement.rate.read` as well.
 */

const VOUCHER_STATES = sql`('received', 'linked', 'unlinked', 'tombstoned', 'reversed')`;

/**
 * A connector: a principal of its own (`connector:tally:<id>`, role `system:tally_connector`) with
 * two key hashes during a rotation. Only the SHA-256 of a key is kept, and no request role selects
 * it: the routes read it through `app.tally_connector_auth()`. Registered, rotated and revoked by
 * an Executive (`admin.integrations.write`); its heartbeat columns are the connector's.
 */
export const tallyConnectors = pgTable(
  'tally_connectors',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => principals.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    /** The last four characters of the key, to tell keys apart on screen. */
    keyHint: text('key_hint').notNull(),
    nextKeyHash: text('next_key_hash'),
    nextKeyHint: text('next_key_hint'),
    keyRotatedAt: timestamp('key_rotated_at', { withTimezone: true }),
    connectorVersion: text('connector_version'),
    tallyVersion: text('tally_version'),
    queueDepth: integer('queue_depth'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    /** When the silence alert last went out; one per silence (`shouldAlertSilence`). */
    silenceAlertedAt: timestamp('silence_alerted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
    updatedBy: uuid('updated_by').references(() => principals.id),
  },
  (t) => [
    check('tally_connectors_name_check', sql`char_length(${t.name}) between 1 and 80`),
    check('tally_connectors_key_hash_check', sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'tally_connectors_next_key_check',
      sql`(${t.nextKeyHash} is null) = (${t.nextKeyHint} is null)
          and (${t.nextKeyHash} is null or ${t.nextKeyHash} ~ '^[0-9a-f]{64}$')
          and ${t.nextKeyHash} is distinct from ${t.keyHash}`,
    ),
    check(
      'tally_connectors_revoked_check',
      sql`(${t.revokedAt} is null) = (${t.revokedBy} is null)`,
    ),
    check(
      'tally_connectors_queue_depth_check',
      sql`${t.queueDepth} is null or ${t.queueDepth} >= 0`,
    ),
    uniqueIndex('tally_connectors_key_hash_unique').on(t.keyHash),
  ],
);

/**
 * A Tally company served by a connector, mapped to one of the group's companies; the connector's
 * heartbeat reports each company's reach and last AlterID here.
 */
export const tallyConnectorCompanies = pgTable(
  'tally_connector_companies',
  {
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => tallyConnectors.id),
    /** The company's name exactly as Tally holds it. */
    tallyCompany: text('tally_company').notNull(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    reachable: boolean('reachable'),
    reportedAlterId: bigint('reported_alter_id', { mode: 'number' }),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => principals.id),
  },
  (t) => [
    primaryKey({ columns: [t.connectorId, t.tallyCompany] }),
    // A Tally company (Tally often starts one per financial year) is read by one connector only,
    // so two cannot move the same cursor; a group company may have several.
    unique('tally_connector_companies_entity_unique').on(t.entityId, t.tallyCompany),
    check(
      'tally_connector_companies_name_check',
      sql`char_length(${t.tallyCompany}) between 1 and 120 and ${t.tallyCompany} = btrim(${t.tallyCompany})`,
    ),
  ],
);

/** Per company, the AlterID the BOS has accepted; it only moves forward. */
export const tallyCursors = pgTable(
  'tally_cursors',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    tallyCompany: text('tally_company').notNull(),
    lastAlterId: bigint('last_alter_id', { mode: 'number' }).notNull().default(0),
    /** The connector that moved it last. */
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => tallyConnectors.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('tally_cursors_company_unique').on(t.entityId, t.tallyCompany),
    check('tally_cursors_alter_id_check', sql`${t.lastAlterId} >= 0`),
    index('tally_cursors_connector_idx').on(t.connectorId),
  ],
);

/** The columns a sales, receipt or credit-note voucher and a purchase or debit-note voucher share. */
function voucherColumns() {
  return {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    tallyCompany: text('tally_company').notNull(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => tallyConnectors.id),
    guid: text('guid').notNull(),
    alterId: bigint('alter_id', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    typeName: text('type_name').notNull(),
    voucherNo: text('voucher_no').notNull(),
    voucherDate: date('voucher_date').notNull(),
    partyName: text('party_name'),
    partyGstin: text('party_gstin'),
    buyerOrderNo: text('buyer_order_no'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    isCancelled: boolean('is_cancelled').notNull(),
    isOptional: boolean('is_optional').notNull(),
    /** The ledger and inventory entries as the connector read them. */
    payloadJson: jsonb('payload_json').notNull(),
    /** The `tally-voucher` machine's state. */
    state: text('state').notNull(),
    stateChangedAt: timestamp('state_changed_at', { withTimezone: true }).notNull(),
    /** When the BOS first stored the voucher; the snapshot keeps one stored after it was taken. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    /** Set with the tombstone: gone from Tally's daily snapshot. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  };
}

/** Sales, receipts and credit notes. */
export const tallyVouchers = pgTable(
  'tally_vouchers',
  voucherColumns(),
  (t) => [
    uniqueIndex('tally_vouchers_guid_unique').on(t.guid),
    index('tally_vouchers_entity_date_idx').on(t.entityId, t.voucherDate.desc()),
    index('tally_vouchers_entity_state_idx').on(t.entityId, t.tallyCompany, t.state),
    index('tally_vouchers_connector_idx').on(t.connectorId),
    check('tally_vouchers_type_check', sql`${t.type} in ('sales', 'receipt', 'credit_note')`),
    check('tally_vouchers_state_check', sql`${t.state} in ${VOUCHER_STATES}`),
    check('tally_vouchers_alter_id_check', sql`${t.alterId} >= 0`),
    check(
      'tally_vouchers_deleted_check',
      sql`(${t.deletedAt} is not null) = (${t.state} in ('tombstoned', 'reversed'))`,
    ),
  ],
);

/** Purchases and debit notes: supplier rates, read only with `procurement.rate.read`. */
export const tallyPurchaseVouchers = pgTable(
  'tally_purchase_vouchers',
  voucherColumns(),
  (t) => [
    uniqueIndex('tally_purchase_vouchers_guid_unique').on(t.guid),
    index('tally_purchase_vouchers_entity_date_idx').on(t.entityId, t.voucherDate.desc()),
    index('tally_purchase_vouchers_entity_state_idx').on(t.entityId, t.tallyCompany, t.state),
    index('tally_purchase_vouchers_connector_idx').on(t.connectorId),
    check('tally_purchase_vouchers_type_check', sql`${t.type} in ('purchase', 'debit_note')`),
    check('tally_purchase_vouchers_state_check', sql`${t.state} in ${VOUCHER_STATES}`),
    check('tally_purchase_vouchers_alter_id_check', sql`${t.alterId} >= 0`),
    check(
      'tally_purchase_vouchers_deleted_check',
      sql`(${t.deletedAt} is not null) = (${t.state} in ('tombstoned', 'reversed'))`,
    ),
  ],
);

/** Party ledgers and their balances, for dealer outstanding (TC3). The newest AlterID wins. */
export const tallyLedgers = pgTable(
  'tally_ledgers',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    tallyCompany: text('tally_company').notNull(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => tallyConnectors.id),
    guid: text('guid').notNull(),
    alterId: bigint('alter_id', { mode: 'number' }).notNull(),
    name: text('name').notNull(),
    /** Tally's group the ledger sits under (Sundry Debtors, Sundry Creditors). */
    parent: text('parent').notNull(),
    gstin: text('gstin'),
    openingBalance: numeric('opening_balance', { precision: 14, scale: 2 }).notNull(),
    closingBalance: numeric('closing_balance', { precision: 14, scale: 2 }).notNull(),
    asOf: date('as_of').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('tally_ledgers_guid_unique').on(t.guid),
    index('tally_ledgers_entity_name_idx').on(t.entityId, t.name),
    index('tally_ledgers_connector_idx').on(t.connectorId),
    check('tally_ledgers_alter_id_check', sql`${t.alterId} >= 0`),
  ],
);

/**
 * A daily GUID snapshot's summary. One that would remove too much (`diffSnapshot`'s limits) is
 * `held` with the GUIDs it would remove until Accounts confirms it (`finance.recon.write`); a newer
 * snapshot of the company supersedes a held one.
 */
export const tallySnapshots = pgTable(
  'tally_snapshots',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    tallyCompany: text('tally_company').notNull(),
    connectorId: uuid('connector_id')
      .notNull()
      .references(() => tallyConnectors.id),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    fromDate: date('from_date').notNull(),
    guidCount: integer('guid_count').notNull(),
    live: integer('live').notNull(),
    tombstoned: integer('tombstoned').notNull(),
    missing: integer('missing').notNull(),
    reappeared: integer('reappeared').notNull(),
    state: text('state').notNull(),
    /** A held snapshot's GUIDs that would become tombstones; emptied once decided. */
    heldGuids: text('held_guids').array().notNull().default(sql`'{}'::text[]`),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedBy: uuid('confirmed_by').references(() => principals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'tally_snapshots_state_check',
      sql`${t.state} in ('applied', 'held', 'confirmed', 'superseded')`,
    ),
    check(
      'tally_snapshots_counts_check',
      sql`${t.guidCount} >= 0 and ${t.live} >= 0 and ${t.tombstoned} >= 0 and ${t.missing} >= 0
          and ${t.reappeared} >= 0`,
    ),
    check(
      'tally_snapshots_confirmed_check',
      sql`(${t.confirmedAt} is null) = (${t.confirmedBy} is null)
          and (${t.confirmedAt} is null) = (${t.state} <> 'confirmed')`,
    ),
    check(
      'tally_snapshots_held_check',
      sql`${t.state} = 'held' or cardinality(${t.heldGuids}) = 0`,
    ),
    index('tally_snapshots_entity_created_idx').on(t.entityId, t.createdAt.desc()),
    index('tally_snapshots_held_idx')
      .on(t.entityId, t.tallyCompany)
      .where(sql`${t.state} = 'held'`),
    index('tally_snapshots_connector_idx').on(t.connectorId),
    unique('tally_snapshots_id_entity_unique').on(t.id, t.entityId),
  ],
);

/**
 * Append-only: a voucher gone from Tally's daily snapshot (deleted or cancelled there). TC3
 * reverses its effects and sets `reversal_applied_at` through its definer.
 */
export const tallyVoucherTombstones = pgTable(
  'tally_voucher_tombstones',
  {
    id: uuid('id').primaryKey(),
    entityId: smallint('entity_id')
      .notNull()
      .references(() => entities.id),
    voucherGuid: text('voucher_guid').notNull(),
    /** Which table holds the voucher: a purchase's GUID says nothing of its rate. */
    voucherType: text('voucher_type').notNull(),
    snapshotId: uuid('snapshot_id').notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull(),
    reversalAppliedAt: timestamp('reversal_applied_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: 'tally_voucher_tombstones_snapshot_fk',
      columns: [t.snapshotId, t.entityId],
      foreignColumns: [tallySnapshots.id, tallySnapshots.entityId],
    }),
    check(
      'tally_voucher_tombstones_type_check',
      sql`${t.voucherType} in ('sales', 'receipt', 'credit_note', 'purchase', 'debit_note')`,
    ),
    index('tally_voucher_tombstones_entity_detected_idx').on(t.entityId, t.detectedAt.desc()),
    index('tally_voucher_tombstones_guid_idx').on(t.voucherGuid),
    index('tally_voucher_tombstones_snapshot_idx').on(t.snapshotId),
  ],
);
