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
import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const NoticeCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

interface NoticeRow extends Record<string, unknown> {
  id: string;
  entity_id: number;
  type: string;
  subject_type: string;
  subject_id: string;
  payload_json: unknown;
  created_at: Date | string;
  created_text: string;
  read_at: Date | string | null;
  customer_name: string | null;
  quote_no: string | null;
}

/**
 * One page of the caller's notices as SQL, `limit` rows after the keyset `after`, exported so the
 * notifications spike explains the very statement the centre runs. The page is cut first from
 * the person's own notices, and only its rows look up their customer and quote, each by its key
 * under the policies, so a reader of many customers never pays for all of them.
 */
export function noticeListSql(ctx: Ctx, limit: number, after?: z.output<typeof NoticeCursor>): SQL {
  const keyset =
    after === undefined
      ? sql`true`
      : sql`(n.created_at, n.id) < (${after.t}::text::timestamptz, ${after.id}::uuid)`;
  return sql`
    select p.id, p.entity_id, p.type, p.subject_type, p.subject_id, p.payload_json, p.created_at,
           p.created_at::text as created_text, p.read_at,
           (select a.name from accounts a
             where a.id = (p.payload_json ->> 'accountId')::uuid) as customer_name,
           (select qt.quote_no from quotes qt
             where qt.id = (p.payload_json ->> 'quoteId')::uuid
               and qt.entity_id = p.entity_id) as quote_no
      from (select n.* from notifications n
             where n.user_id = ${ctx.principal.id}::uuid
               and n.entity_id = any(${`{${ctx.entityIds.join(',')}}`}::int[])
               -- A kind the person keeps out of the centre is kept only to stop a repeat.
               and coalesce(n.channel_sent_json ->> 'inApp', 'true') <> 'false'
               and ${keyset}
             order by n.created_at desc, n.id desc
             limit ${limit}) p
     order by p.created_at desc, p.id desc`;
}

const toIso = (v: Date | string): string => (v instanceof Date ? v : new Date(v)).toISOString();

/**
 * The caller's notices in the request's companies that show in the centre, newest first, keyset
 * on `(created_at, id)` (docs/03-roadmap-appendix/phase1.md §8.1). The customer's name and the quote's number
 * are read only where the caller may read them (RLS), so a notice about a record the caller no
 * longer reads still shows, without them.
 */
export async function listNotices(ctx: Ctx, rawInput: unknown): Promise<NoticePageDto> {
  const input = parseQueryInput(ListNoticesInput, rawInput, 'notifications.list');
  const after = input.cursor === undefined ? undefined : decodeCursor(NoticeCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const rows = (await ctx.tx.execute(
    noticeListSql(ctx, input.limit + 1, after),
  )) as unknown as NoticeRow[];
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const payload = NoticePayloadSchema.catch({}).parse(r.payload_json);
      return NoticeDto.parse({
        id: r.id,
        entityId: r.entity_id,
        type: r.type,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        accountId: payload.accountId ?? null,
        opportunityId: payload.opportunityId ?? null,
        quoteId: payload.quoteId ?? null,
        customerName: r.customer_name,
        quoteNo: r.quote_no,
        createdAt: toIso(r.created_at),
        readAt: r.read_at === null ? null : toIso(r.read_at),
      });
    }),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.created_text, id: last.id })
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
