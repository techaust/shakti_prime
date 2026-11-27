import {
  DomainError,
  newId,
  TallyBatchIngestDto,
  TallyBatchIngestInput,
  TallyHeartbeatRecordDto,
  TallyHeartbeatRecordInput,
  TallySnapshotConfirmDto,
  TallySnapshotConfirmInput,
  TallySnapshotRecordDto,
  TallySnapshotRecordInput,
  type TallyVoucher,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import type { Actor } from '../../state-machines/define-machine';
import {
  tallyVoucherMachine,
  type TallyVoucherEvent,
  type TallyVoucherState,
} from '../../state-machines/machines/tally-voucher';
import { transition } from '../../state-machines/define-machine';
import {
  checkBatch,
  DEFAULT_SNAPSHOT_LIMITS,
  diffSnapshot,
  type StoredVoucher,
} from '../../tally/sync-rules';
import { assertEntityInScope } from '../imports/shared';

// TC2 Tally ingest (docs/03-roadmap-appendix/phase5.md §6.3, docs/06-api.md §3.5, ADR 0013). The
// batch, snapshot and heartbeat commands run as a connector's own principal
// (`connector:tally:<id>`, role `system:tally_connector`), which holds only the platform-only
// `tally.connector.sync` and the companies mapped to it. They read and write nothing but through
// the definers of the TC2 migration, each of which checks the connector and its mapping again. The
// BOS stores what Tally says and never writes back.

/** The platform's actor for the machine: a connector's push is the platform's, not a person's. */
const CONNECTOR: Actor = { kind: 'system', job: 'tally-connector' };

/** Purchases and debit notes: the restricted table (`procurement.rate.read`). */
const RESTRICTED_TYPES: ReadonlySet<string> = new Set(['purchase', 'debit_note']);

const textArray = (values: readonly string[]) =>
  `{${values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`;
const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

interface KnownVoucher {
  guid: string;
  type: string;
  alter_id: string | number;
  state: TallyVoucherState;
  voucher_date: string;
  received_at: string | Date;
}

/** The stored vouchers of a company with these GUIDs, or every one of them (null). */
async function knownVouchers(
  ctx: CommandContext,
  entityId: number,
  company: string,
  guids: readonly string[] | null,
): Promise<KnownVoucher[]> {
  return (await ctx.tx.execute(sql`
    select guid, type, alter_id, state, voucher_date::text as voucher_date, received_at
      from app.tally_vouchers_known(${entityId}::smallint, ${company}::text,
                                    ${guids === null ? null : textArray(guids)}::text[])`)) as unknown as KnownVoucher[];
}

function fire(
  state: TallyVoucherState | null,
  event: TallyVoucherEvent,
  actor: Actor,
  now: Date,
  inSnapshot = true,
): TallyVoucherState {
  return transition(tallyVoucherMachine, { state, matchFound: false, inSnapshot }, event, {
    actor,
    now,
    params: {},
  }).to;
}

/** A voucher as the write definer reads it, with the state its machine gave it. */
function voucherRow(voucher: TallyVoucher, state: TallyVoucherState) {
  return {
    id: newId(),
    guid: voucher.guid,
    alter_id: voucher.alterId,
    type: voucher.type,
    type_name: voucher.typeName,
    voucher_no: voucher.voucherNo,
    voucher_date: voucher.date,
    party_name: voucher.partyName,
    party_gstin: voucher.partyGstin,
    buyer_order_no: voucher.buyerOrderNo,
    amount: voucher.amount,
    is_cancelled: voucher.isCancelled,
    is_optional: voucher.isOptional,
    payload: { ledgerEntries: voucher.ledgerEntries, inventoryEntries: voucher.inventoryEntries },
    state,
  };
}

/**
 * `tally.batch.ingest`: one signed batch of one Tally company. Its `fromAlterId` must equal the
 * cursor the BOS holds (locked for the call), so a gap or an overlap answers `cursor_mismatch` and
 * the connector reads the cursor again; a resend under the same `Idempotency-Key` is answered from
 * the first call and applied once. `checkBatch` keeps the newest AlterID of each GUID; a voucher
 * already stored at that AlterID or later is left as it is. New vouchers are `ingest`ed, changed
 * ones `alter`ed (a tombstoned one keeps its state), purchases and debit notes go to the
 * restricted table, ledgers keep their newest AlterID, and the cursor moves forward to the batch's
 * `maxAlterId`. One audit row per batch, on the company's cursor, with the counts only.
 */
export const ingestTallyBatch = defineCommand({
  name: 'tally.batch.ingest',
  permission: 'tally.connector.sync',
  minScope: 'entity',
  input: TallyBatchIngestInput,
  output: TallyBatchIngestDto,
  auditFields: ['lastAlterId', 'vouchersNew', 'vouchersChanged', 'vouchersUnchanged', 'ledgers'],
  // A batch holds party names and amounts; the audit row keeps its range and sizes only.
  auditInput: (input) => ({
    entityId: input.entityId,
    company: input.batch.company,
    fromAlterId: input.batch.fromAlterId,
    maxAlterId: input.batch.maxAlterId,
    vouchers: input.batch.vouchers.length,
    ledgers: input.batch.ledgers.length,
  }),
  constraintReasons: {
    tally_vouchers_guid_unique: 'tally_voucher_other_company',
    tally_ledgers_guid_unique: 'tally_voucher_other_company',
    tally_cursors_alter_id_check: 'cursor_mismatch',
  },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const { batch } = input;
    const [cursor] = (await ctx.tx.execute(sql`
      select id, last_alter_id
        from app.tally_cursor_lock(${input.entityId}::smallint, ${batch.company}::text,
                                   ${newId()}::uuid)`)) as unknown as {
      id: string;
      last_alter_id: string | number;
    }[];
    if (cursor === undefined) throw new DomainError('internal', 'the cursor answered nothing');
    const at = Number(cursor.last_alter_id);
    if (batch.fromAlterId !== at) {
      throw new DomainError('conflict', 'the batch does not start at the cursor', {
        reason: 'cursor_mismatch',
        lastAlterId: at,
      });
    }
    const checked = checkBatch(at, { maxAlterId: batch.maxAlterId, vouchers: batch.vouchers });
    if (!checked.ok) {
      throw new DomainError(
        checked.problem === 'batch_max_below_cursor' ? 'conflict' : 'validation_failed',
        `the batch was refused: ${checked.problem}`,
        {
          reason:
            checked.problem === 'batch_max_below_cursor'
              ? 'cursor_mismatch'
              : 'tally_batch_invalid',
        },
      );
    }
    const byGuid = new Map(batch.vouchers.map((v) => [v.guid, v]));
    const known = new Map(
      (
        await knownVouchers(
          ctx,
          input.entityId,
          batch.company,
          checked.outcome.fresh.map((v) => v.guid),
        )
      ).map((k) => [k.guid, k]),
    );
    const rows: ReturnType<typeof voucherRow>[] = [];
    let vouchersNew = 0;
    let vouchersChanged = 0;
    let vouchersUnchanged = checked.outcome.stale.length;
    for (const ref of checked.outcome.fresh) {
      const voucher = byGuid.get(ref.guid);
      if (voucher === undefined) continue;
      const stored = known.get(ref.guid);
      if (stored === undefined) {
        rows.push(voucherRow(voucher, fire(null, 'ingest', CONNECTOR, ctx.now)));
        vouchersNew += 1;
        continue;
      }
      if (Number(stored.alter_id) >= voucher.alterId) {
        vouchersUnchanged += 1;
        continue;
      }
      if (RESTRICTED_TYPES.has(stored.type) !== RESTRICTED_TYPES.has(voucher.type)) {
        throw new DomainError('conflict', 'a voucher changed between purchase and sale', {
          reason: 'tally_voucher_type_changed',
        });
      }
      // A tombstoned voucher sent again keeps its state; the next snapshot lists it as reappeared.
      const state =
        stored.state === 'tombstoned' || stored.state === 'reversed'
          ? stored.state
          : fire(stored.state, 'alter', CONNECTOR, ctx.now);
      rows.push(voucherRow(voucher, state));
      vouchersChanged += 1;
    }
    if (rows.length > 0) {
      await ctx.tx.execute(sql`
        select app.tally_vouchers_write(${input.entityId}::smallint, ${batch.company}::text,
                                        ${JSON.stringify(rows)}::jsonb)`);
    }
    let ledgers = 0;
    if (batch.ledgers.length > 0) {
      const [written] = (await ctx.tx.execute(sql`
        select app.tally_ledgers_write(${input.entityId}::smallint, ${batch.company}::text,
          ${JSON.stringify(
            batch.ledgers.map((l) => ({
              id: newId(),
              guid: l.guid,
              alter_id: l.alterId,
              name: l.name,
              parent: l.parent,
              gstin: l.gstin,
              opening_balance: l.openingBalance,
              closing_balance: l.closingBalance,
              as_of: l.asOf,
            })),
          )}::jsonb) as n`)) as unknown as { n: number }[];
      ledgers = written?.n ?? 0;
    }
    const lastAlterId = checked.outcome.cursor;
    await ctx.tx.execute(sql`
      select app.tally_cursor_move(${input.entityId}::smallint, ${batch.company}::text,
                                   ${lastAlterId}::bigint)`);
    const accepted = { vouchersNew, vouchersChanged, vouchersUnchanged, ledgers };
    ctx.audit({
      aggregateType: 'tally_cursor',
      aggregateId: cursor.id,
      entityId: input.entityId,
      before: { lastAlterId: at },
      after: { lastAlterId, ...accepted },
    });
    return { company: batch.company, accepted, lastAlterId };
  },
});

