import { DomainError, QuoteDto, SendQuoteInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { readQuote } from '../../queries/sales/quote-dto';
import { quoteWhatsAppReadiness } from '../../sales/quote-whatsapp';
import { transition } from '../../state-machines/define-machine';
import { quoteMachine } from '../../state-machines/machines/quote';
import { QUOTE_AUDIT_FIELDS } from '../../sales/save-quote';
import { lockQuote, quoteRecordOf } from './quote-shared';

/**
 * `sales.quote.send` (docs/03-roadmap-appendix/phase1.md §7.3 and phase2.md §7.1, PRD SAL-05): marks
 * a draft quote as sent to the customer. It needs its PDF, which the render worker attaches after
 * the quote is made, and a validity that has not passed (the quote machine's `send` guards).
 * `channel` says how it goes: `recorded` (the default) when the person hands the PDF over
 * themselves, or `whatsapp`, when the company's number sends it on the customer's chat with the
 * PDF and an Accept button. WhatsApp is refused, before anything changes, when the customer has no
 * chat with the company (`whatsapp_quote_no_chat`), the number opted out (`whatsapp_opted_out`), no
 * holder of the number gave WhatsApp consent (`whatsapp_quote_no_consent`) or the company has no
 * approved quote template (`whatsapp_quote_template_missing`). The message itself is queued by the
 * platform on `sales.quote.sent`, which names the chat (`messaging.milestone.send`, `quote_sent`).
 */
export const sendQuote = defineCommand({
  name: 'sales.quote.send',
  permission: 'sales.quote.send',
  minScope: 'own',
  input: SendQuoteInput,
  output: QuoteDto,
  auditFields: [...QUOTE_AUDIT_FIELDS, 'sendChannel'],
  async handler(ctx, input) {
    const row = await lockQuote(ctx, input.entityId, input.quoteId);
    const result = transition(quoteMachine, quoteRecordOf(row), 'send', {
      actor: { kind: 'principal', principal: ctx.principal },
      now: ctx.now,
      params: {},
    });
    if (row.pdfFileId === null) throw new DomainError('internal', 'sent without a PDF');
    let threadId: string | null = null;
    if (input.channel === 'whatsapp') {
      const readiness = await quoteWhatsAppReadiness(ctx, row.entityId, row.accountId);
      if (!readiness.ready) {
        throw new DomainError('conflict', 'the quote cannot go by WhatsApp', {
          reason: readiness.reason,
        });
      }
      threadId = readiness.threadId;
    }
    await ctx.tx
      .update(schema.quotes)
      .set({ state: result.to, stateChangedAt: ctx.now, updatedBy: ctx.principal.id })
      .where(eq(schema.quotes.id, row.id));
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { state: row.state },
      after: { state: result.to, sendChannel: input.channel },
    });
    ctx.emit({
      type: 'sales.quote.sent',
      entityId: row.entityId,
      aggregateType: 'quote',
      aggregateId: row.id,
      payload: {
        opportunityId: row.opportunityId,
        pdfFileId: row.pdfFileId,
        channel: input.channel,
        threadId,
        sentBy: ctx.principal.id,
      },
    });
    return readQuote(ctx, row.entityId, row.id);
  },
});
