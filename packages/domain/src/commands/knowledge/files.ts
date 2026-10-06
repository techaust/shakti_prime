import {
  AddKnowledgeFileInput,
  DomainError,
  KnowledgeFileDto,
  KnowledgeFileRefInput,
  KnowledgeSensitivitySchema,
  newId,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { knowledgeSourceType } from '../../knowledge/extract';
import type { KnowledgeFileMachineState } from '../../state-machines/machines/knowledge-file';
import { requireEntity } from '../crm/opportunity-shared';
import {
  assertGroupRequest,
  fireKnowledgeFile,
  holdVaultUpload,
  knowledgeFileDto,
  lockKnowledgeFile,
  readsSensitivity,
} from './shared';

/*
 * The Knowledge Vault's commands for people (docs/design/phase1.md §8.4, PRD AI-01): an Executive
 * or GM (`knowledge.vault.write`, every company) adds a vault upload with its title and who may
 * retrieve it, indexes a file again and archives one. No agent runs them.
 */

/** The upload behind a vault file, as the person who added it may read it. */
async function vaultUpload(
  tx: Parameters<typeof holdVaultUpload>[0],
  fileId: string,
): Promise<typeof schema.files.$inferSelect | undefined> {
  const f = schema.files;
  const [row] = await tx.select().from(f).where(eq(f.id, fileId)).limit(1);
  return row?.purpose === 'knowledge' ? row : undefined;
}

/**
 * `knowledge.file.add`: the caller's own vault upload, finished (`files.upload.complete`), becomes
 * a vault file of its company or, in a request for every company, of the whole group, waiting to
 * be read. Only a sensitivity the caller may read is accepted. Once the upload has passed its
 * checks, the file is sent to be indexed (`knowledge.file.index_requested`); until then the checks
 * send it when they pass (`files.file.mark_ready`), or mark it failed when they refuse it.
 */
export const addKnowledgeFile = defineCommand({
  name: 'knowledge.file.add',
  permission: 'knowledge.vault.write',
  minScope: 'all',
  peopleOnly: true,
  input: AddKnowledgeFileInput,
  output: KnowledgeFileDto,
  auditFields: ['title', 'sensitivity', 'sourceType', 'wholeGroup', 'knowledgeState'],
  constraintReasons: { knowledge_files_file_unique: 'knowledge_file_taken' },
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    if (input.wholeGroup) await assertGroupRequest(ctx);
    if (!readsSensitivity(ctx.principal, input.sensitivity)) {
      throw new DomainError('forbidden', 'a vault file is tagged only with what its adder reads', {
        reason: 'knowledge_sensitivity_not_held',
      });
    }
    await holdVaultUpload(ctx.tx, input.fileId);
    const file = await vaultUpload(ctx.tx, input.fileId);
    if (file?.entityId !== input.entityId) {
      throw new DomainError('not_found', `vault upload ${input.fileId} is not visible`, {
        reason: 'file_missing',
      });
    }
    if (file.status === 'rejected') {
      throw new DomainError('conflict', 'the upload did not pass its checks', {
        reason: 'knowledge_upload_rejected',
      });
    }
    if (file.status === 'pending') {
      throw new DomainError('conflict', 'the upload has not finished', {
        reason: 'knowledge_upload_unfinished',
      });
    }
    const sourceType = knowledgeSourceType(file.contentType);
    if (sourceType === undefined) {
      throw new DomainError('validation_failed', 'the vault does not take this type', {
        reason: 'file_type_not_allowed',
      });
    }
    const state = fireKnowledgeFile(ctx, null, 'add');
    const id = newId();
    const entityId = input.wholeGroup ? null : input.entityId;
    // No `returning`: the row is read back under the read policy, which the insert policy matches.
    await ctx.tx.insert(schema.knowledgeFiles).values({
      id,
      entityId,
      fileId: file.id,
      title: input.title,
      sensitivity: input.sensitivity,
      sourceType,
      state,
      createdBy: ctx.principal.id,
    });
    const [row] = await ctx.tx
      .select()
      .from(schema.knowledgeFiles)
      .where(eq(schema.knowledgeFiles.id, id))
      .limit(1);
    if (!row) throw new DomainError('internal', `vault file ${id} was not written`);
    if (file.status === 'ready') {
      ctx.emit({
        type: 'knowledge.file.index_requested',
        entityId: file.entityId,
        aggregateType: 'knowledge_file',
        aggregateId: id,
        payload: { knowledgeEntityId: entityId, sensitivity: input.sensitivity },
      });
    }
    ctx.audit({
      aggregateType: 'knowledge_file',
      aggregateId: id,
      entityId,
      before: null,
      after: {
        title: input.title,
        sensitivity: input.sensitivity,
        sourceType,
        wholeGroup: input.wholeGroup,
        knowledgeState: state,
      },
    });
    return knowledgeFileDto(row);
  },
});

