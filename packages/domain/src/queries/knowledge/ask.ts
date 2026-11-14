import {
  AskConversationDetailDto,
  AskConversationPageDto,
  ASK_CONVERSATION_PAGE_SIZE,
  AskSourceSchema,
  DomainError,
  IdSchema,
  ListAskConversationsInput,
  ReadAskConversationInput,
  type AskConversationDto,
  type AskMessageDto,
  type AskSource,
  type AskSourceKind,
  type AskSourceLabelDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkPermission } from '../../command/run-command';
import { askMessageDto } from '../../commands/knowledge/ask';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';
import { approvedPlaybook } from './playbook';

// Ask the Business's reads (docs/03-roadmap-appendix/phase2.md §6.5): a person's own
// conversations and the records their answers cite, as row security lets the person read them now.

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

const Sources = z.array(AskSourceSchema);

type ConversationRow = typeof schema.askConversations.$inferSelect;

function conversationDto(row: ConversationRow): AskConversationDto {
  return {
    id: row.id,
    entityId: row.entityId,
    entityIds: row.entityIds,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A conversation as a follow-up question reads it. */
export interface AskConversationForFollowUp {
  conversation: AskConversationDto;
  /** Its newest questions and answers, oldest first, at most the number asked for. */
  recent: AskMessageDto[];
  /** Every record its lookups returned, in any turn: what a new answer may also cite. */
  returned: AskSource[];
}

function missing(conversationId: string): DomainError {
  return new DomainError('not_found', `conversation ${conversationId} is not visible`, {
    reason: 'ask_conversation_missing',
  });
}

/** The conversation's messages, newest first, on `ask_messages_conversation_idx`. */
function messagesOf(ctx: Ctx, conversationId: string) {
  const m = schema.askMessages;
  return ctx.tx
    .select()
    .from(m)
    .where(eq(m.conversationId, conversationId))
    .orderBy(desc(m.createdAt), desc(m.id));
}

/**
 * One of the caller's own conversations, for a follow-up question: row security shows it only to
 * its person, in a request covering all its companies; any other is `ask_conversation_missing`.
 */
export async function loadAskConversation(
  ctx: Ctx,
  conversationId: string,
  recentTurns: number,
): Promise<AskConversationForFollowUp> {
  const c = schema.askConversations;
  const [row] = await ctx.tx.select().from(c).where(eq(c.id, conversationId)).limit(1);
  if (row === undefined) throw missing(conversationId);
  const messages = await messagesOf(ctx, row.id);
  const seen = new Set<string>();
  const returned: AskSource[] = [];
  for (const message of messages) {
    for (const source of Sources.parse(message.returnedJson)) {
      const key = `${source.kind}:${source.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      returned.push(source);
    }
  }
  return {
    conversation: conversationDto(row),
    recent: messages.slice(0, recentTurns).reverse().map(askMessageDto),
    returned,
  };
}

const ConversationCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();

/**
 * The conversation list's statement: the caller's own conversations in the request's companies,
 * last used first, one page and one row more after the cursor, on
 * `ask_conversations_user_updated_idx`. Its `EXPLAIN (ANALYZE)` plan is in the run file of B1.
 */
export function askConversationListQuery(ctx: Ctx, after: { t: string; id: string } | undefined) {
  const c = schema.askConversations;
  return ctx.tx
    .select({ row: c, updatedText: sql<string>`${c.updatedAt}::text` })
    .from(c)
    .where(
      and(
        // Row security says the same; stated so the planner reads the person's own index.
        eq(c.userId, ctx.principal.id),
        after === undefined
          ? undefined
          : sql`(${c.updatedAt}, ${c.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(c.updatedAt), desc(c.id))
    .limit(ASK_CONVERSATION_PAGE_SIZE + 1);
}

/** `/ask`: the caller's own conversations, last used first. */
export async function listAskConversations(
  ctx: Ctx,
  rawInput: unknown = {},
): Promise<AskConversationPageDto> {
  checkPermission(ctx.principal, 'knowledge.ask', 'team');
  const input = parseQueryInput(ListAskConversationsInput, rawInput, 'knowledge.ask.list');
  const after = input.cursor === null ? undefined : decodeCursor(ConversationCursor, input.cursor);
  const rows = await askConversationListQuery(ctx, after);
  const page = rows.slice(0, ASK_CONVERSATION_PAGE_SIZE);
  const last = page.at(-1);
  return AskConversationPageDto.parse({
    conversations: page.map((r) => conversationDto(r.row)),
    nextCursor:
      rows.length > ASK_CONVERSATION_PAGE_SIZE && last !== undefined
        ? encodeCursor({ t: last.updatedText, id: last.row.id })
        : null,
  });
}

/** `/ask`: one of the caller's conversations with its questions and answers in order. */
export async function readAskConversation(
  ctx: Ctx,
  rawInput: unknown,
): Promise<AskConversationDetailDto> {
  checkPermission(ctx.principal, 'knowledge.ask', 'team');
  const input = parseQueryInput(ReadAskConversationInput, rawInput, 'knowledge.ask.read');
  const c = schema.askConversations;
  const [row] = await ctx.tx.select().from(c).where(eq(c.id, input.conversationId)).limit(1);
  if (row === undefined) throw missing(input.conversationId);
  const messages = (await messagesOf(ctx, row.id)).reverse().map(askMessageDto);
  return AskConversationDetailDto.parse({
    conversation: conversationDto(row),
    messages,
    sources: await askSourceLabels(
      ctx,
      messages.flatMap((m) => m.cited),
    ),
  });
}

/** The ids of `sources` of one kind, each once. */
const idsOf = (sources: readonly AskSource[], kind: AskSourceKind): string[] => [
  ...new Set(sources.filter((s) => s.kind === kind).map((s) => s.id)),
];

/**
 * The words and links of cited records, read as the person now: a record they can no longer read
 * keeps its place with no words. A Playbook rule is read through `approvedPlaybook()`, so a rule
 * retired since is no longer named.
 */
export async function askSourceLabels(
  ctx: Ctx,
  sources: readonly AskSource[],
): Promise<AskSourceLabelDto[]> {
  const found = new Map<string, Omit<AskSourceLabelDto, 'kind' | 'id'>>();
  const put = (
    id: string,
    label: string,
    entityId: number | null = null,
    accountId: string | null = null,
  ) => found.set(id, { label, entityId, accountId });

  const quotes = idsOf(sources, 'quote');
  if (quotes.length > 0) {
    const q = schema.quotes;
    for (const r of await ctx.tx
      .select({ id: q.id, no: q.quoteNo, entityId: q.entityId, accountId: q.accountId })
      .from(q)
      .where(inArray(q.id, quotes))) {
      put(r.id, r.no, r.entityId, r.accountId);
    }
  }
  const orders = idsOf(sources, 'sales_order');
  if (orders.length > 0) {
    const o = schema.salesOrders;
    for (const r of await ctx.tx
      .select({ id: o.id, no: o.soNo, entityId: o.entityId, accountId: o.accountId })
      .from(o)
      .where(inArray(o.id, orders))) {
      put(r.id, r.no, r.entityId, r.accountId);
    }
  }
  const leads = idsOf(sources, 'opportunity');
  if (leads.length > 0) {
    const o = schema.opportunities;
    const a = schema.accounts;
    for (const r of await ctx.tx
      .select({ id: o.id, name: a.name, entityId: o.entityId, accountId: o.accountId })
      .from(o)
      .innerJoin(a, eq(a.id, o.accountId))
      .where(inArray(o.id, leads))) {
      put(r.id, r.name, r.entityId, r.accountId);
    }
  }
  const accounts = idsOf(sources, 'account');
  if (accounts.length > 0) {
    const a = schema.accounts;
    for (const r of await ctx.tx
      .select({ id: a.id, name: a.name })
      .from(a)
      .where(inArray(a.id, accounts))) {
      put(r.id, r.name, null, r.id);
    }
  }
  const files = idsOf(sources, 'knowledge_file');
  if (files.length > 0) {
    const k = schema.knowledgeFiles;
    for (const r of await ctx.tx
      .select({ id: k.id, title: k.title, entityId: k.entityId })
      .from(k)
      .where(inArray(k.id, files))) {
      put(r.id, r.title, r.entityId);
    }
  }
  const stages = idsOf(sources, 'pipeline_stage');
  if (stages.length > 0) {
    const s = schema.pipelineStages;
    for (const r of await ctx.tx
      .select({ id: s.id, name: s.name })
      .from(s)
      .where(inArray(s.id, stages))) {
      put(r.id, r.name);
    }
  }
  const items = idsOf(sources, 'item');
  if (items.length > 0) {
    const i = schema.items;
    for (const r of await ctx.tx
      .select({ id: i.id, name: i.name })
      .from(i)
      .where(inArray(i.id, items))) {
      put(r.id, r.name);
    }
  }
  const rules = new Set(idsOf(sources, 'playbook_directive'));
  if (rules.size > 0) {
    let cursor: string | null = null;
    do {
      const page = await approvedPlaybook(ctx, cursor === null ? {} : { cursor });
      for (const d of page.directives) if (rules.has(d.id)) put(d.id, d.title, d.entityId);
      cursor = page.nextCursor;
    } while (cursor !== null);
  }

  const seen = new Set<string>();
  const out: AskSourceLabelDto[] = [];
  for (const s of sources) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const f = found.get(s.id);
    out.push({
      kind: s.kind,
      id: s.id,
      label: f?.label ?? null,
      entityId: f?.entityId ?? null,
      accountId: f?.accountId ?? null,
    });
  }
  return out;
}

/** One item's cost side in one company, as Ask's item lookup reads it. */
export interface AskItemCost {
  itemId: string;
  entityId: number;
  movingAvgCost: string | null;
  lastPurchaseRate: string | null;
  asOf: Date | null;
}

/**
 * The cost side of some items in the request's companies, for Ask's item lookup: only with
 * `finance.cost.read` at company scope, and the cost policy on `item_costs` decides the rows as it
 * does on Catalogue (docs/07-security.md §4). By `item_costs_item_entity_unique`.
 */
export async function itemCostsFor(ctx: Ctx, itemIds: readonly string[]): Promise<AskItemCost[]> {
  checkPermission(ctx.principal, 'finance.cost.read', 'entity');
  if (itemIds.length === 0) return [];
  const c = schema.itemCosts;
  return ctx.tx
    .select({
      itemId: c.itemId,
      entityId: c.entityId,
      movingAvgCost: c.movingAvgCost,
      lastPurchaseRate: c.lastPurchaseRate,
      asOf: c.asOf,
    })
    .from(c)
    .where(and(inArray(c.itemId, [...itemIds]), inArray(c.entityId, [...ctx.entityIds])))
    .orderBy(asc(c.entityId), asc(c.itemId));
}
