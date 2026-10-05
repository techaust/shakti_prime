import { AttachQuotePdfInput, DomainError, QuotePdfDto } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

/**
 * `sales.quote.pdf.attach` (ADR 0009, docs/design/phase1.md §7.3): the render worker attaches the
 * PDF it printed and recorded (`files.document.record`) to its quote, so the quote can be sent.
 * Only the worker principal holds `files.process`, and it reaches the quote only through
 * `app.attach_quote_pdf()`, which takes a ready `quote_pdf` file of the quote's company and a
 * quote with no PDF yet or this one already: a delivery that runs again attaches nothing new.
 */
export const attachQuotePdf = defineCommand({
  name: 'sales.quote.pdf.attach',
  permission: 'files.process',
  minScope: 'entity',
  input: AttachQuotePdfInput,
  output: QuotePdfDto,
  auditFields: [],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const rows = (await ctx.tx.execute(
      sql`select app.attach_quote_pdf(${input.entityId}::smallint, ${input.quoteId}::uuid, ${input.fileId}::uuid) as attached`,
    )) as unknown as { attached: boolean }[];
    if (rows[0]?.attached !== true) {
      throw new DomainError('conflict', `quote ${input.quoteId} takes no PDF ${input.fileId}`, {
        reason: 'quote_pdf_mismatch',
      });
    }
    ctx.audit({
      aggregateType: 'quote',
      aggregateId: input.quoteId,
      entityId: input.entityId,
      after: { pdfFileId: input.fileId },
    });
    return { quoteId: input.quoteId, pdfFileId: input.fileId };
  },
});
