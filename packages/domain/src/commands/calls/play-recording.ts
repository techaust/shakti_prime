import {
  CallRecordingContentTypeSchema,
  CallRecordingToPlayDto,
  DomainError,
  PlayCallRecordingInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { requireEntity } from '../crm/opportunity-shared';

interface PlayRow {
  file_id: string;
  entity_id: number;
  bucket: string;
  key: string;
  name: string;
  content_type: string;
}

/**
 * `calls.recording.play` (docs/03-roadmap-appendix/phase2.md §6.3, BLUEPRINT §7.6), under
 * `calls.recording.listen`, for people only: where a provider call's recording is stored, for the
 * server to sign a 15-minute address to it. `app.call_recording_to_play()` answers it only to a
 * person whose listen scope covers the call's lead, in a company of the request, while the
 * recording is kept; anything else is not found (`recording_missing`). A command, not a query,
 * so every listen leaves its audit row; the recording is never readable as a file.
 */
export const playCallRecording = defineCommand({
  name: 'calls.recording.play',
  permission: 'calls.recording.listen',
  minScope: 'team',
  peopleOnly: true,
  input: PlayCallRecordingInput,
  output: CallRecordingToPlayDto,
  auditFields: ['listenedAt'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const rows = (await ctx.tx.execute(sql`
      select file_id, entity_id, bucket, key, name, content_type
        from app.call_recording_to_play(${input.providerCallId}::uuid)`)) as unknown as PlayRow[];
    const row = rows.find((r) => r.entity_id === input.entityId);
    if (row === undefined) {
      throw new DomainError('not_found', `no recording to play for ${input.providerCallId}`, {
        reason: 'recording_missing',
      });
    }
    ctx.audit({
      aggregateType: 'provider_call',
      aggregateId: input.providerCallId,
      entityId: input.entityId,
      after: { listenedAt: ctx.now.toISOString() },
    });
    return {
      providerCallId: input.providerCallId,
      fileId: row.file_id,
      bucket: row.bucket,
      key: row.key,
      name: row.name,
      contentType: CallRecordingContentTypeSchema.parse(row.content_type),
    };
  },
});
