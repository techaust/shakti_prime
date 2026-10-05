import { DomainError, QuoteDto, QuoteRefInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readQuote } from '../../queries/sales/quote-dto';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { QUOTE_AUDIT_FIELDS } from '../../sales/save-quote';
import { lockQuote, quoteRecordOf } from './quote-shared';

/**
 * `sales.quote.send` (docs/design/phase1.md §7.3, PRD SAL-05): marks a draft quote as sent to the
 * customer. It needs its PDF, which the render worker attaches after the quote is made, and a
 * validity that has not passed (the quote machine's `send` guards). Phase 1 hands the PDF over by
 * hand; `sales.quote.sent` is the event the WhatsApp dispatch of Phase 2 will listen to.
 */
export const sendQuote = defineCommand({
  name: 'sales.quote.send',
  permission: 'sales.quote.send',
  minScope: 'own',
  input: QuoteRefInput,
  output: QuoteDto,
  auditFields: [...QUOTE_AUDIT_FIELDS],
  async handler(ctx, input) {
    const row = await lockQuote(ctx, input.entityId, input.quoteId);
    const result = transition(quoteMachine, quoteRecordOf(row), 'send', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    if (row.pdfFileId === null) throw new DomainError('internal', 'sent without a PDF');
    await ctx.tx
      .update(schema.quotes)
      .set({ state: result.to, stateChangedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.quotes.id, row.id));
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: result.to },
    });
    ctx.emit({
      type: 'sales.quote.sent',
      entityId: row.entityId,
      aggregateType: 'quote',
      aggregateId: row.id,
      payload: { opportunityId: row.opportunityId, pdfFileId: row.pdfFileId },
    });
    return readQuote(ctx, row.entityId, row.id);
  },
});
