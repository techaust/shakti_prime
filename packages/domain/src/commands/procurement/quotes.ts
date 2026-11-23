import {
  DomainError,
  newId,
  RecordVendorQuoteInput,
  VendorQuoteDto,
  WithdrawVendorQuoteInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { defineCommand } from '../../command/define-command';
import { quoteDay, readQuotes } from '../../queries/procurement/vendor-read';
import { eventEntity } from '../catalogue/shared';
import { lockVendor } from './vendors';

/**
 * Supplier quotes (docs/03-roadmap-appendix/phase3.md §6.3): recorded and withdrawn by a holder of
 * both `procurement.rate.read` and `procurement.po.write` (the Executive and the Inventory
 * Manager), in the quote's company, or acting for every company for a quote given to the group.
 * The rate is never written to an audit row, an event or a log line: the audit records the ids,
 * the company (the row's own) and the validity only.
 */

const QUOTE_AUDIT_FIELDS = ['quoteValidFrom', 'quoteValidUntil', 'withdrawnAt'] as const;

/** The company a quote belongs to must be the request's; a group quote needs every company. */
async function assertQuoteCompany(ctx: CommandContext, entityId: number | null): Promise<void> {
  if (entityId === null) {
    const covered = (await ctx.tx.execute(
      sql`select app.request_covers_group() as ok`,
    )) as unknown as { ok: boolean }[];
    if (covered[0]?.ok !== true) {
      throw new DomainError('forbidden', 'a group quote needs every company in scope', {
        reason: 'vendor_quote_needs_all_companies',
      });
    }
    return;
  }
  if (!ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
}

/**
 * The quote document, when one is named: a ready `vendor_quote` file the caller uploaded and no
 * other quote names, stored in the quote's company (any company of the request for a group quote).
 */
async function assertQuoteFile(
  ctx: CommandContext,
  fileId: string,
  entityId: number | null,
): Promise<void> {
  const f = schema.files;
  const [file] = await ctx.tx
    .select({ entityId: f.entityId })
    .from(f)
    .where(
      and(
        eq(f.id, fileId),
        eq(f.purpose, 'vendor_quote'),
        eq(f.status, 'ready'),
        isNull(f.deletedAt),
        // The caller's own upload (review L8), named by no other quote.
        eq(f.createdBy, ctx.principal.id),
        sql`not exists (select 1 from vendor_quotes q where q.file_id = ${f.id})`,
      ),
    )
    .limit(1);
  if (!file || (entityId !== null && file.entityId !== entityId)) {
    throw new DomainError('validation_failed', `file ${fileId} is not a ready quote document`, {
      reason: 'vendor_quote_file_missing',
    });
  }
}

/**
 * `procurement.quote.record`: a supplier's rate for an item, for one company or the group, from
 * one date to another. The vendor must be active and the item still in the catalogue; a quote that
 * has already ended is refused (`vendor_quote_ended`).
 */
export const recordVendorQuote = defineCommand({
  name: 'procurement.quote.record',
  permission: 'procurement.rate.read',
  minScope: 'entity',
  alsoRequires: [{ permission: 'procurement.po.write', minScope: 'entity' }],
  peopleOnly: true,
  input: RecordVendorQuoteInput,
  output: VendorQuoteDto,
  auditFields: QUOTE_AUDIT_FIELDS,
  // The audit row keeps what was asked without the rate, which lives only in the quote itself.
  auditInput: (input) => ({
    vendorId: input.vendorId,
    itemId: input.itemId,
    entityId: input.entityId,
    moq: input.moq ?? null,
    leadTimeDays: input.leadTimeDays ?? null,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    fileId: input.fileId ?? null,
  }),
  async handler(ctx, input) {
    await assertQuoteCompany(ctx, input.entityId);
    await lockVendor(ctx, input.vendorId);
    const [item] = await ctx.tx
      .select({ id: schema.items.id })
      .from(schema.items)
      .where(and(eq(schema.items.id, input.itemId), isNull(schema.items.archivedAt)))
      .limit(1);
    if (!item) {
      throw new DomainError('not_found', `item ${input.itemId} is not in the catalogue`, {
        reason: 'catalogue_item_missing',
      });
    }
    if (input.validUntil < quoteDay(ctx.now)) {
      throw new DomainError('validation_failed', 'the quote has already ended', {
        reason: 'vendor_quote_ended',
      });
    }
    if (input.fileId !== undefined && input.fileId !== null) {
      await assertQuoteFile(ctx, input.fileId, input.entityId);
    }
    const id = newId();
    await ctx.tx.insert(schema.vendorQuotes).values({
      id,
      vendorId: input.vendorId,
      itemId: input.itemId,
      entityId: input.entityId,
      rate: input.rate,
      moq: input.moq ?? null,
      leadTimeDays: input.leadTimeDays ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      fileId: input.fileId ?? null,
      recordedBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'vendor_quote',
      aggregateId: id,
      entityId: input.entityId,
      before: null,
      after: {
        vendorId: input.vendorId,
        itemId: input.itemId,
        quoteValidFrom: input.validFrom,
        quoteValidUntil: input.validUntil,
      },
    });
    ctx.emit({
      type: 'procurement.quote.recorded',
      entityId: input.entityId ?? eventEntity(ctx),
      aggregateType: 'vendor_quote',
      aggregateId: id,
      payload: {
        vendorId: input.vendorId,
        itemId: input.itemId,
        forGroup: input.entityId === null,
      },
    });
    const [quote] = await readQuotes(ctx.tx, ctx.principal, ctx.now, { quoteId: id });
    if (!quote) throw new DomainError('internal', 'recorded quote is not readable');
    return quote;
  },
});

/**
 * `procurement.quote.withdraw`: a live or upcoming quote is withdrawn; it stays on record, and a
 * withdrawn quote is never brought back. A quote the caller cannot read answers
 * `vendor_quote_missing`; one already withdrawn `vendor_quote_withdrawn`.
 */
export const withdrawVendorQuote = defineCommand({
  name: 'procurement.quote.withdraw',
  permission: 'procurement.rate.read',
  minScope: 'entity',
  alsoRequires: [{ permission: 'procurement.po.write', minScope: 'entity' }],
  peopleOnly: true,
  input: WithdrawVendorQuoteInput,
  output: VendorQuoteDto,
  auditFields: QUOTE_AUDIT_FIELDS,
  async handler(ctx, input) {
    const q = schema.vendorQuotes;
    const [row] = await ctx.tx
      .select({
        id: q.id,
        vendorId: q.vendorId,
        itemId: q.itemId,
        entityId: q.entityId,
        withdrawnAt: q.withdrawnAt,
      })
      .from(q)
      .where(eq(q.id, input.quoteId))
      .limit(1);
    if (!row) {
      throw new DomainError('not_found', `quote ${input.quoteId} is not readable`, {
        reason: 'vendor_quote_missing',
      });
    }
    if (row.withdrawnAt !== null) {
      throw new DomainError('conflict', `quote ${input.quoteId} is already withdrawn`, {
        reason: 'vendor_quote_withdrawn',
      });
    }
    await assertQuoteCompany(ctx, row.entityId);
    // No lock is taken first: the update policy hides a withdrawn quote, so it would read as
    // missing. The update's own condition lets one of two withdrawals through.
    const [done] = await ctx.tx
      .update(q)
      .set({ withdrawnAt: ctx.now, withdrawnBy: ctx.principal.id })
      .where(and(eq(q.id, input.quoteId), isNull(q.withdrawnAt)))
      .returning({ id: q.id });
    if (!done) {
      throw new DomainError('conflict', `quote ${input.quoteId} changed meanwhile`, {
        reason: 'vendor_quote_withdrawn',
      });
    }
    ctx.audit({
      aggregateType: 'vendor_quote',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { vendorId: row.vendorId, itemId: row.itemId, withdrawnAt: null },
      after: {
        vendorId: row.vendorId,
        itemId: row.itemId,
        withdrawnAt: ctx.now.toISOString(),
      },
    });
    ctx.emit({
      type: 'procurement.quote.withdrawn',
      entityId: row.entityId ?? eventEntity(ctx),
      aggregateType: 'vendor_quote',
      aggregateId: row.id,
      payload: { vendorId: row.vendorId, itemId: row.itemId, forGroup: row.entityId === null },
    });
    const [quote] = await readQuotes(ctx.tx, ctx.principal, ctx.now, { quoteId: row.id });
    if (!quote) throw new DomainError('internal', 'withdrawn quote is not readable');
    return quote;
  },
});
