import {
  DomainError,
  IdentifyWarrantySerialInput,
  newId,
  RaiseWarrantyClaimInput,
  RaiseWarrantyRmaInput,
  RejectWarrantyClaimInput,
  ReplaceWarrantyInput,
  SettleWarrantyClaimInput,
  WarrantyClaimChangedDto,
  type CalendarDate,
  type WarrantyClaimState,
  type WarrantySettlement,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { nextDocumentNo } from '../../numbering/next-document-no';
import { transition } from '../../state-machines/define-machine';
import {
  warrantyClaimMachine,
  type WarrantyClaimEvent,
  type WarrantyClaimParams,
  type WarrantyClaimRecord,
} from '../../state-machines/machines/warranty-claim';
import {
  serialMachine,
  type SerialEvent,
  type SerialRecord,
} from '../../state-machines/machines/serial';
import type { StockMoveLine } from '../../stock/move';
import { postStockMoves, type AuditedMove } from '../../stock/post';
import { assertEntityInScope } from '../imports/shared';

/**
 * Warranty claims and supplier returns (R3, docs/03-roadmap-appendix/phase3.md §7.5, PRD INV-08):
 * one command per event of the `warranty_claim` machine. A claim belongs to one company and one
 * customer; its serial is that company's, delivered to that customer. Audit rows and events carry
 * ids, numbers and states, never a cost: the supplier's credit goes straight to the claim's
 * restricted costs through `app.warranty_claim_record_credit()`, which answers nothing.
 */

/** The claim's fields its audit rows record, besides ids. */
const CLAIM_AUDIT_FIELDS = [
  'claimNo',
  'claimState',
  'reportedFault',
  'rejectedReason',
  'settlement',
  // The stock a step moves, as the stock commands record it (never a cost).
  'stockReason',
  'quantity',
  'serialNo',
  'adjustNote',
] as const;

/** The one open claim a serial may have, which two people raising at once can race for. */
const CLAIM_RACES = { warranty_claims_open_serial_unique: 'warranty_claim_open' } as const;

interface ClaimRow {
  id: string;
  entityId: number;
  claimNo: string;
  accountId: string;
  siteId: string | null;
  itemId: string | null;
  serialId: string | null;
  replacementSerialId: string | null;
  supplierRmaRef: string | null;
  state: WarrantyClaimState;
}

/** The claim of the company named, locked for this transaction's step. */
async function lockClaim(
  ctx: CommandContext,
  entityId: number,
  claimId: string,
): Promise<ClaimRow> {
  assertEntityInScope(ctx.entityIds, entityId);
  const c = schema.warrantyClaims;
  const [row] = await ctx.tx
    .select({
      id: c.id,
      entityId: c.entityId,
      claimNo: c.claimNo,
      accountId: c.accountId,
      siteId: c.siteId,
      itemId: c.itemId,
      serialId: c.serialId,
      replacementSerialId: c.replacementSerialId,
      supplierRmaRef: c.supplierRmaRef,
      state: c.state,
    })
    .from(c)
    .where(and(eq(c.id, claimId), eq(c.entityId, entityId)))
    .for('update')
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', 'warranty claim not found', {
      reason: 'warranty_claim_missing',
    });
  }
  return { ...row, state: row.state as WarrantyClaimState };
}

interface SerialRow {
  id: string;
  entityId: number;
  itemId: string;
  state: string;
  accountId: string | null;
  siteId: string | null;
  warrantyUntil: CalendarDate | null;
}

/** A serial of the company, as row security shows it (`inventory.stock.read`). */
async function serialOf(
  ctx: CommandContext,
  entityId: number,
  serialId: string,
): Promise<SerialRow> {
  const s = schema.serials;
  const [row] = await ctx.tx
    .select({
      id: s.id,
      entityId: s.entityId,
      itemId: s.itemId,
      state: s.state,
      accountId: s.accountId,
      siteId: s.siteId,
      warrantyUntil: s.warrantyUntil,
    })
    .from(s)
    .where(and(eq(s.id, serialId), eq(s.entityId, entityId)))
    .limit(1);
  if (!row) {
    throw new DomainError('not_found', 'serial not found', { reason: 'warranty_serial_unknown' });
  }
  return row;
}

