import { z } from 'zod';
import {
  ConnectorBatchRequest,
  ConnectorBatchResponse,
  ConnectorCursorResponse,
  ConnectorHeartbeatRequest,
  ConnectorSnapshotRequest,
  ConnectorSnapshotResponse,
  TallyCompanySchema,
  type TallyVoucherType,
} from '../../api/connector';
import { EntityIdSchema, IdSchema } from '../../ids';

// TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §6.3, docs/06-api.md §3.5): what a
// connector's signed calls become once the route has verified the signature and found the company
// the Tally company name is mapped to. Each runs as the connector's own principal
// (`connector:tally:<id>`, `tally.connector.sync`) in that one company.

/** The states of a stored voucher (the `tally-voucher` machine's). */
export const TALLY_VOUCHER_STATES = [
  'received',
  'linked',
  'unlinked',
  'tombstoned',
  'reversed',
] as const;
export type TallyVoucherState = (typeof TALLY_VOUCHER_STATES)[number];

/** Which table a voucher type lands in: purchases and debit notes are restricted. */
export const TALLY_SALES_VOUCHER_TYPES = [
  'sales',
  'receipt',
  'credit_note',
] as const satisfies readonly TallyVoucherType[];
export const TALLY_PURCHASE_VOUCHER_TYPES = [
  'purchase',
  'debit_note',
] as const satisfies readonly TallyVoucherType[];

/**
 * A daily snapshot: applied at once, held for Accounts when over the limits, confirmed by them,
 * or superseded by a newer snapshot of the company while it waited.
 */
export const TALLY_SNAPSHOT_STATES = ['applied', 'held', 'confirmed', 'superseded'] as const;

/** `tally.batch.ingest`: one batch of a company, its body exactly as the connector signed it. */
export const TallyBatchIngestInput = z
  .object({
    entityId: EntityIdSchema,
    batch: ConnectorBatchRequest,
  })
  .strict();
export type TallyBatchIngestInput = z.input<typeof TallyBatchIngestInput>;

export const TallyBatchIngestDto = ConnectorBatchResponse;
export type TallyBatchIngestDto = z.infer<typeof TallyBatchIngestDto>;

/** `tally.snapshot.record`: the daily GUID snapshot of a company. */
export const TallySnapshotRecordInput = z
  .object({
    entityId: EntityIdSchema,
    snapshot: ConnectorSnapshotRequest,
  })
  .strict();
export type TallySnapshotRecordInput = z.input<typeof TallySnapshotRecordInput>;

/**
 * What the snapshot did: `held` when it would remove more than the limits allow, and waits for
 * Accounts; the connector's answer is the contract's response beside it.
 */
export const TallySnapshotRecordDto = z
  .object({
    snapshotId: IdSchema,
    state: z.enum(['applied', 'held']),
    response: ConnectorSnapshotResponse,
  })
  .strict();
export type TallySnapshotRecordDto = z.infer<typeof TallySnapshotRecordDto>;

/** `tally.snapshot.confirm`: Accounts confirms a held snapshot of a company it works for. */
export const TallySnapshotConfirmInput = z
  .object({
    entityId: EntityIdSchema,
    snapshotId: IdSchema,
  })
  .strict();
export type TallySnapshotConfirmInput = z.input<typeof TallySnapshotConfirmInput>;

export const TallySnapshotConfirmDto = z
  .object({
    snapshotId: IdSchema,
    tombstoned: z.number().int().min(0),
  })
  .strict();
export type TallySnapshotConfirmDto = z.infer<typeof TallySnapshotConfirmDto>;

/** `tally.heartbeat.record`: the connector's heartbeat, for every company it serves. */
export const TallyHeartbeatRecordInput = z
  .object({
    heartbeat: ConnectorHeartbeatRequest,
  })
  .strict();
export type TallyHeartbeatRecordInput = z.input<typeof TallyHeartbeatRecordInput>;

export const TallyHeartbeatRecordDto = z
  .object({
    /** The mapped companies the heartbeat named. */
    companies: z.number().int().min(0),
  })
  .strict();
export type TallyHeartbeatRecordDto = z.infer<typeof TallyHeartbeatRecordDto>;

/** The cursor read (`GET /connector/tally/cursor`), a query of the connector's own company. */
export const TallyCursorQuery = z
  .object({ entityId: EntityIdSchema, company: TallyCompanySchema })
  .strict();
export type TallyCursorQuery = z.infer<typeof TallyCursorQuery>;

export const TallyCursorDto = ConnectorCursorResponse;
export type TallyCursorDto = z.infer<typeof TallyCursorDto>;
