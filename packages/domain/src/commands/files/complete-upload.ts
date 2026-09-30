import { CompleteUploadInput, FileDto } from '@shakti/contracts';
import { defineCommand } from '../../command/define-command';
import { uploadPermission } from '../../files/purposes';
import type { FileUploadState } from '../../state-machines/machines/file-upload';
import { fireUpload, lockFile, toFileDto, writeFile } from './shared';

/**
 * `files.upload.complete`: the uploader says the bytes landed. The server read the object from
 * the store first (`stored`); its size and SHA-256 must be the ones the upload declared, then the
 * file waits for its checks (`scanning`) and `files.file.uploaded` starts them.
 */
export const completeUpload = defineCommand({
  name: 'files.upload.complete',
  permission: uploadPermission,
  input: CompleteUploadInput,
  output: FileDto,
  auditFields: ['fileStatus'],
  async handler(ctx, input) {
    const row = await lockFile(ctx, input.fileId, input.purpose);
    const storedMatches = input.stored.size === row.size && input.stored.sha256 === row.sha256;
    const { to } = fireUpload(
      ctx,
      { state: row.status as FileUploadState, storedMatches },
      'complete',
      {},
      uploadPermission.of(input),
    );
    const updated = await writeFile(ctx, row, { status: to });
    ctx.audit({
      aggregateType: 'file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { fileStatus: row.status },
      after: { fileStatus: to },
    });
    ctx.emit({
      type: 'files.file.uploaded',
      entityId: row.entityId,
      aggregateType: 'file',
      aggregateId: row.id,
      payload: { purpose: input.purpose },
    });
    return toFileDto(updated);
  },
});