/** The GUIDs a snapshot over the limits would remove, for the person who confirms it. */
const NO_LIMITS = { maxShare: 1, alwaysAllow: Number.MAX_SAFE_INTEGER } as const;

/** The most GUIDs the connector is asked to send again in one answer (the contract's limit). */
const MISSING_SHOWN = 1000;

/**
 * Tombstones the stored vouchers of a snapshot: each through the machine's `tombstone` (gone from
 * the snapshot), then one definer call that marks them and appends their rows.
 */
async function tombstone(
  ctx: CommandContext,
  snapshotId: string,
  vouchers: readonly { guid: string; state: TallyVoucherState }[],
  actor: Actor,
): Promise<number> {
  const guids: string[] = [];
  for (const voucher of vouchers) {
    if (voucher.state === 'tombstoned' || voucher.state === 'reversed') continue;
    fire(voucher.state, 'tombstone', actor, ctx.now, false);
    guids.push(voucher.guid);
  }
  if (guids.length === 0) return 0;
  const [done] = (await ctx.tx.execute(sql`
    select app.tally_tombstone(${snapshotId}::uuid, ${textArray(guids)}::text[],
                               ${uuidArray(guids.map(() => newId()))}::uuid[]) as n`)) as unknown as {
    n: number;
  }[];
  return done?.n ?? 0;
}