/** The failed serial: delivered, so with a customer, and with the claim's customer. */
function assertWithCustomer(serial: SerialRow, accountId: string | null): void {
  if (serial.state !== 'with_customer') {
    throw new DomainError('conflict', 'serial not with a customer', {
      reason: 'warranty_serial_not_delivered',
      state: serial.state,
    });
  }
  if (accountId !== null && serial.accountId !== accountId) {
    throw new DomainError('validation_failed', 'serial of another customer', {
      reason: 'warranty_serial_other_customer',
    });
  }
}

/** The serial's other open claim, if any (the unique index settles a race). */
async function assertNoOpenClaim(
  ctx: CommandContext,
  serialId: string,
  claimId: string | null,
): Promise<void> {
  const c = schema.warrantyClaims;
  const [open] = await ctx.tx
    .select({ id: c.id })
    .from(c)
    .where(
      and(
        eq(c.serialId, serialId),
        sql`${c.state} not in ('closed', 'rejected')`,
        claimId === null ? undefined : sql`${c.id} <> ${claimId}`,
      ),
    )
    .limit(1);
  if (open) {
    throw new DomainError('conflict', 'serial has an open claim', {
      reason: 'warranty_claim_open',
    });
  }
}

function fire(
  ctx: CommandContext,
  record: WarrantyClaimRecord,
  event: WarrantyClaimEvent,
  params: WarrantyClaimParams = {},
): WarrantyClaimState {
  return transition(warrantyClaimMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params,
  }).to;
}

/** The machine's record of a claim, before its serial's warranty date is read. */
function recordOf(claim: ClaimRow, facts: Partial<WarrantyClaimRecord> = {}): WarrantyClaimRecord {
  return {
    state: claim.state,
    warrantyUntil: null,
    replacementSerialId: claim.replacementSerialId,
    supplierRmaRef: claim.supplierRmaRef,
    supplierSettled: false,
    ...facts,
  };
}

/** Writes the claim's step under the caller's row security; the columns are the step's grant. */
async function writeStep(
  ctx: CommandContext,
  claim: ClaimRow,
  to: WarrantyClaimState,
  changes: Partial<typeof schema.warrantyClaims.$inferInsert>,
): Promise<void> {
  const c = schema.warrantyClaims;
  const updated = await ctx.tx
    .update(c)
    .set({ ...changes, state: to, stateChangedAt: ctx.now, updatedBy: ctx.principal.id })
    .where(eq(c.id, claim.id))
    .returning({ id: c.id });
  if (updated.length !== 1) {
    throw new DomainError('forbidden', 'warranty claim not writable', {
      reason: 'warranty_claim_missing',
    });
  }
}

function changed(claim: ClaimRow, state: WarrantyClaimState) {
  return { id: claim.id, entityId: claim.entityId, claimNo: claim.claimNo, state };
}

/**
 * `inventory.warranty.raise`: a claim on a customer of the company (from Account 360), or on a
 * serial delivered to one (from the serial's page), whose customer and site the claim takes. The
 * number comes from the company's `warranty_claim` series.
 */
