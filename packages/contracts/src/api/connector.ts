import { z } from 'zod';
import { MoneySchema } from '../catalogue/enums';
import { DateOnlySchema, SemverSchema } from './common';
import { EntityCodeSchema } from './ingest';

/**
 * The Tally connector (docs/API.md §2, §3.5; docs/BLUEPRINT.md §8.8; ADR 0013). A Windows service
 * beside Tally reads vouchers and ledgers by AlterID and pushes them to the BOS; the BOS never
 * writes to Tally. Every call is signed; every batch carries an `Idempotency-Key`.
 */

// --- Signing -------------------------------------------------------------------------------

/** Accepted clock difference between the connector and the server, either way. */
export const CONNECTOR_CLOCK_SKEW_SECONDS = 5 * 60;

/** The three headers on every connector call. The timestamp is Unix seconds. */
export const ConnectorHeaders = z.object({
  'x-connector-id': z.uuid(),
  'x-timestamp': z.string().regex(/^\d{10}$/),
  'x-signature': z.string().regex(/^[0-9a-f]{64}$/),
});
export type ConnectorHeaders = z.infer<typeof ConnectorHeaders>;

/**
 * The string the connector signs with HMAC-SHA256 under its own key, as lowercase hex:
 * method, path with query, timestamp and the SHA-256 of the raw body (empty body hashed as the
 * empty string), one per line. Both sides build it with this function.
 */
export function connectorSigningString(parts: {
  method: string;
  pathWithQuery: string;
  timestamp: string;
  bodySha256Hex: string;
}): string {
  return [
    parts.method.toUpperCase(),
    parts.pathWithQuery,
    parts.timestamp,
    parts.bodySha256Hex.toLowerCase(),
  ].join('\n');
}

/** True when the header's time is within the skew window of `nowSeconds`. */
export function isConnectorTimestampFresh(timestamp: string, nowSeconds: number): boolean {
  if (!/^\d{10}$/.test(timestamp)) return false;
  return Math.abs(nowSeconds - Number(timestamp)) <= CONNECTOR_CLOCK_SKEW_SECONDS;
}

// --- Shapes shared by the routes -------------------------------------------------------------

/** A Tally company name as configured in the connector's mapping to an entity. */
export const TallyCompanySchema = z.string().trim().min(1).max(120);

/**
 * Tally's GUID for a voucher or ledger: the company's GUID and the record's master id in hex.
 * Stable across edits, it is the idempotency key of a row.
 */
export const TallyGuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{1,8}$/i);

/** AlterID: Tally's per-company change counter; reads are incremental above the last one. */
export const AlterIdSchema = z.number().int().min(0);

/** GSTIN: state code, PAN, entity number, `Z`, check character. */
export const GstinSchema = z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/);

/** A signed amount with two decimals; Tally's debit and credit sides differ in sign. */
export const SignedMoneySchema = z.string().regex(/^-?\d{1,12}\.\d{2}$/);

/** Voucher types the BOS reads. Purchase and debit notes land in the restricted table. */
export const TALLY_VOUCHER_TYPES = [
  'sales',
  'receipt',
  'credit_note',
  'purchase',
  'debit_note',
] as const;
export const TallyVoucherTypeSchema = z.enum(TALLY_VOUCHER_TYPES);
export type TallyVoucherType = z.infer<typeof TallyVoucherTypeSchema>;

export const TallyLedgerEntry = z
  .object({
    ledgerName: z.string().min(1).max(200),
    amount: SignedMoneySchema,
  })
  .strict();

export const TallyInventoryEntry = z
  .object({
    stockItemName: z.string().min(1).max(200),
    quantity: z.string().regex(/^-?\d{1,9}(\.\d{1,3})?$/),
    unit: z.string().min(1).max(20).optional(),
    rate: z
      .string()
      .regex(/^\d{1,10}\.\d{2,4}$/)
      .optional(),
    amount: SignedMoneySchema,
    godown: z.string().max(120).optional(),
  })
  .strict();

/** One voucher as read from Tally. The raw XML never travels; this is the connector's reading. */
export const TallyVoucher = z
  .object({
    guid: TallyGuidSchema,
    alterId: AlterIdSchema,
    type: TallyVoucherTypeSchema,
    /** Tally's own voucher type name, which a company may have renamed. */
    typeName: z.string().min(1).max(100),
    voucherNo: z.string().max(60),
    date: DateOnlySchema,
    partyName: z.string().max(200).nullable(),
    partyGstin: GstinSchema.nullable(),
    /** "Buyer Order No.": the proforma or sales order number used for reconciliation. */
    buyerOrderNo: z.string().max(60).nullable(),
    amount: MoneySchema,
    isCancelled: z.boolean(),
    isOptional: z.boolean(),
    ledgerEntries: z.array(TallyLedgerEntry).min(1),
    inventoryEntries: z.array(TallyInventoryEntry),
  })
  .strict();
export type TallyVoucher = z.infer<typeof TallyVoucher>;

export const TallyLedger = z
  .object({
    guid: TallyGuidSchema,
    alterId: AlterIdSchema,
    name: z.string().min(1).max(200),
    parent: z.string().min(1).max(200),
    gstin: GstinSchema.nullable(),
    openingBalance: SignedMoneySchema,
    closingBalance: SignedMoneySchema,
    asOf: DateOnlySchema,
  })
  .strict();
