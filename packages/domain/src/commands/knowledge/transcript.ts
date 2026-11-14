import {
  CorrectKnowledgeTranscriptInput,
  DomainError,
  isRomanScript,
  KNOWLEDGE_TRANSCRIPT_MAX_CHARS,
  KnowledgeFileDetailDto,
  KnowledgeSensitivitySchema,
  KnowledgeTranscriptRecordDto,
  RecordKnowledgeTranscriptInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { maskWholeText } from '../../knowledge/passages';
import type { KnowledgeFileMachineState } from '../../state-machines/machines/knowledge-file';
import { requireEntity } from '../crm/opportunity-shared';
import {
  fireKnowledgeFile,
  holdVaultUpload,
  knowledgeFileDto,
  knowledgeFileForIndex,
  lockKnowledgeFile,
} from './shared';

/*
 * A vault recording's transcript (docs/03-roadmap-appendix/phase2.md §6.4, BLUEPRINT §9.1, ADR
 * 0014): the index job keeps what the speech service heard as the file's text, and a person who
 * may change the file corrects it, which reads the file again from the correction. Either way the
 * transcript is Roman script only, with its personal numbers masked before it is stored, as the
 * passages cut from it are; the audit rows count its characters and never hold its words.
 */

/** Refuses a transcript in any script but Roman (ADR 0014), naming none of its words. */
function assertRoman(transcript: string): void {
  if (!isRomanScript(transcript)) {
    throw new DomainError('validation_failed', 'a transcript is written in Roman script', {
      reason: 'knowledge_transcript_not_roman',
    });
  }
}

/**
 * `knowledge.file.record_transcript`: the transcript of a waiting vault recording, kept by the
 * index job (`system:workers`, `knowledge.index`) through `app.record_knowledge_transcript()`
 * before it cuts it into passages. A file that already has one (a delivery that ran again, or a
 * person's correction) or is no longer waiting keeps what it has, and the answer says so.
 */
export const recordKnowledgeTranscript = defineCommand({
  name: 'knowledge.file.record_transcript',
  permission: 'knowledge.index',
  minScope: 'entity',
  input: RecordKnowledgeTranscriptInput,
  output: KnowledgeTranscriptRecordDto,
  auditFields: ['transcriptChars'],
  auditInput: (input) => ({
    knowledgeFileId: input.knowledgeFileId,
    transcriptChars: input.transcript.length,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await knowledgeFileForIndex(ctx.tx, input.knowledgeFileId);
    if (facts?.fileEntityId !== input.entityId) {
      throw new DomainError('not_found', `vault file ${input.knowledgeFileId} is not here`, {
        reason: 'knowledge_file_missing',
      });
    }
    assertRoman(input.transcript);
    const transcript = maskWholeText(input.transcript);
    const rows = (await ctx.tx.execute(
      sql`select app.record_knowledge_transcript(${facts.knowledgeFileId}::uuid,
                                                 ${transcript}) as stored`,
    )) as unknown as { stored: boolean }[];
    const stored = rows[0]?.stored === true;
    if (stored) {
      ctx.audit({
        aggregateType: 'knowledge_file',
        aggregateId: facts.knowledgeFileId,
        entityId: facts.entityId,
        before: { transcriptChars: 0 },
        after: { transcriptChars: transcript.length },
      });
    }
    return { knowledgeFileId: facts.knowledgeFileId, stored };
  },
});

/**
 * `knowledge.transcript.correct` (people only, `knowledge.vault.write`): a vault recording's
 * corrected transcript (BLUEPRINT §9.1: Rajasthani and Marwari words the speech service mishears)
 * replaces the stored one, masked, and the file goes back to waiting and is sent to be read again,
 * so its passages are cut and embedded from the correction and replace the old ones. Refused for a
 * file that is not a recording, while the file is being read, for an archived file, while its
 * upload has not passed its checks, and when masking makes it longer than a transcript may be
 * (`knowledge_too_long`). It answers the file with the transcript as kept, masked, so the screen
 * shows at once what was stored.
 */
export const correctKnowledgeTranscript = defineCommand({
  name: 'knowledge.transcript.correct',
  permission: 'knowledge.vault.write',
  minScope: 'all',
  peopleOnly: true,
  input: CorrectKnowledgeTranscriptInput,
  output: KnowledgeFileDetailDto,
  auditFields: ['knowledgeState', 'transcriptChars'],
  auditInput: (input) => ({
    knowledgeFileId: input.knowledgeFileId,
    transcriptChars: input.transcript.length,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    assertRoman(input.transcript);
    // The upload is held before the vault file, in the order the file checks take them.
    const k = schema.knowledgeFiles;
    const [seen] = await ctx.tx
      .select({ fileId: k.fileId })
      .from(k)
      .where(eq(k.id, input.knowledgeFileId))
      .limit(1);
    if (seen !== undefined) await holdVaultUpload(ctx.tx, seen.fileId);
    const row = await lockKnowledgeFile(ctx, input.knowledgeFileId);
    if (row.sourceType !== 'audio') {
      throw new DomainError('validation_failed', 'only a recording has a transcript', {
        reason: 'knowledge_transcript_not_audio',
      });
    }
    if (row.state === 'waiting') {
      throw new DomainError('conflict', 'the file is still being read', {
        reason: 'knowledge_still_reading',
      });
    }
    const to = fireKnowledgeFile(ctx, row.state as KnowledgeFileMachineState, 'correct');
    const [upload] = await ctx.tx
      .select({ entityId: schema.files.entityId, status: schema.files.status })
      .from(schema.files)
      .where(eq(schema.files.id, row.fileId))
      .limit(1);
    if (upload?.status !== 'ready') {
      throw new DomainError('conflict', 'the upload has not passed its checks', {
        reason: 'knowledge_upload_not_ready',
      });
    }
    const transcript = maskWholeText(input.transcript);
    // Masking can lengthen a text (an address becomes `[email]`); checked as it will be stored.
    if (transcript.length > KNOWLEDGE_TRANSCRIPT_MAX_CHARS) {
      throw new DomainError('validation_failed', 'the masked transcript is too long', {
        reason: 'knowledge_too_long',
      });
    }
    const [updated] = await ctx.tx
      .update(k)
      .set({
        transcript,
        transcriptCorrectedAt: ctx.now,
        state: to,
        updatedBy: ctx.principal.id,
      })
      .where(eq(k.id, row.id))
      .returning();
    if (!updated) throw new DomainError('internal', `vault file ${row.id} update returned no row`);
    ctx.emit({
      type: 'knowledge.file.index_requested',
      entityId: upload.entityId,
      aggregateType: 'knowledge_file',
      aggregateId: row.id,
      payload: {
        knowledgeEntityId: row.entityId,
        sensitivity: KnowledgeSensitivitySchema.parse(row.sensitivity),
      },
    });
    ctx.audit({
      aggregateType: 'knowledge_file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { knowledgeState: row.state, transcriptChars: row.transcript?.length ?? 0 },
      after: { knowledgeState: to, transcriptChars: transcript.length },
    });
    return KnowledgeFileDetailDto.parse({
      ...knowledgeFileDto(updated),
      transcript: updated.transcript,
      transcriptCorrectedAt: updated.transcriptCorrectedAt?.toISOString() ?? null,
    });
  },
});