/**
 * `tally.snapshot.record`: the daily list of every voucher GUID Tally holds for a company from
 * `fromDate` up to `asOf`. `diffSnapshot` compares it with the stored vouchers of those dates:
 * one stored before the snapshot was taken and missing from it is deleted or cancelled in Tally
 * and becomes a tombstone; GUIDs never received are sent back for the connector to read again.
 * A snapshot that would remove more than the limits allow (`DEFAULT_SNAPSHOT_LIMITS`: a tenth of
 * the live vouchers and more than twenty) is far likelier a wrong company or an empty export: it
 * is held with the GUIDs it would remove until Accounts confirms it (`tally.snapshot.confirm`).
 */
export const recordTallySnapshot = defineCommand({
  name: 'tally.snapshot.record',
  permission: 'tally.connector.sync',
  minScope: 'entity',
  input: TallySnapshotRecordInput,
  output: TallySnapshotRecordDto,
  auditFields: ['state', 'guidCount', 'tombstoned', 'missing', 'reappeared', 'ledgers'],
  auditInput: (input) => ({
    entityId: input.entityId,
    company: input.snapshot.company,
    asOf: input.snapshot.asOf,
    fromDate: input.snapshot.fromDate,
    guids: input.snapshot.voucherGuids.length,
    ledgerBalances: input.ledgerBalances?.length ?? 0,
  }),
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const { snapshot } = input;
    const asOf = new Date(snapshot.asOf);
    const stored = (await knownVouchers(ctx, input.entityId, snapshot.company, null)).filter(
      // A voucher dated before the snapshot's first date is not in its list by design.
      (v) => v.voucher_date >= snapshot.fromDate,
    );
    const storedVouchers: StoredVoucher[] = stored.map((v) => ({
      guid: v.guid,
      receivedAt: new Date(v.received_at),
      tombstoned: v.state === 'tombstoned' || v.state === 'reversed',
    }));
    const list = { voucherGuids: snapshot.voucherGuids, asOf };
    const checked = diffSnapshot(storedVouchers, list, DEFAULT_SNAPSHOT_LIMITS);
    // Over the limits, the same diff without them names the GUIDs the person would confirm.
    const unlimited = checked.ok ? checked : diffSnapshot(storedVouchers, list, NO_LIMITS);
    if (!unlimited.ok)
      throw new DomainError('internal', 'the snapshot diff refused without limits');
    const { tombstones, missing, reappeared } = unlimited.diff;
    const state: 'applied' | 'held' = checked.ok ? 'applied' : 'held';
    const live = storedVouchers.filter((v) => !v.tombstoned).length;
    const id = newId();
    const guidCount = new Set(snapshot.voucherGuids).size;
    await ctx.tx.execute(sql`
      select app.tally_snapshot_write(${id}::uuid, ${input.entityId}::smallint,
        ${snapshot.company}::text, ${snapshot.asOf}::timestamptz, ${snapshot.fromDate}::date,
        ${guidCount}::integer, ${live}::integer,
        ${state === 'applied' ? tombstones.length : 0}::integer, ${missing.length}::integer,
        ${reappeared.length}::integer, ${state}::text,
        ${textArray(state === 'held' ? tombstones : [])}::text[],
        ${textArray(missing.slice(0, MISSING_SHOWN))}::text[])`);
    let tombstoned = 0;
    if (state === 'applied' && tombstones.length > 0) {
      const states = new Map(stored.map((v) => [v.guid, v.state]));
      tombstoned = await tombstone(
        ctx,
        id,
        tombstones.map((guid) => ({ guid, state: states.get(guid) ?? 'received' })),
        CONNECTOR,
      );
    }
    let ledgers = 0;
    if (input.ledgerBalances !== undefined && input.ledgerBalances.length > 0) {
      const [changed] = (await ctx.tx.execute(sql`
        select app.tally_ledger_balances_write(${input.entityId}::smallint,
          ${snapshot.company}::text,
          ${JSON.stringify(
            input.ledgerBalances.map((b) => ({
              guid: b.guid,
              closing_balance: b.closingBalance,
              as_of: b.asOf,
            })),
          )}::jsonb) as n`)) as unknown as { n: number }[];
      ledgers = changed?.n ?? 0;
    }
    ctx.audit({
      aggregateType: 'tally_snapshot',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        ledgers,
        state,
        guidCount,
        tombstoned: state === 'held' ? tombstones.length : tombstoned,
        missing: missing.length,
        reappeared: reappeared.length,
      },
    });
    return {
      snapshotId: id,
      state,
      response: {
        company: snapshot.company,
        known: guidCount - missing.length,
        tombstoned,
        missingOnServer: missing.slice(0, MISSING_SHOWN),
      },
    };
  },
});

