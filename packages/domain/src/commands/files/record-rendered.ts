import { DomainError, FileDto, RecordRenderedFileInput } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { uploadKey } from '../../files/limits';
import { assertEntityInScope } from '../imports/shared';
import { toFileDto } from './shared';

/**
 * `files.document.record` (ADR 0009, docs/03-roadmap-appendix/phase1.md §6.4): the render worker records a PDF
 * it rendered and stored, as `ready`, with the key its purpose and id name
 * (`<company>/<purpose>/<file id>.pdf`). It is not an upload: the worker made it from the BOS's own
 * template, so it skips the upload machine and its checks, as an import file stored by the import
 * screen does. Only the worker principal holds `files.process`. The worker picks the file's id
 * from the job, so a delivery that runs again finds the file it recorded and answers it unchanged;
 * an id already used for another file of another purpose, key or company is refused.
 */
export const recordRenderedFile = defineCommand({
  name: 'files.document.record',
  permission: 'files.process',
  minScope: 'entity',
  input: RecordRenderedFileInput,
  output: FileDto,
  auditFields: ['fileStatus', 'purpose', 'contentType', 'size'],
  // The file's name carries the document's number or the company's name; it stays out.
  auditInput: (input) => ({
    entityId: input.entityId,
    fileId: input.fileId,
    purpose: input.purpose,
    size: input.size,
  }),
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const key = uploadKey(input.entityId, input.purpose, input.fileId, 'application/pdf');
    if (input.key !== key) {
      throw new DomainError('validation_failed', 'a rendered file is stored under its own key', {
        reason: 'file_upload_mismatch',
      });
    }
    const f = schema.files;
    const [existing] = await ctx.tx.select().from(f).where(eq(f.id, input.fileId)).limit(1);
    if (existing !== undefined) {
      const same =
        existing.entityId === input.entityId &&
        existing.purpose === input.purpose &&
        existing.key === key &&
        existing.status === 'ready';
      if (!same) {
        throw new DomainError('conflict', `file ${input.fileId} is another file`, {
          reason: 'file_upload_mismatch',
        });
      }
      return toFileDto(existing);
    }
    const to = 'ready';
    const [row] = await ctx.tx
      .insert(f)
      .values({
        id: input.fileId,
        entityId: input.entityId,
        purpose: input.purpose,
        bucket: input.bucket,
        key,
        name: input.name,
        contentType: 'application/pdf',
        size: input.size,
        sha256: input.sha256,
        status: to,
        scanResult: { scanner: 'none', sanitising: 'rendered' },
        createdBy: ctx.principal.id,
      })
      .returning();
    if (!row) throw new DomainError('internal', `file ${input.fileId} insert returned no row`);
    ctx.audit({
      aggregateType: 'file',
      aggregateId: row.id,
      entityId: row.entityId,
      after: {
        fileStatus: to,
        purpose: input.purpose,
        contentType: 'application/pdf',
        size: input.size,
      },
    });
    return toFileDto(row);
  },
});
