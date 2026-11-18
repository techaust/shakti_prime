import {
  AttachCallTranscriptDto,
  AttachCallTranscriptInput,
  CALL_TRANSCRIPT_ATTACH_OUTCOMES,
  callTranscriptKey,
  DomainError,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

/**
 * `calls.transcript.attach` (docs/03-roadmap-appendix/phase2.md §7.3, the platform's
 * `calls.process`): the Caller Co-pilot's summary worker transcribed a call's recording, masked
 * the text and stored it under the call's transcript key; it is recorded here as the call's
 * `call_transcript` file through `app.attach_call_transcript()`, once, for an ended call whose
 * recording is still kept and whose lead is not anonymised. Read with the call by whoever reads
 * the lead; never by an agent's or a person's write.
 */
export const attachCallTranscript = defineCommand({
  name: 'calls.transcript.attach',
  permission: 'calls.process',
  minScope: 'entity',
  input: AttachCallTranscriptInput,
  output: AttachCallTranscriptDto,
  auditFields: ['fileStatus', 'purpose', 'size'],
  auditWhen: 'changed',
  unmaskedFields: [
    // The transcript's SHA-256 in hexadecimal, as the store holds it.
    'sha256',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    if (input.key !== callTranscriptKey(input.entityId, input.fileId)) {
      throw new DomainError('validation_failed', 'a call transcript is stored under its own key', {
        reason: 'file_upload_mismatch',
      });
    }
    const rows = (await ctx.tx.execute(sql`
      select outcome, file_id
        from app.attach_call_transcript(${input.entityId}::smallint, ${input.providerCallId}::uuid,
                                        ${input.fileId}::uuid, ${input.bucket}::text,
                                        ${input.key}::text, ${input.size}::integer,
                                        ${input.sha256}::text)`)) as unknown as {
      outcome: string;
      file_id: string | null;
    }[];
    const [row] = rows;
    const outcome = CALL_TRANSCRIPT_ATTACH_OUTCOMES.find((o) => o === row?.outcome);
    if (row === undefined || outcome === undefined) {
      throw new DomainError('internal', 'the transcript attach answered no outcome');
    }
    if (outcome === 'attached') {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: input.fileId,
        entityId: input.entityId,
        after: { fileStatus: 'ready', purpose: 'call_transcript', size: input.size },
      });
    }
    return { providerCallId: input.providerCallId, outcome, fileId: row.file_id };
  },
});
