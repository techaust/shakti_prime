import { AttachProformaPdfInput, DomainError, ProformaPdfDto } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

/**
 * `finance.proforma.pdf.attach` (ADR 0009, docs/03-roadmap-appendix/phase5.md §6.1): the render
 * worker attaches the PDF it printed and recorded (`files.document.record`) to its proforma. Only
 * the worker principal holds `files.process`, and it reaches the proforma only through
 * `app.attach_proforma_pdf()`, which takes a ready `proforma_pdf` file of the proforma's company
 * and a proforma with no PDF yet or this one already: a delivery that runs again attaches nothing
 * new.
 */
export const attachProformaPdf = defineCommand({
  name: 'finance.proforma.pdf.attach',
  permission: 'files.process',
  minScope: 'entity',
  input: AttachProformaPdfInput,
  output: ProformaPdfDto,
  auditFields: [],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const rows = (await ctx.tx.execute(
      sql`select app.attach_proforma_pdf(${input.entityId}::smallint, ${input.proformaId}::uuid, ${input.fileId}::uuid) as attached`,
    )) as unknown as { attached: boolean }[];
    if (rows[0]?.attached !== true) {
      throw new DomainError(
        'conflict',
        `proforma ${input.proformaId} takes no PDF ${input.fileId}`,
        { reason: 'proforma_pdf_mismatch' },
      );
    }
    ctx.audit({
      aggregateType: 'proforma',
      aggregateId: input.proformaId,
      entityId: input.entityId,
      after: { pdfFileId: input.fileId },
    });
    return { proformaId: input.proformaId, pdfFileId: input.fileId };
  },
});
