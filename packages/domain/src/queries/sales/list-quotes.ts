import {
  DomainError,
  ListQuotesInput,
  QuotePageDto,
  QuoteRefInput,
  QuoteSearchHitDto,
  SearchInput,
  type QuoteDto,
  type QuoteRowDto,
  type QuoteSearchHitDto as QuoteSearchHit,
  type QuoteState,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { afterCursor, keysetOrder, nextCursor, orderTerms, sortText, type SortKeys } from '../keyset-sort';
import { parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';
import { QUOTE_ROW_COLUMNS, readQuote, shownQuoteState, toQuoteRow } from './quote-dto';

type QuoteListContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** `/quotes` reads newest first by `(created_at, id)`, so its cursor takes the keyset text form. */
const QUOTE_SORT_KEYS: SortKeys<'created'> = {
  created: { expr: schema.quotes.createdAt, type: 'timestamptz', nullable: false },
};
const quoteOrder = () =>
  keysetOrder(QUOTE_SORT_KEYS, schema.quotes.id, undefined, {
    column: 'created',
    direction: 'desc',
  });

/**
 * The quotes of a state as a person sees it (`shownQuoteState`): a draft or sent quote past its
 * validity is among the expired ones and no longer among the drafts or the sent.
 */
function stateFilter(state: QuoteState | undefined, now: Date): SQL | undefined {
  const q = schema.quotes;
  const lapsed = and(inArray(q.state, ['draft', 'sent']), lt(q.validUntil, now));
  if (state === undefined) return undefined;
  if (state === 'expired') return or(eq(q.state, 'expired'), lapsed);
  if (state === 'draft' || state === 'sent') {
    return and(eq(q.state, state), sql`${q.validUntil} >= ${now.toISOString()}::timestamptz`);
  }
  return eq(q.state, state);
}

function companies(ctx: QuoteListContext, entityId: number | undefined): number[] {
  if (entityId !== undefined && !ctx.entityIds.includes(entityId)) {
    throw new DomainError('forbidden', 'entity outside the request scope', { entityId });
  }
  return entityId === undefined ? [...ctx.entityIds] : [entityId];
}

/**
 * `/quotes` (docs/design/phase1.md §7.3): the quotes the caller can read, newest first, of one
 * company or every company of the request, optionally of one state as a person sees it. A quote
 * is read with its lead (RLS), so the list takes `crm.lead.read`; the customer's name comes from
 * the customer row, readable through the lead (0057). Keyset paging on
 * `quotes_entity_created_idx` (one company) or `quotes_created_idx` (several), read backwards.
 */
export async function listQuotes(
  ctx: QuoteListContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<QuotePageDto> {
  const input = parseQueryInput(ListQuotesInput, rawInput, 'sales.quote.list');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const q = schema.quotes;
  const a = schema.accounts;
  const order = quoteOrder();
  const rows = await ctx.tx
    .select({ ...QUOTE_ROW_COLUMNS, sortValue: sortText(order) })
    .from(q)
    .innerJoin(a, eq(a.id, q.accountId))
    .where(
      and(
        inArray(q.entityId, companies(ctx, input.entityId)),
        stateFilter(input.state, now),
        afterCursor(order, input.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return QuotePageDto.parse({
    items: page.map(({ sortValue: _sort, ...row }) => toQuoteRow(row, now)),
    nextCursor: nextCursor(
      order,
      rows.length > input.limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.id },
    ),
  });
}

/** Account 360's quotes: the customer's newest quotes in one company (`quotes_account_idx`). */
export async function accountQuotes(
  ctx: QuoteListContext,
  accountId: string,
  entityId: number,
  now: Date = new Date(),
  limit = 20,
): Promise<QuoteRowDto[]> {
  const q = schema.quotes;
  const a = schema.accounts;
  const rows = await ctx.tx
    .select(QUOTE_ROW_COLUMNS)
    .from(q)
    .innerJoin(a, eq(a.id, q.accountId))
    .where(and(eq(q.accountId, accountId), eq(q.entityId, entityId)))
    .orderBy(desc(q.createdAt), desc(q.id))
    .limit(limit);
  return rows.map((row) => toQuoteRow(row, now));
}

/** One quote with its lines, for the quote page. */
export async function getQuote(
  ctx: QuoteListContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<QuoteDto> {
  const input = parseQueryInput(QuoteRefInput, rawInput, 'sales.quote.get');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  return readQuote({ ...ctx, now }, input.entityId, input.quoteId);
}

/**
 * The ⌘K search for quotes by number (RPT-03): the quotes the caller can read whose number holds
 * the typed text, a number that is the text first, then the newest. Bounded by `limit`.
 */
export async function searchQuotes(
  ctx: QuoteListContext,
  rawInput: unknown,
  now: Date = new Date(),
): Promise<QuoteSearchHit[]> {
  const input = parseQueryInput(SearchInput, rawInput, 'sales.quote.search');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const q = schema.quotes;
  const a = schema.accounts;
  const rows = await ctx.tx
    .select({
      id: q.id,
      entityId: q.entityId,
      quoteNo: q.quoteNo,
      customerName: a.name,
      state: q.state,
      validUntil: q.validUntil,
    })
    .from(q)
    .innerJoin(a, eq(a.id, q.accountId))
    .where(
      and(inArray(q.entityId, [...ctx.entityIds]), ilike(q.quoteNo, containsPattern(input.q))),
    )
    .orderBy(sql`lower(${q.quoteNo}) = lower(${input.q}) desc`, desc(q.createdAt), desc(q.id))
    .limit(input.limit);
  return rows.map((row) =>
    QuoteSearchHitDto.parse({
      id: row.id,
      entityId: row.entityId,
      quoteNo: row.quoteNo,
      customerName: row.customerName,
      state: shownQuoteState(row.state, row.validUntil, now),
    }),
  );
}