export const raiseWarrantyClaim = defineCommand({
  name: 'inventory.warranty.raise',
  permission: 'inventory.warranty.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RaiseWarrantyClaimInput,
  output: WarrantyClaimChangedDto,
  auditFields: CLAIM_AUDIT_FIELDS,
  constraintReasons: CLAIM_RACES,
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    let accountId = input.accountId ?? null;
    let siteId = input.siteId ?? null;
    let serial: SerialRow | null = null;
    if (input.serialId !== undefined) {
      serial = await serialOf(ctx, input.entityId, input.serialId);
      assertWithCustomer(serial, accountId);
      accountId = serial.accountId;
      siteId ??= serial.siteId;
      await assertNoOpenClaim(ctx, serial.id, null);
    }
    if (accountId === null) {
      throw new DomainError('validation_failed', 'no customer', { reason: 'account_missing' });
    }
    // The customer deals with this company, as the caller's row security shows it.
    const ae = schema.accountEntities;
    const [link] = await ctx.tx
      .select({ id: ae.id })
      .from(ae)
      .where(and(eq(ae.accountId, accountId), eq(ae.entityId, input.entityId)))
      .limit(1);
    if (!link) {
      throw new DomainError('not_found', 'customer not found', { reason: 'account_missing' });
    }
    if (siteId !== null) {
      const cs = schema.customerSites;
      const [site] = await ctx.tx
        .select({ id: cs.id })
        .from(cs)
        .where(and(eq(cs.id, siteId), eq(cs.accountId, accountId)))
        .limit(1);
      if (!site) {
        throw new DomainError('validation_failed', 'site not found', { reason: 'site_missing' });
      }
    }
    const state = fire(
      ctx,
      {
        state: null,
        warrantyUntil: null,
        replacementSerialId: null,
        supplierRmaRef: null,
        supplierSettled: false,
      },
      'raise',
    );
    const [company] = await ctx.tx
      .select({ code: schema.entities.code })
      .from(schema.entities)
      .where(eq(schema.entities.id, input.entityId))
      .limit(1);
    if (!company) throw new DomainError('forbidden', 'company not found', {});
    const number = await nextDocumentNo(ctx, input.entityId, company.code, 'warranty_claim');
    const id = newId();
    await ctx.tx.insert(schema.warrantyClaims).values({
      id,
      entityId: input.entityId,
      claimNo: number.formatted,
      accountId,
      siteId,
      itemId: serial?.itemId ?? null,
      serialId: serial?.id ?? null,
      reportedFault: input.reportedFault,
      state,
      stateChangedAt: ctx.now,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: id,
      entityId: input.entityId,
      after: {
        claimNo: number.formatted,
        claimState: state,
        accountId,
        siteId,
        serialId: serial?.id ?? null,
        reportedFault: input.reportedFault,
      },
    });
    ctx.emit({
      type: 'inventory.warranty.raised',
      entityId: input.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: id,
      payload: { accountId, serialId: serial?.id ?? null },
    });
    return { id, entityId: input.entityId, claimNo: number.formatted, state };
  },
});

/**
 * `inventory.warranty.identify_serial`: the failed serial, the company's and delivered to the
 * claim's customer, in warranty while its `warranty_until` is today or later in India; a serial
 * out of warranty is refused with its date (`warranty_expired`).
 */
export const identifyWarrantySerial = defineCommand({
  name: 'inventory.warranty.identify_serial',
  permission: 'inventory.warranty.write',
  minScope: 'entity',
  peopleOnly: true,
  input: IdentifyWarrantySerialInput,
  output: WarrantyClaimChangedDto,
  auditFields: CLAIM_AUDIT_FIELDS,
  constraintReasons: CLAIM_RACES,
  async handler(ctx, input) {
    const claim = await lockClaim(ctx, input.entityId, input.claimId);
    const serial = await serialOf(ctx, claim.entityId, input.serialId);
    const to = fire(
      ctx,
      recordOf(claim, { warrantyUntil: serial.warrantyUntil }),
      'serial.identify',
      {
        serialId: serial.id,
      },
    );
    assertWithCustomer(serial, claim.accountId);
    await assertNoOpenClaim(ctx, serial.id, claim.id);
    await writeStep(ctx, claim, to, { serialId: serial.id, itemId: serial.itemId });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      entityId: claim.entityId,
      before: { claimState: claim.state, serialId: claim.serialId },
      after: { claimState: to, serialId: serial.id },
    });
    ctx.emit({
      type: 'inventory.warranty.serial_identified',
      entityId: claim.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      payload: { serialId: serial.id },
    });
    return changed(claim, to);
  },
});

