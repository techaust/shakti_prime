import {
  IdSchema,
  KNOWLEDGE_EMBEDDING_DIMENSIONS,
  KNOWLEDGE_SEARCH_LIMIT,
  KnowledgeFilePageDto,
  KnowledgeHitDto,
  ListKnowledgeFilesInput,
  DomainError,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission } from '../../command/run-command';
import { knowledgeFileDto } from '../../commands/knowledge/shared';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The vault list's page size. */
export const KNOWLEDGE_PAGE_SIZE = 50;

const VaultCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * The vault list's statement: one page and one row more, after the cursor's row. The spike
 * `pnpm spike:knowledge` explains this same statement.
 */
export function knowledgeListQuery(ctx: Ctx, after: { t: string; id: string } | undefined) {
  const k = schema.knowledgeFiles;
  return ctx.tx
    .select({ file: k, createdText: sql<string>`${k.createdAt}::text` })
    .from(k)
    .where(
      and(
        or(inArray(k.entityId, [...ctx.entityIds]), isNull(k.entityId)),
        ne(k.state, 'archived'),
        after === undefined
          ? undefined
          : sql`(${k.createdAt}, ${k.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(k.createdAt), desc(k.id))
    .limit(KNOWLEDGE_PAGE_SIZE + 1);
}

/**
 * The vault files the caller may read (docs/design/phase1.md §8.4): of the request's companies and
 * the whole group's, of a sensitivity the caller holds (`knowledge_files_read`), archived ones left
 * out, newest first, keyset on `(created_at, id)`. Every staff role holds
 * `knowledge.vault.read.staff`, the screen's own permission.
 */
export async function listKnowledgeFiles(
  ctx: Ctx,
  rawInput: unknown,
): Promise<KnowledgeFilePageDto> {
  const input = parseQueryInput(ListKnowledgeFilesInput, rawInput, 'knowledge.files.list');
  checkPermission(ctx.principal, 'knowledge.vault.read.staff', 'all');
  const after = input.cursor === null ? undefined : decodeCursor(VaultCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const rows = await knowledgeListQuery(ctx, after);
  const page = rows.slice(0, KNOWLEDGE_PAGE_SIZE);
  const last = page.at(-1);
  return KnowledgeFilePageDto.parse({
    files: page.map((r) => knowledgeFileDto(r.file)),
    nextCursor:
      rows.length > KNOWLEDGE_PAGE_SIZE && last !== undefined
        ? encodeCursor({ t: last.createdText, id: last.file.id })
        : null,
  });
}

/** One vault file the caller may read, or undefined. */
export async function getKnowledgeFile(ctx: Ctx, knowledgeFileId: string) {
  checkPermission(ctx.principal, 'knowledge.vault.read.staff', 'all');
  const k = schema.knowledgeFiles;
  const [row] = await ctx.tx
    .select()
    .from(k)
    .where(eq(k.id, IdSchema.parse(knowledgeFileId)))
    .limit(1);
  return row === undefined ? undefined : knowledgeFileDto(row);
}

const QueryVector = z.array(z.number()).length(KNOWLEDGE_EMBEDDING_DIMENSIONS);

/**
 * The search's own setting, for its transaction only: the HNSW scan goes on past the passages the
 * policies filter out until it has enough (pgvector's iterative scan, ADR 0011).
 */
export const ITERATIVE_SCAN = sql`select set_config('hnsw.iterative_scan', 'relaxed_order', true)`;

/**
 * The search's statement (`query` is the question's embedding as pgvector text): the nearest
 * `most` passages the caller reads, found through the HNSW index under the read policy, then put
 * in exact order with their file's title. The spike `pnpm spike:knowledge` explains this same
 * statement.
 */
export function knowledgeSearchSql(query: string, most: number): SQL {
  return sql`
    with nearest as materialized (
      select c.knowledge_file_id, c.position, c.chunk_text,
             c.embedding <=> ${query}::vector as distance
        from knowledge_chunks c
       order by c.embedding <=> ${query}::vector
       limit ${most}
    )
    select n.knowledge_file_id, f.title, n.position, n.chunk_text, n.distance
      from nearest n
      join knowledge_files f on f.id = n.knowledge_file_id
     order by n.distance, n.knowledge_file_id, n.position`;
}

/**
 * The staff search (docs/design/phase1.md §8.4, ADR 0011): the passages nearest the question's
 * embedding by cosine distance, run as the caller, so row security keeps to the companies of the
 * request and the group's and to the sensitivities the caller holds before anything is ranked.
 * The HNSW index is read with iterative scan (`relaxed_order`), so passages the policies filter
 * out do not leave the answer short; the few found are put back in exact order. Each passage
 * comes with its file's title.
 */
export async function searchKnowledge(
  ctx: Ctx,
  vector: readonly number[],
  limit: number = KNOWLEDGE_SEARCH_LIMIT,
): Promise<KnowledgeHitDto[]> {
  checkPermission(ctx.principal, 'knowledge.vault.read.staff', 'all');
  const query = JSON.stringify(QueryVector.parse(vector));
  const most = Math.max(1, Math.min(limit, KNOWLEDGE_SEARCH_LIMIT));
  await ctx.tx.execute(ITERATIVE_SCAN);
  const rows = (await ctx.tx.execute(knowledgeSearchSql(query, most))) as unknown as {
    knowledge_file_id: string;
    title: string;
    position: number;
    chunk_text: string;
    distance: number;
  }[];
  return rows.map((r) =>
    KnowledgeHitDto.parse({
      knowledgeFileId: r.knowledge_file_id,
      title: r.title,
      position: r.position,
      text: r.chunk_text,
      // Cosine distance runs from 0 to 2; rounding can step a hair past either end.
      distance: Math.min(2, Math.max(0, r.distance)),
    }),
  );
}
