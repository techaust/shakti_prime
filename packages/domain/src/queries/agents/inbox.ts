import {
  AgentRoleKeySchema,
  DomainError,
  hasGrant,
  IdSchema,
  INBOX_COUNT_LIMIT,
  InboxItemDto,
  ListInboxInput,
  type InboxCountDto,
  type InboxPageDto,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { AGENT_ACTION_TYPES, editableFields } from '../../ai/action-types';
import { checkPermission, isAgent } from '../../command/run-command';
import { decodeCursor, encodeCursor, parseQueryInput } from '../parse-input';

type Ctx = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The Agent Inbox is a person's: an agent never reads one (SECURITY §3.3). */
function checkInbox(ctx: Ctx): void {
  if (isAgent(ctx.principal)) {
    throw new DomainError('forbidden', 'the Agent Inbox is for people, not agents');
  }
  checkPermission(ctx.principal, 'agents.inbox.act', 'own');
}

/**
 * The rows the caller's inbox scope reaches, stated as the read policy states them, so the
 * planner can use the assignee and team indexes: own scope reads the caller's items, team scope
 * their team's as well, company scope every item of the company.
 */
function inboxScope(ctx: Ctx): SQL | undefined {
  const i = schema.inboxItems;
  const perms = ctx.principal.permissions;
  if (hasGrant(perms, 'agents.inbox.act', 'entity')) return undefined;
  const mine = eq(i.assigneeId, ctx.principal.id);
  const team = ctx.principal.teamId;
  return hasGrant(perms, 'agents.inbox.act', 'team') && team !== undefined
    ? or(mine, eq(i.teamId, team))
    : mine;
}

const InboxCursor = z.object({ t: z.string().max(40), id: IdSchema }).strict();
const PG_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/**
 * The caller's open inbox items in the request's companies, newest first, keyset on
 * `(created_at, id)`: their own, their team's at team scope, the company's at company scope
 * (`inbox_items_read`). A suggestion shows its agent, its action type and the fields a person may
 * change, and the customer's name when the caller reads the lead.
 */
export async function listInbox(ctx: Ctx, rawInput: unknown): Promise<InboxPageDto> {
  const input = parseQueryInput(ListInboxInput, rawInput, 'agents.inbox.list');
  checkInbox(ctx);
  const after = input.cursor === undefined ? undefined : decodeCursor(InboxCursor, input.cursor);
  if (after !== undefined && !PG_TIME.test(after.t)) {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor: input.cursor });
  }
  const i = schema.inboxItems;
  const a = schema.agentActions;
  const o = schema.opportunities;
  const acc = schema.accounts;
  const subjectAccount = alias(schema.accounts, 'subject_account');
  const rows = await ctx.tx
    .select({
      item: i,
      agent: a.agent,
      actionType: a.actionType,
      autonomy: a.autonomy,
      input: a.inputJson,
      accountName: sql<string | null>`coalesce(${acc.name}, ${subjectAccount.name})`,
      accountId: sql<string | null>`coalesce(${acc.id}, ${subjectAccount.id})`,
      createdText: sql<string>`${i.createdAt}::text`,
    })
    .from(i)
    .leftJoin(a, and(eq(a.id, i.agentActionId), eq(a.entityId, i.entityId)))
    .leftJoin(o, and(eq(i.subjectType, 'opportunity'), eq(o.id, i.subjectId)))
    .leftJoin(acc, eq(acc.id, o.accountId))
    .leftJoin(subjectAccount, and(eq(i.subjectType, 'account'), eq(subjectAccount.id, i.subjectId)))
    .where(
      and(
        eq(i.state, 'open'),
        inArray(i.entityId, [...ctx.entityIds]),
        inboxScope(ctx),
        after === undefined
          ? undefined
          : sql`(${i.createdAt}, ${i.id}) < (${after.t}::text::timestamptz, ${after.id}::uuid)`,
      ),
    )
    .orderBy(desc(i.createdAt), desc(i.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const type =
        r.actionType !== null && Object.hasOwn(AGENT_ACTION_TYPES, r.actionType)
          ? AGENT_ACTION_TYPES[r.actionType]
          : undefined;
      const proposed = (r.input ?? {}) as Record<string, unknown>;
      return InboxItemDto.parse({
        id: r.item.id,
        entityId: r.item.entityId,
        kind: r.item.kind,
        agent: r.agent === null ? null : AgentRoleKeySchema.parse(r.agent),
        actionType: r.actionType,
        autonomy: r.autonomy,
        subjectType: r.item.subjectType,
        subjectId: r.item.subjectId,
        subjectName: r.accountName,
        accountId: r.accountId,
        assigneeId: r.item.assigneeId,
        fields: type === undefined ? [] : editableFields(type, proposed),
        createdAt: r.item.createdAt.toISOString(),
      });
    }),
    nextCursor:
      rows.length > input.limit && last !== undefined
        ? encodeCursor({ t: last.createdText, id: last.item.id })
        : null,
  };
}

/** How many open items the caller has, counted up to `INBOX_COUNT_LIMIT`, for the top bar. */
export async function countInbox(ctx: Ctx): Promise<InboxCountDto> {
  checkInbox(ctx);
  const i = schema.inboxItems;
  const open = ctx.tx
    .select({ one: sql`1` })
    .from(i)
    .where(and(eq(i.state, 'open'), inArray(i.entityId, [...ctx.entityIds]), inboxScope(ctx)))
    .limit(INBOX_COUNT_LIMIT)
    .as('open_items');
  const [row] = await ctx.tx.select({ open: sql<number>`count(*)::int` }).from(open);
  return { open: row?.open ?? 0 };
}