/** `inventory.warranty.reject`: out of warranty or not a fault, with why, before a replacement. */
export const rejectWarrantyClaim = defineCommand({
  name: 'inventory.warranty.reject',
  permission: 'inventory.warranty.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RejectWarrantyClaimInput,
  output: WarrantyClaimChangedDto,
  auditFields: CLAIM_AUDIT_FIELDS,
  async handler(ctx, input) {
    const claim = await lockClaim(ctx, input.entityId, input.claimId);
    const to = fire(ctx, recordOf(claim), 'reject', { reason: input.rejectedReason });
    await writeStep(ctx, claim, to, { rejectedReason: input.rejectedReason });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      entityId: claim.entityId,
      before: { claimState: claim.state },
      after: { claimState: to, rejectedReason: input.rejectedReason },
    });
    ctx.emit({
      type: 'inventory.warranty.rejected',
      entityId: claim.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      payload: {},
    });
    return changed(claim, to);
  },
});

/** The stock reasons of a claim's steps (constants, so no error catalogue reads them as one). */
const WARRANTY_REPLACEMENT = 'warranty_replacement' as const;
const RETURN_CUSTOMER = 'return_customer' as const;
const RETURN_SUPPLIER = 'return_supplier' as const;

/** A movement's reference to the claim it serves. */
const CLAIM_REF = 'warranty_claim';

interface StepSerial extends SerialRecord {
  id: string;
  serialNo: string;
  accountId: string | null;
  siteId: string | null;
  warrantyUntil: CalendarDate | null;
}

async function stepSerial(
  ctx: CommandContext,
  where: { entityId: number; itemId: string } & ({ id: string } | { serialNo: string }),
): Promise<StepSerial | undefined> {
  const s = schema.serials;
  const [row] = await ctx.tx
    .select({
      id: s.id,
      serialNo: s.serialNo,
      state: s.state,
      binId: s.binId,
      accountId: s.accountId,
      siteId: s.siteId,
      warrantyUntil: s.warrantyUntil,
    })
    .from(s)
    .where(
      and(
        eq(s.entityId, where.entityId),
        eq(s.itemId, where.itemId),
        'id' in where ? eq(s.id, where.id) : sql`lower(${s.serialNo}) = lower(${where.serialNo})`,
      ),
    )
    .limit(1);
  return row === undefined ? undefined : { ...row, state: row.state as SerialRecord['state'] };
}

function fireSerial(
  ctx: CommandContext,
  record: SerialRecord,
  event: SerialEvent,
  fromBinId: string | null,
): void {
  transition(serialMachine, record, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: { fromBinId },
  });
}

/** A bin of a hub for faulty and returned goods, named for a failed serial coming back. */
async function assertQuarantine(ctx: CommandContext, binId: string): Promise<void> {
  const b = schema.bins;
  const [bin] = await ctx.tx.select({ kind: b.kind }).from(b).where(eq(b.id, binId)).limit(1);
  if (bin?.kind !== 'quarantine') {
    throw new DomainError('validation_failed', 'not a quarantine bin', {
      reason: 'warranty_quarantine_bin',
    });
  }
}

/** The claim's failed serial, which every step after identification has. */
async function failedSerialOf(ctx: CommandContext, claim: ClaimRow): Promise<StepSerial> {
  const failed =
    claim.serialId === null || claim.itemId === null
      ? undefined
      : await stepSerial(ctx, {
          entityId: claim.entityId,
          itemId: claim.itemId,
          id: claim.serialId,
        });
  if (!failed) {
    throw new DomainError('not_found', 'serial not found', { reason: 'warranty_serial_unknown' });
  }
  return failed;
}

/** The failed serial back from its customer into a quarantine bin, as a movement line. */
function returnLine(
  claim: ClaimRow,
  itemId: string,
  failed: StepSerial,
  binId: string,
): StockMoveLine {
  return {
    reason: RETURN_CUSTOMER,
    entityId: claim.entityId,
    itemId,
    serialId: failed.id,
    toBinId: binId,
    qty: '1',
    refType: CLAIM_REF,
    refId: claim.id,
  };
}

/**
 * `inventory.warranty.replace`: a replacement of the same product leaves stock to the claim's
 * customer through `app.stock_move()` (`warranty_replacement`, at the moving average), with the
 * claim's site, today's delivery and the failed serial's warranty end (the customer keeps the term
 * they had). When the failed serial is back already, it goes into the quarantine bin named as
 * `faulty` (`return_customer`) in the same batch. The replacement's cost is kept only on the
 * claim's restricted costs (`app.warranty_claim_record_cost()`).
 */
