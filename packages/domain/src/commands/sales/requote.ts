import { CreateQuoteInput, newId, QuoteDto, RequoteInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { asc, eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readQuote } from '../../queries/sales/quote-dto';
import { buildQuote } from '../../queries/sales/quote-facts';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { QUOTE_AUDIT_FIELDS, saveQuote } from '../../sales/save-quote';
import { lockQuote, quoteRecordOf } from './quote-shared';

/** A stored quantity (`5.000`) as the input takes it (`5`). */
const plainQty = (qty: string) => (qty.includes('.') ? qty.replace(/\.?0+$/, '') : qty);

/**
 * `sales.quote.requote` (docs/design/phase1.md §7.3, BLUEPRINT §8.3): one click makes a new quote
 * of the same items and quantities at today's prices and tax rates, checked against the lead's
 * sizing again, with a new number and a fresh validity; the old quote is kept as superseded, with
 * a version of it as it stood. Allowed on a draft, a sent or an expired quote (the quote machine);
 * a quote is replaced once.
 */
export const requoteQuote = defineCommand({
  name: 'sales.quote.requote',
  permission: 'sales.quote.create',
  minScope: 'own',
  input: RequoteInput,
  output: QuoteDto,
  auditFields: [...QUOTE_AUDIT_FIELDS],
  constraintReasons: {
    quotes_supersedes_unique: 'concurrent_change',
    quotes_entity_quote_no_unique: 'concurrent_change',
  },
  async handler(ctx, input) {
    const old = await lockQuote(ctx, input.entityId, input.quoteId);
    const result = transition(quoteMachine, quoteRecordOf(old), 'requote', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    const l = schema.quoteLines;
    const lines = await ctx.tx
      .select({ itemId: l.itemId, kitId: l.kitId, qty: l.qty, worksContract: l.worksContract })
      .from(l)
      .where(eq(l.quoteId, old.id))
      .orderBy(asc(l.position));
    const built = await buildQuote(
      ctx,
      CreateQuoteInput.parse({
        entityId: old.entityId,
        opportunityId: old.opportunityId,
        scheme: old.scheme,
        lines: lines.map((line) => ({
          ...(line.itemId === null ? {} : { itemId: line.itemId }),
          ...(line.kitId === null ? {} : { kitId: line.kitId }),
          qty: plainQty(line.qty),
          worksContract: line.worksContract,
        })),
      }),
    );
    const id = await saveQuote(ctx, built, old.id);

    await ctx.tx
      .update(schema.quotes)
      .set({ state: result.to, stateChangedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.quotes.id, old.id));
    const v = schema.quoteVersions;
    const [last] = await ctx.tx
      .select({ version: sql<number>`coalesce(max(${v.version}), 0)::int` })
      .from(v)
      .where(eq(v.quoteId, old.id));
    await ctx.tx.insert(v).values({
      id: newId(),
      entityId: old.entityId,
      quoteId: old.id,
      version: (last?.version ?? 0) + 1,
      snapshotJson: {
        quoteNo: old.quoteNo,
        state: result.to,
        stateBefore: old.state,
        supersededById: id,
        validUntil: old.validUntil.toISOString(),
        pdfFileId: old.pdfFileId,
        totals: {
          subtotal: old.subtotal,
          cgst: old.cgst,
          sgst: old.sgst,
          igst: old.igst,
          taxTotal: old.taxTotal,
          roundOff: old.roundOff,
          grandTotal: old.grandTotal,
        },
      },
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: old.id,
      entityId: old.entityId,
      before: { state: old.state },
      after: { state: result.to, supersededById: id },
    });
    ctx.emit({
      type: 'sales.quote.superseded',
      entityId: old.entityId,
      aggregateType: 'quote',
      aggregateId: old.id,
      payload: { opportunityId: old.opportunityId, supersededById: id },
    });
    return readQuote(ctx, old.entityId, id);
  },
});
