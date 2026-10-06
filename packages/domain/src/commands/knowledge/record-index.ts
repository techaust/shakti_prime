import {
  DomainError,
  KnowledgeIndexRecordDto,
  newId,
  RecordKnowledgeIndexInput,
} from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import type { KnowledgeFileEvent } from '../../state-machines/machines/knowledge-file';
import { requireEntity } from '../crm/opportunity-shared';
import { fireKnowledgeFileAsJob, knowledgeFileForIndex } from './shared';

const EVENT_OF: Readonly<Record<'indexed' | 'failed' | 'unavailable', KnowledgeFileEvent>> = {
  indexed: 'index',
  failed: 'fail',
  unavailable: 'hold',
};

/**
 * `knowledge.file.record_index` (docs/design/phase1.md §8.4): what reading a waiting vault file
 * came to, recorded by the index job as `system:workers`, which holds the platform-only
 * `knowledge.index` and no vault read permission: it reaches the vault only through
 * `app.knowledge_file_for_index()` and `app.record_knowledge_index()`, which keep to uploads stored
 * in the request's company. `indexed` replaces the file's passages with the new ones in this
 * transaction (`replaced` counts the old); `failed` and `unavailable` keep them and record why. A
 * file no longer waiting (archived or indexed meanwhile, or a delivery that ran again) is answered
 * `skipped` and nothing changes. The audit row counts the passages, never their text.
 */
export const recordKnowledgeIndex = defineCommand({
  name: 'knowledge.file.record_index',
  permission: 'knowledge.index',
  minScope: 'entity',
  input: RecordKnowledgeIndexInput,
  output: KnowledgeIndexRecordDto,
  auditFields: ['knowledgeState', 'chunks', 'replaced', 'errorReason'],
  auditInput: (input) => ({
    knowledgeFileId: input.knowledgeFileId,
    outcome: input.outcome,
    chunks: input.outcome === 'indexed' ? input.chunks.length : 0,
  }),
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const facts = await knowledgeFileForIndex(ctx.tx, input.knowledgeFileId);
    if (facts?.fileEntityId !== input.entityId) {
      throw new DomainError('not_found', `vault file ${input.knowledgeFileId} is not here`, {
        reason: 'knowledge_file_missing',
      });
    }
    const skipped = {
      knowledgeFileId: facts.knowledgeFileId,
      state: facts.state,
      chunks: facts.chunks,
      replaced: 0,
      skipped: true,
    };
    if (facts.state !== 'waiting') return skipped;
    const to = fireKnowledgeFileAsJob(ctx, facts.state, EVENT_OF[input.outcome]);
    const chunks =
      input.outcome === 'indexed'
        ? JSON.stringify(
            input.chunks.map((chunk, position) => ({
              id: newId(),
              position,
              text: chunk.text,
              embedding: chunk.embedding,
            })),
          )
        : null;
    const reason = input.outcome === 'indexed' ? null : input.reason;
    const rows = (await ctx.tx.execute(
      sql`select app.record_knowledge_index(${facts.knowledgeFileId}::uuid, ${to}, ${reason},
                                            ${chunks}::jsonb) as replaced`,
    )) as unknown as { replaced: number | null }[];
    const replaced = rows[0]?.replaced ?? null;
    // Another delivery recorded the file between the read above and the lock the definer takes.
    if (replaced === null) return skipped;
    const count = input.outcome === 'indexed' ? input.chunks.length : facts.chunks;
    ctx.audit({
      aggregateType: 'knowledge_file',
      aggregateId: facts.knowledgeFileId,
      entityId: facts.entityId,
      before: { knowledgeState: facts.state, chunks: facts.chunks },
      after: {
        knowledgeState: to,
        chunks: count,
        replaced,
        ...(reason === null ? {} : { errorReason: reason }),
      },
    });
    return {
      knowledgeFileId: facts.knowledgeFileId,
      state: to,
      chunks: count,
      replaced,
      skipped: false,
    };
  },
});
