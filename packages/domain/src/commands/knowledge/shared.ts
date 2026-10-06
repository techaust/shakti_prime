import {
  DomainError,
  hasGrant,
  KNOWLEDGE_READ_PERMISSION,
  KnowledgeFileDto,
  type KnowledgeSensitivity,
  type Principal,
} from '@shakti/contracts';
import { schema, type RequestTx } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import type { CommandContext } from '../../command/context';
import { transition } from '../../state-machines/define-machine';
import {
  knowledgeFileMachine,
  type KnowledgeFileEvent,
  type KnowledgeFileMachineState,
} from '../../state-machines/machines/knowledge-file';

export type KnowledgeFileRow = typeof schema.knowledgeFiles.$inferSelect;

/** The vault file as the vault screen and the commands answer it. */
export function knowledgeFileDto(row: KnowledgeFileRow): KnowledgeFileDto {
  return KnowledgeFileDto.parse({
    id: row.id,
    entityId: row.entityId,
    fileId: row.fileId,
    title: row.title,
    sensitivity: row.sensitivity,
    sourceType: row.sourceType,
    state: row.state,
    chunks: row.chunks,
    indexedAt: row.indexedAt?.toISOString() ?? null,
    errorReason: row.errorReason,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Whether the principal may read vault files of this sensitivity (SECURITY §3.2). */
export function readsSensitivity(principal: Principal, sensitivity: KnowledgeSensitivity): boolean {
  return hasGrant(principal.permissions, KNOWLEDGE_READ_PERMISSION[sensitivity], 'all');
}

/**
 * Holds a vault upload for this transaction (an advisory lock on its id), so adding a vault file
 * and the upload's checks finishing take turns: whichever commits second sees the other, and the
 * file is sent to be indexed exactly when both have happened.
 */
export async function holdVaultUpload(tx: RequestTx, fileId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`knowledge-upload:${fileId}`}, 0))`,
  );
}

/**
 * A vault file of the whole group is changed only in a request for every active company, as a
 * group price list or agent setting is (ADR 0016); the write policies say the same.
 */
export async function assertGroupRequest(ctx: CommandContext): Promise<void> {
  const covered = (await ctx.tx.execute(
    sql`select app.request_covers_group() as ok`,
  )) as unknown as { ok: boolean }[];
  if (covered[0]?.ok !== true) {
    throw new DomainError('forbidden', 'a vault file of the whole group needs every company', {
      reason: 'knowledge_needs_all_companies',
    });
  }
}

/**
 * The vault file, locked for this transaction, when the caller may change it (the update policy:
 * `knowledge.vault.write` and its sensitivity's read permission); otherwise not found.
 */
export async function lockKnowledgeFile(
  ctx: CommandContext,
  knowledgeFileId: string,
): Promise<KnowledgeFileRow> {
  const k = schema.knowledgeFiles;
  const [visible] = await ctx.tx
    .select({ entityId: k.entityId })
    .from(k)
    .where(eq(k.id, knowledgeFileId))
    .limit(1);
  if (visible?.entityId === null) await assertGroupRequest(ctx);
  const [row] = await ctx.tx
    .select()
    .from(k)
    .where(eq(k.id, knowledgeFileId))
    .limit(1)
    .for('update');
  if (!row) {
    throw new DomainError('not_found', `vault file ${knowledgeFileId} is not visible`, {
      reason: 'knowledge_file_missing',
    });
  }
  return row;
}

/** Fires an event of the vault file's machine as the caller. */
export function fireKnowledgeFile(
  ctx: CommandContext,
  state: KnowledgeFileMachineState | null,
  event: KnowledgeFileEvent,
): KnowledgeFileMachineState {
  return transition(knowledgeFileMachine, { state }, event, {
    actor: { kind: 'principal', principal: ctx.principal },
    now: ctx.now,
    params: undefined,
  }).to;
}

/** Fires an event of the vault file's machine as the index job. */
export function fireKnowledgeFileAsJob(
  ctx: CommandContext,
  state: KnowledgeFileMachineState,
  event: KnowledgeFileEvent,
): KnowledgeFileMachineState {
  return transition(knowledgeFileMachine, { state }, event, {
    actor: { kind: 'system', job: 'knowledge-index' },
    now: ctx.now,
    params: undefined,
  }).to;
}

/** What the index job learns of a vault file through `app.knowledge_file_for_index()`. */
export interface KnowledgeFileForIndex {
  knowledgeFileId: string;
  entityId: number | null;
  fileId: string;
  fileEntityId: number;
  sensitivity: KnowledgeSensitivity;
  sourceType: string;
  state: KnowledgeFileMachineState;
  chunks: number;
}

/**
 * A vault file's facts for the index job (`knowledge.index`, the upload in a company of the
 * request), or undefined when there is none. Never its title or text.
 */
export async function knowledgeFileForIndex(
  tx: RequestTx,
  knowledgeFileId: string,
): Promise<KnowledgeFileForIndex | undefined> {
  const rows = (await tx.execute(
    sql`select knowledge_file_id, entity_id, file_id, file_entity_id, sensitivity, source_type,
               state, chunks
          from app.knowledge_file_for_index(${knowledgeFileId}::uuid)`,
  )) as unknown as {
    knowledge_file_id: string;
    entity_id: number | null;
    file_id: string;
    file_entity_id: number;
    sensitivity: KnowledgeSensitivity;
    source_type: string;
    state: KnowledgeFileMachineState;
    chunks: number;
  }[];
  const row = rows[0];
  if (row === undefined) return undefined;
  return {
    knowledgeFileId: row.knowledge_file_id,
    entityId: row.entity_id,
    fileId: row.file_id,
    fileEntityId: row.file_entity_id,
    sensitivity: row.sensitivity,
    sourceType: row.source_type,
    state: row.state,
    chunks: row.chunks,
  };
}