export type TallyLedger = z.infer<typeof TallyLedger>;

// --- Routes ---------------------------------------------------------------------------------

/** `POST /connector/tally/heartbeat`, every 5 minutes; 30 minutes of silence raises an alert. */
export const ConnectorHeartbeatRequest = z
  .object({
    connectorVersion: SemverSchema,
    tallyVersion: z.string().min(1).max(40),
    companies: z
      .array(
        z
          .object({
            name: TallyCompanySchema,
            lastAlterId: AlterIdSchema,
            reachable: z.boolean(),
          })
          .strict(),
      )
      .min(1),
    /** Batches waiting in the connector's local SQLite outbox. */
    queueDepth: z.number().int().min(0),
  })
  .strict();
export type ConnectorHeartbeatRequest = z.infer<typeof ConnectorHeartbeatRequest>;

export const ConnectorHeartbeatResponse = z
  .object({
    serverTime: z.iso.datetime(),
    latestVersion: SemverSchema,
    updateAvailable: z.boolean(),
  })
  .strict();
export type ConnectorHeartbeatResponse = z.infer<typeof ConnectorHeartbeatResponse>;

/**
 * `POST /connector/tally/batches` with `Idempotency-Key`. `fromAlterId` must equal the cursor the
 * server holds for the company, so a gap or an overlap is refused (`conflict`, reason
 * `cursor_mismatch`) and the connector re-reads from `GET /connector/tally/cursor`.
 */
export const ConnectorBatchRequest = z
  .object({
    company: TallyCompanySchema,
    entityCode: EntityCodeSchema,
    fromAlterId: AlterIdSchema,
    maxAlterId: AlterIdSchema,
    vouchers: z.array(TallyVoucher).max(500),
    ledgers: z.array(TallyLedger).max(2000),
  })
  .strict()
  .refine((v) => v.maxAlterId >= v.fromAlterId, {
    message: 'maxAlterId is below fromAlterId',
    path: ['maxAlterId'],
  })
  .refine(
    (v) =>
      [...v.vouchers, ...v.ledgers].every(
        (row) => row.alterId > v.fromAlterId && row.alterId <= v.maxAlterId,
      ),
    { message: 'a row lies outside the batch range', path: ['vouchers'] },
  )
  .refine((v) => new Set(v.vouchers.map((x) => x.guid)).size === v.vouchers.length, {
    message: 'a voucher appears twice',
    path: ['vouchers'],
  });
export type ConnectorBatchRequest = z.infer<typeof ConnectorBatchRequest>;

export const ConnectorBatchResponse = z
  .object({
    company: TallyCompanySchema,
    accepted: z
      .object({
        vouchersNew: z.number().int().min(0),
        vouchersChanged: z.number().int().min(0),
        vouchersUnchanged: z.number().int().min(0),
        ledgers: z.number().int().min(0),
      })
      .strict(),
    /** The cursor after this batch; the connector's next `fromAlterId`. */
    lastAlterId: AlterIdSchema,
  })
  .strict();
export type ConnectorBatchResponse = z.infer<typeof ConnectorBatchResponse>;

/**
 * `POST /connector/tally/snapshot`, daily: every voucher GUID Tally holds for the company up to
 * `asOf`. A GUID the BOS holds that is missing here becomes a tombstone for review.
 */
export const ConnectorSnapshotRequest = z
  .object({
    company: TallyCompanySchema,
    entityCode: EntityCodeSchema,
    asOf: z.iso.datetime(),
    fromDate: DateOnlySchema,
    voucherGuids: z.array(TallyGuidSchema).max(500_000),
  })
  .strict();
export type ConnectorSnapshotRequest = z.infer<typeof ConnectorSnapshotRequest>;

export const ConnectorSnapshotResponse = z
  .object({
    company: TallyCompanySchema,
    known: z.number().int().min(0),
    tombstoned: z.number().int().min(0),
    /** GUIDs in the snapshot the BOS has not received yet; the connector re-reads them. */
    missingOnServer: z.array(TallyGuidSchema).max(1000),
  })
  .strict();
export type ConnectorSnapshotResponse = z.infer<typeof ConnectorSnapshotResponse>;

/** `GET /connector/tally/cursor?company=`. */
export const ConnectorCursorQuery = z.object({ company: TallyCompanySchema }).strict();
export type ConnectorCursorQuery = z.infer<typeof ConnectorCursorQuery>;

export const ConnectorCursorResponse = z
  .object({
    company: TallyCompanySchema,
    /** Zero before the first batch: the connector starts a full read. */
    lastAlterId: AlterIdSchema,
    updatedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type ConnectorCursorResponse = z.infer<typeof ConnectorCursorResponse>;

/**
 * `GET /connector/release`: the latest release manifest, signed by CI. The connector installs an
 * update only when `signature` verifies over `version`, `sha256` and `url` with the release key
 * it ships with.
 */
export const ConnectorReleaseResponse = z
  .object({
    version: SemverSchema,
    minimumVersion: SemverSchema,
    url: z.url({ protocol: /^https$/ }),
    sha256: z.hash('sha256'),
    signature: z.base64(),
    publishedAt: z.iso.datetime(),
  })
  .strict();
export type ConnectorReleaseResponse = z.infer<typeof ConnectorReleaseResponse>;
