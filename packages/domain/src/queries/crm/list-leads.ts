import { DomainError, hasGrant, IdSchema, type LeadDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { toLeadDto } from './lead-dto';

/** `updatedAt` is the Postgres text form of the timestamp so no microsecond is lost. */
const CursorSchema = z
  .object({
    updatedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
    id: IdSchema,
  })
  .strict();

export interface ListLeadsOptions {
  cursor?: string;
  limit?: number;
}

export interface LeadPage {
  items: LeadDto[];
  nextCursor: string | null;
}

function decodeCursor(cursor: string): { updatedAt: string; id: string } {
  try {
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor });
  }
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), 'utf8').toString('base64url');
}

type LeadContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The narrowing a caller's widest `crm.lead.read` scope implies, stated as a plain filter the
 * owner and team indexes can serve (AUDIT M33). RLS still decides; this only lets the planner
 * go straight to the caller's own leads instead of testing every lead in the company.
 */
function scopeFilter(ctx: LeadContext) {
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
 * Leads visible to the caller, newest change first, keyset-paginated by `(updated_at, id)`
 * (docs/DATABASE.md §7). RLS decides the rows; this query only shapes them. The page of leads is
 * found first, on `opportunities` alone, and only its customers are fetched after (AUDIT M31):
 * joining every visible customer before the limit grows with the company, not with the page.
 * The cursor carries the timestamp as Postgres text: rows written in one transaction share
 * `now()` to the microsecond, and a millisecond cursor would skip them at a page boundary.
 */
export async function listLeads(
  ctx: LeadContext,
  options: ListLeadsOptions = {},
): Promise<LeadPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const o = schema.opportunities;

  const rows = await ctx.tx
    .select({ opportunity: o, updatedAtText: sql<string>`${o.updatedAt}::text` })
    .from(o)
    .where(
      and(
        isNull(o.archivedAt),
        inArray(o.entityId, [...ctx.entityIds]),
        scopeFilter(ctx),
        after === undefined
          ? undefined
          : or(
              lt(o.updatedAt, sql`${after.updatedAt}::timestamptz`),
              and(eq(o.updatedAt, sql`${after.updatedAt}::timestamptz`), lt(o.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(o.updatedAt), desc(o.id))
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
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.updatedAtText, last.opportunity.id)
        : null,
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
