import { BeginUploadInput, DomainError, newId, UploadSlotDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { defineCommand } from '../../command/define-command';
import { uploadKey, uploadLimitProblem } from '../../files/limits';
import { uploadPermission } from '../../files/purposes';
import { assertEntityInScope } from '../imports/shared';
import { fireUpload } from './shared';

/**
 * `files.upload.begin` (docs/ARCHITECTURE.md §9): checks the type and size against the purpose's
 * limits and records the file as `pending` under a key the server makes. The web layer then signs
 * the upload address for that key; the bytes never pass through the app.
 */
export const beginUpload = defineCommand({
  name: 'files.upload.begin',
  permission: uploadPermission,
  input: BeginUploadInput,
  output: UploadSlotDto,
  auditFields: ['fileStatus', 'purpose', 'contentType', 'size'],
  // The file's name is what a person called it, which can carry a customer's name; it stays out.
  auditInput: (input) => ({
    entityId: input.entityId,
    purpose: input.purpose,
    contentType: input.contentType,
    size: input.size,
  }),
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const problem = uploadLimitProblem(input.purpose, input.contentType, input.size);
    if (problem !== undefined) {
      throw new DomainError('validation_failed', `upload outside the ${input.purpose} limits`, {
        reason: problem,
      });
    }
    const { to } = fireUpload(
      ctx,
      { state: null, storedMatches: null },
      'upload',
      {},
      uploadPermission.of(input),
    );
    const fileId = newId();
    const key = uploadKey(input.entityId, input.purpose, fileId, input.contentType);
    // No `returning`: a person may upload a file they cannot read back until it is theirs.
    await ctx.tx.insert(schema.files).values({
      id: fileId,
      entityId: input.entityId,
      purpose: input.purpose,
      bucket: input.bucket,
      key,
      name: input.name,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
      status: to,
      createdBy: ctx.principal.id,
    });
    ctx.audit({
      aggregateType: 'file',
      aggregateId: fileId,
      entityId: input.entityId,
      after: {
        fileStatus: to,
        purpose: input.purpose,
        contentType: input.contentType,
        size: input.size,
      },
    });
    return {
      fileId,
      entityId: input.entityId,
      key,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
    };
  },
});
