import {
  AttachCallRecordingDto,
  AttachCallRecordingInput,
  CALL_RECORDING_ATTACH_OUTCOMES,
  DeleteCallRecordingDto,
  DeleteCallRecordingInput,
  DomainError,
  PROVIDER_CALL_ENDS,
  PROVIDER_CALL_RECORD_OUTCOMES,
  ProviderCallDto,
  ProviderCallRecordDto,
  ProviderCallStatusSchema,
  RecordProviderCallInput,
  type ProviderCallStatus,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { assertEntityInScope } from '../imports/shared';

// What the platform records of a provider call (docs/03-roadmap-appendix/phase2.md §6.3): its
// status as the provider reports it, its recording copied into the file store, and the
// recording's removal after the retention period. Each runs as `system:workers` with the
// platform-only `calls.process` and writes only through its definer (DATABASE §4.1), which checks
// the grant itself; no command here reads a customer row.

type ProviderCallRow = typeof schema.providerCalls.$inferSelect;

/** A provider call as a screen reads it: never its phones or the provider's id. */
export function toProviderCallDto(row: ProviderCallRow): ProviderCallDto {
  return ProviderCallDto.parse({
    id: row.id,
    entityId: row.entityId,
    opportunityId: row.opportunityId,
    callerId: row.callerId,
    direction: row.direction,
    series: row.series,
    purpose: row.purpose,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationS: row.durationS,
    hasRecording: row.recordingFileId !== null,
    callId: row.callId,
  });
}

/** The ends of a call, after which no report changes it. */
export function isCallEnd(status: ProviderCallStatus): boolean {
  return (PROVIDER_CALL_ENDS as readonly string[]).includes(status);
}

interface RecordedRow {
  outcome: string;
  status_moved: boolean;
  status: string | null;
  opportunity_id: string | null;
  caller_id: string | null;
  ended_at: Date | string | null;
  duration_s: number | null;
}

/**
 * `calls.provider_call.record` (`calls.process`): what the provider reported for a call of the
 * company, through `app.record_provider_call()`. The provider's id is taken when the call has none
 * yet; a status further on than the call's moves it there, with its answer and end times and its
 * length, each kept once set. The same or an earlier status, a repeat or a late report, changes
 * nothing back (`unchanged`); a call that holds another provider id is left alone
 * (`other_call`). A call that reaches its end emits `calls.dial.completed`. Audited only when it
 * changed something.
 */
export const recordProviderCall = defineCommand({
  name: 'calls.provider_call.record',
  permission: 'calls.process',
  minScope: 'entity',
  input: RecordProviderCallInput,
  output: ProviderCallRecordDto,
  auditFields: ['callStatus', 'durationSeconds', 'endedAt'],
  auditWhen: 'changed',
  unmaskedFields: [
    // The provider's own id of the call (Exotel's CallSid), a long string of letters and digits.
    'callSid',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const rows = (await ctx.tx.execute(sql`
      select outcome, status_moved, status, opportunity_id, caller_id, ended_at, duration_s
        from app.record_provider_call(${input.entityId}::smallint, ${input.providerCallId}::uuid,
                                      ${input.callSid ?? null}::text, ${input.status}::text,
                                      ${input.answeredAt ?? null}::timestamptz,
                                      ${input.endedAt ?? null}::timestamptz,
                                      ${input.durationSeconds ?? null}::integer)`)) as unknown as RecordedRow[];
    const [row] = rows;
    if (!row) throw new DomainError('internal', 'the provider call record answered no row');
    const outcome = PROVIDER_CALL_RECORD_OUTCOMES.find((o) => o === row.outcome);
    if (outcome === undefined) {
      throw new DomainError('internal', `unknown record outcome ${row.outcome}`);
    }
    const status = row.status === null ? null : ProviderCallStatusSchema.parse(row.status);
    if (outcome === 'moved' && status !== null) {
      const endedAt =
        row.ended_at === null ? null : new Date(row.ended_at).toISOString();
      ctx.audit({
        aggregateType: 'provider_call',
        aggregateId: input.providerCallId,
        entityId: input.entityId,
        after: { callStatus: status, durationSeconds: row.duration_s, endedAt },
      });
      // Only the report that moved the call to its end emits, so a repeat never emits again.
      if (row.status_moved && isCallEnd(status) && row.opportunity_id !== null) {
        ctx.emit({
          type: 'calls.dial.completed',
          entityId: input.entityId,
          aggregateType: 'provider_call',
          aggregateId: input.providerCallId,
          payload: {
            opportunityId: row.opportunity_id,
            callerId: row.caller_id,
            status,
            durationSeconds: row.duration_s,
          },
        });
      }
    }
    return { providerCallId: input.providerCallId, outcome, status };
  },
});

/** The key a call recording is stored under: `<company>/call_recording/<file id>.<mp3 or wav>`. */
export function callRecordingKey(
  entityId: number,
  fileId: string,
  contentType: 'audio/mpeg' | 'audio/wav',
): string {
  return `${String(entityId)}/call_recording/${fileId}.${contentType === 'audio/mpeg' ? 'mp3' : 'wav'}`;
}

/**
 * `calls.recording.attach` (`calls.process`): the recording the platform copied from the provider
 * into the file store (never keeping the provider's link), recorded as the ended call's
 * `call_recording` file, ready, through `app.attach_call_recording()`. The platform picks the
 * file's id, so a delivery that runs again finds the file it recorded (`already`); a call with
 * another recording (`other_file`), one not ended (`not_ended`) or none of the company
 * (`missing`) changes nothing.
 */
export const attachCallRecording = defineCommand({
  name: 'calls.recording.attach',
  permission: 'calls.process',
  minScope: 'entity',
  input: AttachCallRecordingInput,
  output: AttachCallRecordingDto,
  auditFields: ['fileStatus', 'purpose', 'size'],
  auditWhen: 'changed',
  unmaskedFields: [
    // The recording's SHA-256 in hexadecimal, as the store holds it.
    'sha256',
  ],
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    if (input.key !== callRecordingKey(input.entityId, input.fileId, input.contentType)) {
      throw new DomainError('validation_failed', 'a call recording is stored under its own key', {
        reason: 'file_upload_mismatch',
      });
    }
    const name = input.contentType === 'audio/mpeg' ? 'call-recording.mp3' : 'call-recording.wav';
    const rows = (await ctx.tx.execute(sql`
      select outcome, file_id
        from app.attach_call_recording(${input.entityId}::smallint, ${input.providerCallId}::uuid,
                                       ${input.fileId}::uuid, ${input.bucket}::text,
                                       ${input.key}::text, ${name}::text,
                                       ${input.contentType}::text, ${input.size}::integer,
                                       ${input.sha256}::text)`)) as unknown as {
      outcome: string;
      file_id: string | null;
    }[];
    const [row] = rows;
    const outcome = CALL_RECORDING_ATTACH_OUTCOMES.find((o) => o === row?.outcome);
    if (row === undefined || outcome === undefined) {
      throw new DomainError('internal', 'the recording attach answered no outcome');
    }
    if (outcome === 'attached') {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: input.fileId,
        entityId: input.entityId,
        after: { fileStatus: 'ready', purpose: 'call_recording', size: input.size },
      });
    }
    return { providerCallId: input.providerCallId, outcome, fileId: row.file_id };
  },
});

/**
 * `calls.recording.delete` (`calls.process`): the nightly sweep removed a recording's bytes from
 * the file store after `WORKSHOP_DEFAULTS.retention.callRecordingMonths`; its file is marked
 * deleted through `app.drop_call_recording()`, and the file's row and the call's stay. A file
 * already removed, of another purpose or another company changes nothing.
 */
export const deleteCallRecording = defineCommand({
  name: 'calls.recording.delete',
  permission: 'calls.process',
  minScope: 'entity',
  input: DeleteCallRecordingInput,
  output: DeleteCallRecordingDto,
  auditFields: ['deletedAt'],
  auditWhen: 'changed',
  async handler(ctx, input) {
    assertEntityInScope(ctx.entityIds, input.entityId);
    const [row] = (await ctx.tx.execute(sql`
      select app.drop_call_recording(${input.entityId}::smallint, ${input.fileId}::uuid) as deleted`)) as unknown as {
      deleted: boolean;
    }[];
    const deleted = row?.deleted === true;
    if (deleted) {
      ctx.audit({
        aggregateType: 'file',
        aggregateId: input.fileId,
        entityId: input.entityId,
        after: { deletedAt: ctx.now.toISOString() },
      });
    }
    return { fileId: input.fileId, deleted };
  },
});