/** Writes a vault file's new state as the caller and answers the row as it now stands. */
async function writeState(
  ctx: Parameters<typeof fireKnowledgeFile>[0],
  id: string,
  state: KnowledgeFileMachineState,
) {
  const k = schema.knowledgeFiles;
  const [row] = await ctx.tx
    .update(k)
    .set({ state, updatedBy: ctx.principal.id })
    .where(eq(k.id, id))
    .returning();
  if (!row) throw new DomainError('internal', `vault file ${id} update returned no row`);
  return row;
}

/**
 * `knowledge.file.reindex`: a vault file that is indexed, failed or unavailable (no key yet) goes
 * back to waiting and is sent to be read again; its passages stay in search until new ones
 * replace them. Refused while its upload has not passed its checks.
 */
export const reindexKnowledgeFile = defineCommand({
  name: 'knowledge.file.reindex',
  permission: 'knowledge.vault.write',
  minScope: 'all',
  peopleOnly: true,
  input: KnowledgeFileRefInput,
  output: KnowledgeFileDto,
  auditFields: ['knowledgeState'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    // The upload is held before the vault file, in the order the file checks take them.
    const k = schema.knowledgeFiles;
    const [seen] = await ctx.tx
      .select({ fileId: k.fileId })
      .from(k)
      .where(eq(k.id, input.knowledgeFileId))
      .limit(1);
    if (seen !== undefined) await holdVaultUpload(ctx.tx, seen.fileId);
    const row = await lockKnowledgeFile(ctx, input.knowledgeFileId);
    const to = fireKnowledgeFile(ctx, row.state as KnowledgeFileMachineState, 'reindex');
    const file = await vaultUpload(ctx.tx, row.fileId);
    if (file?.status !== 'ready') {
      throw new DomainError('conflict', 'the upload has not passed its checks', {
        reason: 'knowledge_upload_not_ready',
      });
    }
    const updated = await writeState(ctx, row.id, to);
    ctx.emit({
      type: 'knowledge.file.index_requested',
      entityId: file.entityId,
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
      before: { knowledgeState: row.state },
      after: { knowledgeState: to },
    });
    return knowledgeFileDto(updated);
  },
});

/** `knowledge.file.archive`: the vault file leaves search; its passages are removed at once. */
export const archiveKnowledgeFile = defineCommand({
  name: 'knowledge.file.archive',
  permission: 'knowledge.vault.write',
  minScope: 'all',
  peopleOnly: true,
  input: KnowledgeFileRefInput,
  output: KnowledgeFileDto,
  auditFields: ['knowledgeState', 'chunks'],
  async handler(ctx, input) {
    requireEntity(ctx, input.entityId);
    const row = await lockKnowledgeFile(ctx, input.knowledgeFileId);
    const to = fireKnowledgeFile(ctx, row.state as KnowledgeFileMachineState, 'archive');
    const updated = await writeState(ctx, row.id, to);
    ctx.audit({
      aggregateType: 'knowledge_file',
      aggregateId: row.id,
      entityId: row.entityId,
      before: { knowledgeState: row.state, chunks: row.chunks },
      after: { knowledgeState: to, chunks: updated.chunks },
    });
    return knowledgeFileDto(updated);
  },
});
