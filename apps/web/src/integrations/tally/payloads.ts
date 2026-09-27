import {
  ConnectorBatchRequest,
  ConnectorHeartbeatRequest,
  ConnectorSnapshotRequest,
  TallyVoucherTypeSchema,
  type TallyVoucherType,
} from '@shakti/contracts';

/**
 * The bodies the Tally connector pushes (docs/API.md §3.5), read as untrusted input through the
 * published connector contracts (`packages/contracts/src/api/connector.ts`). The routes and the
 * Phase 5 tables (`tally_vouchers`, `tally_purchase_vouchers`, tombstones, heartbeats) do not exist
 * yet, so nothing here is stored.
 */

/** The contract's limits, named for the harness that slices a read into batches. */
export const MAX_VOUCHERS_PER_BATCH = 500;
export const MAX_SNAPSHOT_GUIDS = 500_000;

export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: string[] };

interface Issue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
}

/**
 * `vouchers[0].date` for the path `['vouchers', 0, 'date']`. A rule across fields (a duplicate
 * voucher, a row outside the batch range) keeps its message after the path.
 */
function problemAt(issue: Issue): string {
  const path = issue.path
    .map((part, i) =>
      typeof part === 'number' ? `[${String(part)}]` : `${i === 0 ? '' : '.'}${String(part)}`,
    )
    .join('');
  if (issue.code === 'custom') return path === '' ? issue.message : `${path}: ${issue.message}`;
  return path;
}

function parsed<T>(
  result: { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } },
): Parsed<T> {
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, problems: [...new Set(result.error.issues.map(problemAt))] };
}

/** `POST /connector/tally/batches`. */
export function parseBatch(body: unknown): Parsed<ConnectorBatchRequest> {
  return parsed(ConnectorBatchRequest.safeParse(body));
}

/** `POST /connector/tally/heartbeat`. */
export function parseHeartbeat(body: unknown): Parsed<ConnectorHeartbeatRequest> {
  return parsed(ConnectorHeartbeatRequest.safeParse(body));
}

/** `POST /connector/tally/snapshot`. */
export function parseSnapshot(body: unknown): Parsed<ConnectorSnapshotRequest> {
  return parsed(ConnectorSnapshotRequest.safeParse(body));
}

/** Purchase and debit-note vouchers land in the restricted table behind `procurement.rate.read`. */
export function isRestrictedVoucher(type: TallyVoucherType): boolean {
  return type === 'purchase' || type === 'debit_note';
}

/**
 * The BOS voucher type for Tally's type name, or undefined for a type the BOS does not read
 * (journals, contra, payments). A company may rename its types; the discovery visit confirms the
 * names, and a renamed type is mapped here.
 */
export function voucherTypeOf(typeName: string): TallyVoucherType | undefined {
  const key = typeName.trim().toLowerCase().replaceAll(/\s+/g, '_');
  const result = TallyVoucherTypeSchema.safeParse(key);
  return result.success ? result.data : undefined;
}
