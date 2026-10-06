import { QuoteDto, WithdrawQuoteInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readQuote } from '../../queries/sales/quote-dto';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { QUOTE_AUDIT_FIELDS } from '../../sales/save-quote';
import { lockQuote, quoteRecordOf } from './quote-shared';

/**
 * `sales.quote.withdraw` (docs/design/phase1.md §7.3): a draft or sent quote no longer stands, for
 * the reason the person gives, which the quote keeps. A withdrawn quote is never sent, accepted or
 * re-quoted; a new quote is made instead.
 */
export const withdrawQuote = defineCommand({
  name: 'sales.quote.withdraw',
  permission: 'sales.quote.send',
  minScope: 'own',
  input: WithdrawQuoteInput,
  output: QuoteDto,
  auditFields: [...QUOTE_AUDIT_FIELDS, 'withdrawnReason'],
  async handler(ctx, input) {
    const row = await lockQuote(ctx, input.entityId, input.quoteId);
    const result = transition(quoteMachine, quoteRecordOf(row), 'withdraw', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: { reason: input.reason },
    });
    await ctx.tx
      .update(schema.quotes)
      .set({
        state: result.to,
        stateChangedAt: ctx.now,
        withdrawnReason: input.reason,
        updatedBy: ctx.principal.id,
      })
      .where(eq(schema.quotes.id, row.id));
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: result.to, withdrawnReason: input.reason },
    });
    ctx.emit({
      type: 'sales.quote.withdrawn',
      entityId: row.entityId,
      aggregateType: 'quote',
      aggregateId: row.id,
      payload: { opportunityId: row.opportunityId },
    });
    return readQuote(ctx, row.entityId, row.id);
  },
});