/**
 * `tally.snapshot.confirm`: Accounts (`finance.recon.write`, a person) confirms a held snapshot of
 * a company of the request; the vouchers it would remove that are still live and were stored
 * before it was taken become tombstones, and the snapshot is confirmed. A snapshot a newer one
 * has superseded, or one already confirmed, is no longer waiting.
 */
export const confirmTallySnapshot = defineCommand({
  name: 'tally.snapshot.confirm',
  permission: 'finance.recon.write',
  minScope: 'entity',
  peopleOnly: true,
  input: TallySnapshotConfirmInput,
  output: TallySnapshotConfirmDto,
  auditFields: ['state', 'tombstoned'],
  constraintReasons: { tally_snapshot_not_held: 'tally_snapshot_not_held' },
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [held] = (await ctx.tx.execute(sql`
      select entity_id, tally_company, state, held_guids
        from app.tally_snapshot_held(${input.snapshotId}::uuid)`)) as unknown as {
      entity_id: number;
      tally_company: string;
      state: string;
      held_guids: string[];
    }[];
    if (held?.entity_id !== input.entityId) {
      throw new DomainError('not_found', 'no such snapshot', { reason: 'tally_snapshot_missing' });
    }
    if (held.state !== 'held') {
      throw new DomainError('conflict', 'the snapshot is not waiting', {
        reason: 'tally_snapshot_not_held',
      });
    }
    const known = await knownVouchers(ctx, input.entityId, held.tally_company, held.held_guids);
    const tombstoned = await tombstone(
      ctx,
      input.snapshotId,
      known.map((v) => ({ guid: v.guid, state: v.state })),
      { kind: 'principal', principal: ctx.principal },
    );
    if (tombstoned === 0) {
      // Nothing left to remove: the snapshot is confirmed all the same.
      await ctx.tx.execute(sql`
        select app.tally_tombstone(${input.snapshotId}::uuid, '{}'::text[], '{}'::uuid[])`);
    }
    ctx.audit({
      aggregateType: 'tally_snapshot',
      aggregateId: input.snapshotId,
      entityId: input.entityId,
      before: { state: 'held' },
      after: { state: 'confirmed', tombstoned },
    });
    return { snapshotId: input.snapshotId, tombstoned };
  },
});

/**
 * `tally.heartbeat.record`: the connector's version, Tally's, its outbox depth and each mapped
 * company's reach and last AlterID, every five minutes. A company it names that is not mapped to
 * it is left out. Written for Integration health and the silence alert; nothing is audited, since
 * a heartbeat changes no business record.
 */
export const recordTallyHeartbeat = defineCommand({
  name: 'tally.heartbeat.record',
  permission: 'tally.connector.sync',
  minScope: 'entity',
  input: TallyHeartbeatRecordInput,
  output: TallyHeartbeatRecordDto,
  auditFields: [],
  auditWhen: 'changed',
  async handler(ctx, input) {
    const { heartbeat } = input;
    const [row] = (await ctx.tx.execute(sql`
      select app.tally_heartbeat_write(${heartbeat.connectorVersion}::text,
        ${heartbeat.tallyVersion}::text, ${heartbeat.queueDepth}::integer,
        ${JSON.stringify(
          heartbeat.companies.map((c) => ({
            name: c.name,
            last_alter_id: c.lastAlterId,
            reachable: c.reachable,
          })),
        )}::jsonb) as n`)) as unknown as { n: number }[];
    return { companies: row?.n ?? 0 };
  },
});
