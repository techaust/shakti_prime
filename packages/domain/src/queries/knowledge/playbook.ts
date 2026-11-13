import {
  APPROVED_PLAYBOOK_LIMIT,
  ApprovedDirectiveDto,
  ApprovedPlaybookInput,
  IdSchema,
  ListPlaybookInput,
  ListPlaybookSourcesInput,
  PlaybookSourcePageDto,
  PLAYBOOK_PAGE_SIZE,
  PlaybookOtherDto,
  PlaybookPageDto,
  PlaybookReviewDto,
  PlaybookReviewInput,
  DomainError,
  type KnowledgeSensitivity,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission } from '../../command/run-command';
import {
  playbookConflictCheckDto,
  playbookDirectiveDto,
} from '../../commands/knowledge/playbook-shared';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const PlaybookCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();

/**
 * The Playbook list's statement: one page and one row more, after the cursor's row, filtered by
 * state, type and company; row security keeps to the companies of the request and the group's,
 * the audiences the reader holds and, for drafts, the holders of the playbook grants. Its
 * `EXPLAIN (ANALYZE)` plans are recorded in the run file of K2 (docs/runs/phase2/k2-playbook.md).
 */
export function playbookListQuery(
  ctx: Ctx,
  input: z.output<typeof ListPlaybookInput>,
  after: { t: string; id: string } | undefined,
) {
  const d = schema.playbookDirectives;
  return ctx.tx
    .select({ row: d, createdText: sql<string>`${d.createdAt}::text` })
    .from(d)
    .where(
      and(
        input.state === null ? undefined : eq(d.state, input.state),
        input.type === null ? undefined : eq(d.type, input.type),
        input.company === null
          ? undefined
          : input.company === 'group'
            ? isNull(d.entityId)
            : eq(d.entityId, input.company),
        after === undefined
          ? undefined
          : sql`(${d.createdAt}, ${d.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(d.createdAt), desc(d.id))
    .limit(PLAYBOOK_PAGE_SIZE + 1);
}

/** `/knowledge/playbook`: the directives the reader may read, newest first. */
export async function listPlaybook(ctx: Ctx, rawInput: unknown): Promise<PlaybookPageDto> {
  checkPermission(ctx.principal, 'knowledge.playbook.draft', 'all');
  const input = parseQueryInput(ListPlaybookInput, rawInput, 'knowledge.playbook.list');
  const after = input.cursor === null ? undefined : decodeCursor(PlaybookCursor, input.cursor);
  const rows = await playbookListQuery(ctx, input, after);
  const page = rows.slice(0, PLAYBOOK_PAGE_SIZE);
  const last = page.at(-1);
  return PlaybookPageDto.parse({
    directives: page.map((r) => playbookDirectiveDto(r.row)),
    nextCursor:
      rows.length > PLAYBOOK_PAGE_SIZE && last !== undefined
        ? encodeCursor({ t: last.createdText, id: last.row.id })
        : null,
  });
}

/**
 * The review sheet of one directive: the passage it was drawn from and every pair the conflict
 * check compared it with, beside the other directive as far as the reader may read it.
 */
export async function loadPlaybookReview(ctx: Ctx, rawInput: unknown): Promise<PlaybookReviewDto> {
  checkPermission(ctx.principal, 'knowledge.playbook.draft', 'all');
  const input = parseQueryInput(PlaybookReviewInput, rawInput, 'knowledge.playbook.review');
  const d = schema.playbookDirectives;
  const [row] = await ctx.tx.select().from(d).where(eq(d.id, input.directiveId)).limit(1);
  if (!row) {
    throw new DomainError('not_found', `directive ${input.directiveId} is not visible`, {
      reason: 'playbook_directive_missing',
    });
  }
  let source: PlaybookReviewDto['source'] = null;
  if (row.sourceFileId !== null) {
    const k = schema.knowledgeFiles;
    const [file] = await ctx.tx
      .select({ id: k.id, title: k.title })
      .from(k)
      .where(eq(k.id, row.sourceFileId))
      .limit(1);
    if (file !== undefined) {
      let text: string | null = null;
      if (row.sourcePosition !== null) {
        const c = schema.knowledgeChunks;
        const [chunk] = await ctx.tx
          .select({ text: c.chunkText })
          .from(c)
          .where(and(eq(c.knowledgeFileId, file.id), eq(c.position, row.sourcePosition)))
          .limit(1);
        text = chunk?.text ?? null;
      }
      source = { knowledgeFileId: file.id, title: file.title, position: row.sourcePosition, text };
    }
  }
  const c = schema.playbookConflictChecks;
  const checks = await ctx.tx
    .select()
    .from(c)
    .where(eq(c.directiveId, row.id))
    .orderBy(asc(c.distance), asc(c.id));
  const others =
    checks.length === 0
      ? []
      : await ctx.tx
          .select()
          .from(d)
          .where(
            inArray(
              d.id,
              checks.map((p) => p.otherId),
            ),
          );
  const byId = new Map(others.map((o) => [o.id, o]));
  return PlaybookReviewDto.parse({
    directive: playbookDirectiveDto(row),
    source,
    pairs: checks.map((p) => {
      const other = byId.get(p.otherId);
      const check = playbookConflictCheckDto(p);
      return {
        // The model's sentence is about the other rule: a reader who may not read that rule does
        // not read the sentence either.
        check: other === undefined ? { ...check, reason: null } : check,
        other:
          other === undefined
            ? null
            : PlaybookOtherDto.parse({
                id: other.id,
                entityId: other.entityId,
                title: other.title,
                text: other.text,
                state: other.state,
              }),
      };
    }),
  });
}

/** A vault file's passages as the drafting reads them: in order, at most `limit`. */
export interface PlaybookSource {
  file: { id: string; title: string; entityId: number | null; sensitivity: KnowledgeSensitivity };
  passages: { position: number; text: string }[];
}

/**
 * The passages a draft is taken from, read as the person drafting (row security keeps to the files
 * and sensitivities they read), from a file read for search; undefined when there is none.
 */
export async function playbookSourcePassages(
  ctx: Ctx,
  knowledgeFileId: string,
  limit: number,
): Promise<PlaybookSource | undefined> {
  checkPermission(ctx.principal, 'knowledge.playbook.draft', 'all');
  const k = schema.knowledgeFiles;
  const [file] = await ctx.tx
    .select({
      id: k.id,
      title: k.title,
      entityId: k.entityId,
      sensitivity: k.sensitivity,
      state: k.state,
    })
    .from(k)
    .where(eq(k.id, knowledgeFileId))
    .limit(1);
  if (file?.state !== 'indexed') return undefined;
  const c = schema.knowledgeChunks;
  const passages = await ctx.tx
    .select({ position: c.position, text: c.chunkText })
    .from(c)
    .where(eq(c.knowledgeFileId, file.id))
    .orderBy(asc(c.position))
    .limit(limit);
  return {
    file: {
      id: file.id,
      title: file.title,
      entityId: file.entityId,
      sensitivity: file.sensitivity as KnowledgeSensitivity,
    },
    passages,
  };
}

/**
 * The approved Playbook (docs/03-roadmap-appendix/phase2.md §5.4): the one read surface for the
 * agents and Ask the Business (B1, A3), which must read directives through it and never from the
 * table. Approved directives only, whoever reads: row security already hides drafts and retired
 * directives from an agent, but not from an Executive or a GM, who hold the playbook grants and
 * ask questions too. Of the audiences asked for; row security keeps to the companies of the
 * request and the group's, and to the audiences the reader may read. By type, then title.
 */
export async function approvedPlaybook(
  ctx: Ctx,
  rawInput: unknown = {},
): Promise<ApprovedDirectiveDto[]> {
  const input = parseQueryInput(ApprovedPlaybookInput, rawInput, 'knowledge.playbook.approved');
  const d = schema.playbookDirectives;
  const rows = await ctx.tx
    .select({
      id: d.id,
      entityId: d.entityId,
      type: d.type,
      audience: d.audience,
      title: d.title,
      text: d.text,
      approvedAt: d.approvedAt,
    })
    .from(d)
    .where(and(eq(d.state, 'approved'), inArray(d.audience, input.audiences)))
    .orderBy(asc(d.type), asc(d.title), asc(d.id))
    .limit(APPROVED_PLAYBOOK_LIMIT);
  return rows.map((r) =>
    ApprovedDirectiveDto.parse({ ...r, approvedAt: r.approvedAt?.toISOString() }),
  );
}

const SourceCursor = z.object({ title: z.string().max(200), id: IdSchema }).strict();

/** A page of the vault files a drafter may draft from. */
export const PLAYBOOK_SOURCES_PAGE = 50;

/**
 * The vault files a person may draft rules from (Draft from a file): read for search, not
 * Executive-only, those the person may find (row security), by title, a page at a time, narrowed
 * by words of the title.
 */
export async function listPlaybookSources(
  ctx: Ctx,
  rawInput: unknown,
): Promise<PlaybookSourcePageDto> {
  checkPermission(ctx.principal, 'knowledge.playbook.draft', 'all');
  const input = parseQueryInput(ListPlaybookSourcesInput, rawInput, 'knowledge.playbook.sources');
  const after = input.cursor === null ? undefined : decodeCursor(SourceCursor, input.cursor);
  const k = schema.knowledgeFiles;
  const rows = await ctx.tx
    .select({ id: k.id, entityId: k.entityId, title: k.title })
    .from(k)
    .where(
      and(
        eq(k.state, 'indexed'),
        ne(k.sensitivity, 'exec_only'),
        input.query === '' ? undefined : ilike(k.title, containsPattern(input.query)),
        after === undefined
          ? undefined
          : sql`(${k.title}, ${k.id}) > (${after.title}, ${after.id}::uuid)`,
      ),
    )
    .orderBy(asc(k.title), asc(k.id))
    .limit(PLAYBOOK_SOURCES_PAGE + 1);
  const page = rows.slice(0, PLAYBOOK_SOURCES_PAGE);
  const last = page.at(-1);
  return PlaybookSourcePageDto.parse({
    files: page,
    nextCursor:
      rows.length > PLAYBOOK_SOURCES_PAGE && last !== undefined
        ? encodeCursor({ title: last.title, id: last.id })
        : null,
  });
}
