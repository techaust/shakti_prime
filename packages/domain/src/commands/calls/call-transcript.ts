import {
  AttachCallTranscriptDto,
  AttachCallTranscriptInput,
  CALL_TRANSCRIPT_ATTACH_OUTCOMES,
  CALL_TRANSCRIPT_RESERVE_OUTCOMES,
  callTranscriptKey,
  DomainError,
  ReserveCallTranscriptDto,
  ReserveCallTranscriptInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

/**
 * `calls.transcript.attach` (docs/03-roadmap-appendix/phase2.md §7.3, the platform's
 * `calls.process`): the Caller Co-pilot's summary worker transcribed a call's recording, masked
 * the text and stored it under the call's transcript key; it is recorded here as the call's
 * `call_transcript` file through `app.attach_call_transcript()` (the file reserved by
 * `calls.transcript.reserve` made `ready`), once, for an ended call whose
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
    checkKey(input);
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

/** The key check both commands make: a transcript is stored under its own key. */
function checkKey(input: { entityId: number; fileId: string; key: string }): void {
  if (input.key !== callTranscriptKey(input.entityId, input.fileId)) {
    throw new DomainError('validation_failed', 'a call transcript is stored under its own key', {
      reason: 'file_upload_mismatch',
    });
  }
}

/**
 * `calls.transcript.reserve` (docs/03-roadmap-appendix/phase2.md §7.3, the platform's
 * `calls.process`): before the summary worker stores a call's masked transcript, its file is
 * recorded `pending` through `app.reserve_call_transcript()`, for an ended call with no transcript
 * whose recording is still kept and whose lead is not anonymised. The bytes stored after it always
 * have a row: if the run stops before `calls.transcript.attach`, the sweep of abandoned uploads
 * (`files.upload.sweep`) refuses the row a day later and deletes what landed under its key.
 */
export const reserveCallTranscript = defineCommand({
  name: 'calls.transcript.reserve',
  permission: 'calls.process',
  minScope: 'entity',
  input: ReserveCallTranscriptInput,
  output: ReserveCallTranscriptDto,
  auditFields: ['fileStatus', 'purpose', 'size'],
  auditWhen: 'changed',
  unmaskedFields: [
    // The transcript's SHA-256 in hexadecimal, as the store will hold it.
    'sha256',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    checkKey(input);
    const rows = (await ctx.tx.execute(sql`
      select outcome, file_id
        from app.reserve_call_transcript(${input.entityId}::smallint, ${input.providerCallId}::uuid,
                                         ${input.fileId}::uuid, ${input.bucket}::text,
                                         ${input.key}::text, ${input.size}::integer,
                                         ${input.sha256}::text)`)) as unknown as {
      outcome: string;
      file_id: string | null;
    }[];
    const [row] = rows;
    const outcome = CALL_TRANSCRIPT_RESERVE_OUTCOMES.find((o) => o === row?.outcome);
    if (row === undefined || outcome === undefined) {
      throw new DomainError('internal', 'the transcript reserve answered no outcome');
    }
    if (outcome === 'reserved') {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: input.fileId,
        entityId: input.entityId,
        after: { fileStatus: 'pending', purpose: 'call_transcript', size: input.size },
      });
    }
    return { providerCallId: input.providerCallId, outcome, fileId: row.file_id };
  },
});
