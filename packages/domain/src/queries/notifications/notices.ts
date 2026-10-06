import {
  DomainError,
  IdSchema,
  ListNoticesInput,
  NOTICE_COUNT_LIMIT,
  NoticeDto,
  NoticePayloadSchema,
  type NoticeCountDto,
  type NoticePageDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const NoticeCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * One page of the caller's notices as a query, `limit` rows after the keyset `after`; exported
 * so the notifications spike explains the very statement the centre runs.
 */
export function noticeListQuery(
  ctx: Ctx,
  limit: number,
  after?: z.output<typeof NoticeCursor>,
) {
  const n = schema.notifications;
  const a = schema.accounts;
  const q = schema.quotes;
  return ctx.tx
    .select({
      notice: n,
      customerName: a.name,
      quoteNo: q.quoteNo,
      createdText: sql<string>`${n.createdAt}::text`,
    })
    .from(n)
    .leftJoin(a, sql`${a.id} = (${n.payloadJson} ->> 'accountId')::uuid`)
    .leftJoin(
      q,
      and(sql`${q.id} = (${n.payloadJson} ->> 'quoteId')::uuid`, eq(q.entityId, n.entityId)),
    )
    .where(
      and(
        eq(n.userId, ctx.principal.id),
        inArray(n.entityId, [...ctx.entityIds]),
        // A kind the person turned off in the centre is kept only to stop a repeat.
        sql`coalesce(${n.channelSentJson} ->> 'inApp', 'true') <> 'false'`,
        after === undefined
          ? undefined
          : sql`(${n.createdAt}, ${n.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(n.createdAt), desc(n.id))
    .limit(limit);
}

/**
 * The caller's notices in the request's companies that show in the centre, newest first, keyset
 * on `(created_at, id)` off `notifications_user_created_idx` (docs/design/phase1.md §8.1). The
 * customer's name and the quote's number join only where the caller may read them (RLS), so a
 * notice about a record the caller no longer reads still shows, without them.
 */
export async function listNotices(ctx: Ctx, rawInput: unknown): Promise<NoticePageDto> {
  const input = parseQueryInput(ListNoticesInput, rawInput, 'notifications.list');
  const after = input.cursor === undefined ? undefined : decodeCursor(NoticeCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const rows = await noticeListQuery(ctx, input.limit + 1, after);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const payload = NoticePayloadSchema.catch({}).parse(r.notice.payloadJson);
      return NoticeDto.parse({
        id: r.notice.id,
        entityId: r.notice.entityId,
        type: r.notice.type,
        subjectType: r.notice.subjectType,
        subjectId: r.notice.subjectId,
        accountId: payload.accountId ?? null,
        opportunityId: payload.opportunityId ?? null,
        quoteId: payload.quoteId ?? null,
        customerName: r.customerName,
        quoteNo: r.quoteNo,
        createdAt: r.notice.createdAt.toISOString(),
        readAt: r.notice.readAt?.toISOString() ?? null,
      });
    }),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.createdText, id: last.notice.id })
        : null,
  };
}

/** The bell's count as a query (`countNotices`), for the notifications spike. */
export function noticeCountQuery(ctx: Ctx) {
  const n = schema.notifications;
  const unread = ctx.tx
    .select({ one: sql`1` })
    .from(n)
    .where(
      and(
        eq(n.userId, ctx.principal.id),
        inArray(n.entityId, [...ctx.entityIds]),
        isNull(n.readAt),
      ),
    )
    .limit(NOTICE_COUNT_LIMIT)
    .as('unread_notices');
  return ctx.tx.select({ unread: sql<number>`count(*)::int` }).from(unread);
}

/** How many unread notices the caller has in the request's companies, up to the bell's limit. */
export async function countNotices(ctx: Ctx): Promise<NoticeCountDto> {
  const [row] = await noticeCountQuery(ctx);
  return { unread: row?.unread ?? 0 };
}