export const replaceWarranty = defineCommand({
  name: 'inventory.warranty.replace',
  permission: 'inventory.warranty.write',
  minScope: 'entity',
  peopleOnly: true,
  input: ReplaceWarrantyInput,
  output: WarrantyClaimChangedDto,
  auditFields: CLAIM_AUDIT_FIELDS,
  unmaskedFields: [
    // A serial number as the maker prints it, which may be a long run of digits.
    'replacementSerialNo',
  ],
  constraintReasons: CLAIM_RACES,
  async handler(ctx, input) {
    const claim = await lockClaim(ctx, input.entityId, input.claimId);
    const failed = await failedSerialOf(ctx, claim);
    const itemId = claim.itemId ?? '';
    const replacement = await stepSerial(ctx, {
      entityId: claim.entityId,
      itemId,
      serialNo: input.replacementSerialNo,
    });
    if (!replacement) {
      throw new DomainError('validation_failed', 'replacement not found', {
        reason: 'stock_serial_unknown',
        serialNo: input.replacementSerialNo,
      });
    }
    const to = fire(ctx, recordOf(claim, { replacementSerialId: replacement.id }), 'replace');
    fireSerial(ctx, replacement, 'replace', input.fromBinId);
    const lines: StockMoveLine[] = [
      {
        reason: WARRANTY_REPLACEMENT,
        entityId: claim.entityId,
        itemId,
        serialId: replacement.id,
        fromBinId: input.fromBinId,
        qty: '1',
        refType: CLAIM_REF,
        refId: claim.id,
        accountId: claim.accountId,
        siteId: claim.siteId,
        deliveredAt: ctx.now,
        warrantyUntil: failed.warrantyUntil,
      },
    ];
    const audited: AuditedMove[] = [
      { stockReason: WARRANTY_REPLACEMENT, quantity: '1', serialNo: replacement.serialNo },
    ];
    if (input.faultyBinId !== undefined) {
      await assertQuarantine(ctx, input.faultyBinId);
      fireSerial(ctx, failed, 'return_faulty', null);
      lines.push(returnLine(claim, itemId, failed, input.faultyBinId));
      audited.push({ stockReason: RETURN_CUSTOMER, quantity: '1', serialNo: failed.serialNo });
    }
    const { movementIds } = await postStockMoves(ctx, claim.entityId, lines, audited, null);
    await ctx.tx.execute(
      sql`select app.warranty_claim_record_cost(${claim.id}::uuid, ${movementIds[0] ?? ''}::uuid)`,
    );
    await writeStep(ctx, claim, to, { replacementSerialId: replacement.id });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      entityId: claim.entityId,
      before: { claimState: claim.state },
      after: { claimState: to, replacementSerialId: replacement.id },
    });
    ctx.emit({
      type: 'inventory.warranty.replaced',
      entityId: claim.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      payload: {
        replacementSerialId: replacement.id,
        faultyReturned: input.faultyBinId !== undefined,
      },
    });
    return changed(claim, to);
  },
});

/**
 * `inventory.warranty.rma_raise` (`procurement.po.write`, phase3 §14): the failed serial goes to
 * its supplier (`return_supplier`, out of its quarantine bin, `faulty` → `with_supplier`), with the
 * supplier's return reference. A failed serial still with the customer comes back first, into the
 * quarantine bin named (`return_customer`), in the same batch.
 */
