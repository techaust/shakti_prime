import { DomainError, newId, PrintProofDto, RequestPrintProofInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

/**
 * `print.proof.request` (docs/design/phase1.md §6.4): an Executive asks for a one-page proof of
 * a company's letterhead, logo, address, GSTIN and bank account. The command emits
 * `print.document.requested` for a `company_letterhead_proof`; the render worker prints it with the
 * same loader and Chromium as every document and records the PDF as a `print_proof` file whose id
 * is the proof's id, which the screen waits for. Nothing else is stored.
 */
export const requestPrintProof = defineCommand({
  name: 'print.proof.request',
  permission: 'admin.entities.write',
  minScope: 'all',
  input: RequestPrintProofInput,
  output: PrintProofDto,
  auditFields: ['documentType'],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const e = schema.entities;
    const [entity] = await ctx.tx
      .select({ id: e.id })
      .from(e)
      .where(eq(e.id, input.entityId))
      .limit(1);
    if (entity === undefined) {
      throw new DomainError('not_found', 'entity not visible in this scope', {
        entityId: input.entityId,
      });
    }
    const proofId = newId();
    const documentType = 'company_letterhead_proof';
    ctx.emit({
      type: 'print.document.requested',
      entityId: input.entityId,
      aggregateType: 'print_proof',
      aggregateId: proofId,
      payload: { documentType, documentId: proofId, version: 1 },
    });
    ctx.audit({
      aggregateType: 'print_proof',
      aggregateId: proofId,
      entityId: input.entityId,
      after: { documentType },
    });
    return { proofId, entityId: input.entityId, requestedAt: ctx.now.toISOString() };
  },
});
