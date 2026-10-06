import { hasGrant, type LeadDto, type LeadSort } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  afterCursor,
  keysetOrder,
  nextCursor,
  orderTerms,
  sortText,
  type SortKeys,
} from '../keyset-sort';
import { toLeadDto } from './lead-dto';

export interface ListLeadsOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  sort?: LeadSort | undefined;
}

export interface LeadPage {
  items: LeadDto[];
  nextCursor: string | null;
}

/**
 * The columns the leads list sorts by (`LEAD_SORT_COLUMNS`): the last change, which the
 * `(updated_at, id)` indexes serve for every scope, and the score, which
 * `opportunities_entity_score_idx` and, for every company, `opportunities_score_keyset_idx` serve.
 */
const LEAD_SORT_KEYS: SortKeys<LeadSort['column']> = {
  updated: { expr: schema.opportunities.updatedAt, type: 'timestamptz', nullable: false },
  score: { expr: schema.opportunities.score, type: 'integer', nullable: false },
};

type LeadContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The narrowing a caller's widest `crm.lead.read` scope implies, stated as a plain filter the
 * owner and team indexes can serve (AUDIT M33). RLS still decides; this only lets the planner
 * go straight to the caller's own leads instead of testing every lead in the company.
 */
export function scopeFilter(ctx: LeadContext) {
  const o = schema.opportunities;
  const me = ctx.principal.id;
  if (hasGrant(ctx.principal.permissions, 'crm.lead.read', 'entity')) return undefined;
  const team = ctx.principal.teamId;
  if (team !== undefined && hasGrant(ctx.principal.permissions, 'crm.lead.read', 'team')) {
    return or(eq(o.teamId, team), eq(o.ownerId, me));
  }
  return eq(o.ownerId, me);
}

/**
 * Leads visible to the caller, newest change first unless `sort` asks for the oldest,
 * keyset-paginated by `(updated_at, id)` (docs/05-database.md §7). RLS decides the rows; this query
 * only shapes them. The page of leads is found first, on `opportunities` alone, and only its
 * customers are fetched after (AUDIT M31): joining every visible customer before the limit grows
 * with the company, not with the page. The cursor carries the timestamp as Postgres text: rows
 * written in one transaction share `now()` to the microsecond, and a millisecond cursor would
 * skip them at a page boundary.
 */
export async function listLeads(
  ctx: LeadContext,
  options: ListLeadsOptions = {},
): Promise<LeadPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const o = schema.opportunities;
  const order = keysetOrder(LEAD_SORT_KEYS, o.id, options.sort, {
    column: 'updated',
    direction: 'desc',
  });

  const rows = await ctx.tx
    .select({ opportunity: o, sortValue: sortText(order) })
    .from(o)
    .where(
      and(
        isNull(o.archivedAt),
        inArray(o.entityId, [...ctx.entityIds]),
        scopeFilter(ctx),
        afterCursor(order, options.cursor),
      ),
    )
    .orderBy(...orderTerms(order))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const customers = await customersOf(
    ctx,
    page.map((r) => r.opportunity.accountId),
  );
  const last = page.at(-1);
  return {
    // A lead's customer is always readable to whoever reads the lead (AUDIT M25); one that is
    // not is left out rather than shown half-empty.
    items: page.flatMap((r) => {
      const customer = customers.get(r.opportunity.accountId);
      return customer === undefined
        ? []
        : [toLeadDto(r.opportunity, customer.account, customer.contact, customer.phone)];
    }),
    nextCursor: nextCursor(
      order,
      rows.length > limit,
      last === undefined ? undefined : { value: last.sortValue, id: last.opportunity.id },
    ),
  };
}

/** The customers of one page of leads: account, its one owner contact and that contact's main phone. */
async function customersOf(ctx: LeadContext, accountIds: readonly string[]) {
  const a = schema.accounts;
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const p = schema.contactPhones;
  const out = new Map<
    string,
    {
      account: { id: string; type: string; name: string };
      contact: { id: string; name: string } | null;
      phone: string | null;
    }
  >();
  if (accountIds.length === 0) return out;
  const rows = await ctx.tx
    .select({
      account: { id: a.id, type: a.type, name: a.name },
      contactId: c.id,
      contactName: c.name,
      phone: p.e164,
    })
    .from(a)
    // One owner per customer and one main phone per contact (unique indexes), so these joins
    // never repeat a customer; one whose owner or phone is not recorded yet still comes back.
    .leftJoin(ac, and(eq(ac.accountId, a.id), eq(ac.role, 'owner')))
    .leftJoin(c, eq(c.id, ac.contactId))
    .leftJoin(p, and(eq(p.contactId, c.id), eq(p.isPrimary, true)))
    .where(inArray(a.id, [...new Set(accountIds)]));
  for (const row of rows) {
    out.set(row.account.id, {
      account: row.account,
      contact:
        row.contactId === null || row.contactName === null
          ? null
          : { id: row.contactId, name: row.contactName },
      phone: row.phone,
    });
  }
  return out;
}

/** For tests and admin tools: how many leads the caller can see. */
export async function countLeads(ctx: LeadContext): Promise<number> {
  const o = schema.opportunities;
  const [row] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(o)
    .where(and(isNull(o.archivedAt), inArray(o.entityId, [...ctx.entityIds]), scopeFilter(ctx)));
  return row?.n ?? 0;
}
