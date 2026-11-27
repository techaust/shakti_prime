import { BeginUploadInput, DomainError, newId, UploadSlotDto } from '@shakti/contracts';
import { schema } from '@shakti/db';
import { defineCommand } from '../../command/define-command';
import { uploadKey, uploadLimitProblem } from '../../files/limits';
import { maskIdentityText } from '../../imports/identity-columns';
import { uploadPermission } from '../../files/purposes';
import { assertEntityInScope } from '../imports/shared';
import { findPersonalNumbers, lastFourOnly, replaceNumbers } from '../../privacy/number-shapes';
import { fireUpload } from './shared';

/**
 * A customer document's name as kept (SECURITY §5): every Aadhaar- or phone-shaped number in it,
 * whether or not its check digit holds, keeps only its last four digits.
 */
export function customerDocumentName(name: string): string {
  return replaceNumbers(name, findPersonalNumbers(name), (_, written) => lastFourOnly(written));
}

/**
 * `files.upload.begin` (docs/04-architecture.md §9): checks the type and size against the purpose's
 * limits and records the file as `pending` under a key the server makes. The web layer then signs
 * the upload address for that key; the bytes never pass through the app.
 */
export const beginUpload = defineCommand({
  name: 'files.upload.begin',
  permission: uploadPermission,
  // Only people upload: an agent holding a purpose's permission (the Concierge's documents.write
  // for J7) still never begins an upload (SECURITY §3.3). A person's own recorded Teach session
  // uploads its recording as the person (SECURITY §3.4).
  peopleOnly: true,
  voiceSession: true,
  input: BeginUploadInput,
  output: UploadSlotDto,
  auditFields: ['fileStatus', 'purpose', 'contentType', 'size'],
  unmaskedFields: [
    // A file's SHA-256 in hexadecimal, checked against the stored bytes.
    'sha256',
  ],
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
      // An import file's name is shown on its job and kept after its bytes go, so an Aadhaar
      // number in it keeps only its last four digits (audit SEC-1); a customer document's name is
      // often the number it carries, so every such number in it keeps only its last four.
      name:
        input.purpose === 'import'
          ? maskIdentityText(input.name)
          : input.purpose === 'customer_document'
            ? customerDocumentName(input.name)
            : input.name,
      // J3: the customer a customer document is for; the restrictive insert policy holds it to a
      // customer of the company within the uploader's documents.write scope.
      accountId: input.accountId ?? null,
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