export const raiseWarrantyRma = defineCommand({
  name: 'inventory.warranty.rma_raise',
  permission: 'procurement.po.write',
  minScope: 'entity',
  peopleOnly: true,
  input: RaiseWarrantyRmaInput,
  output: WarrantyClaimChangedDto,
  auditFields: [...CLAIM_AUDIT_FIELDS, 'supplierRmaRef'],
  unmaskedFields: [
    // The supplier's own return reference, which may be a long run of digits.
    'supplierRmaRef',
  ],
  async handler(ctx, input) {
    const claim = await lockClaim(ctx, input.entityId, input.claimId);
    const to = fire(ctx, recordOf(claim, { supplierRmaRef: input.supplierRmaRef }), 'rma.raise');
    const failed = await failedSerialOf(ctx, claim);
    const itemId = claim.itemId ?? '';
    const v = schema.vendors;
    const [vendor] = await ctx.tx
      .select({ id: v.id, active: v.isActive })
      .from(v)
      .where(eq(v.id, input.vendorId))
      .limit(1);
    if (!vendor?.active) {
      throw new DomainError('validation_failed', 'vendor not found', {
        reason: 'warranty_vendor_missing',
      });
    }
    const lines: StockMoveLine[] = [];
    const audited: AuditedMove[] = [];
    let binId = failed.binId;
    if (failed.state === 'with_customer') {
      if (input.faultyBinId === undefined) {
        throw new DomainError('validation_failed', 'the failed serial is not back', {
          reason: 'warranty_faulty_not_back',
        });
      }
      await assertQuarantine(ctx, input.faultyBinId);
      fireSerial(ctx, failed, 'return_faulty', null);
      lines.push(returnLine(claim, itemId, failed, input.faultyBinId));
      audited.push({ stockReason: RETURN_CUSTOMER, quantity: '1', serialNo: failed.serialNo });
      binId = input.faultyBinId;
      fireSerial(ctx, { state: 'faulty', binId }, 'rma_raise', binId);
    } else {
      fireSerial(ctx, failed, 'rma_raise', failed.binId);
    }
    lines.push({
      reason: RETURN_SUPPLIER,
      entityId: claim.entityId,
      itemId,
      serialId: failed.id,
      fromBinId: binId,
      qty: '1',
      refType: CLAIM_REF,
      refId: claim.id,
    });
    audited.push({ stockReason: RETURN_SUPPLIER, quantity: '1', serialNo: failed.serialNo });
    await postStockMoves(ctx, claim.entityId, lines, audited, null);
    await writeStep(ctx, claim, to, {
      vendorId: vendor.id,
      supplierRmaRef: input.supplierRmaRef,
    });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      entityId: claim.entityId,
      before: { claimState: claim.state },
      after: { claimState: to, vendorId: vendor.id, supplierRmaRef: input.supplierRmaRef },
    });
    ctx.emit({
      type: 'inventory.warranty.rma_raised',
      entityId: claim.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      payload: { vendorId: vendor.id },
    });
    return changed(claim, to);
  },
});

/**
 * `inventory.warranty.settle` (`procurement.grn.write`, phase3 §14): the supplier's credit closes
 * the claim. The amount goes only to the claim's restricted costs, through
 * `app.warranty_claim_record_credit()`; the audit row and the event name the settlement, never the
 * amount.
 */
export const settleWarrantyClaim = defineCommand({
  name: 'inventory.warranty.settle',
  permission: 'procurement.grn.write',
  minScope: 'entity',
  peopleOnly: true,
  input: SettleWarrantyClaimInput,
  output: WarrantyClaimChangedDto,
  // The audit row's input leaves the credit out: it is a cost (finance.cost.read).
  auditInput: (input) => ({
    entityId: input.entityId,
    claimId: input.claimId,
    settlement: input.settlement,
  }),
  auditFields: CLAIM_AUDIT_FIELDS,
  async handler(ctx, input) {
    const claim = await lockClaim(ctx, input.entityId, input.claimId);
    // The guard reads the settlement as recorded, which the definer does next in this transaction.
    const to = fire(ctx, recordOf(claim, { supplierSettled: true }), 'settle');
    await ctx.tx.execute(
      sql`select app.warranty_claim_record_credit(${claim.id}::uuid, ${input.creditAmount}::numeric)`,
    );
    const settlement: WarrantySettlement = input.settlement;
    await writeStep(ctx, claim, to, { settlement });
    ctx.audit({
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      entityId: claim.entityId,
      before: { claimState: claim.state },
      after: { claimState: to, settlement },
    });
    ctx.emit({
      type: 'inventory.warranty.closed',
      entityId: claim.entityId,
      aggregateType: 'warranty_claim',
      aggregateId: claim.id,
      payload: { settlement },
    });
    return changed(claim, to);
  },
});
