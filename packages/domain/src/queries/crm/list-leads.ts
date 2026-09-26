import { DomainError, IdSchema, type LeadDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { toLeadDto } from './lead-dto';

const CursorSchema = z.object({ updatedAt: z.iso.datetime(), id: IdSchema }).strict();

export interface ListLeadsOptions {
  cursor?: string;
  limit?: number;
}

export interface LeadPage {
  items: LeadDto[];
  nextCursor: string | null;
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const parsed = CursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { updatedAt: new Date(parsed.updatedAt), id: parsed.id };
  } catch {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor });
  }
}

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt: updatedAt.toISOString(), id }), 'utf8').toString(
    'base64url',
  );
}

/**
 * Leads visible to the caller, newest change first, keyset-paginated by `(updated_at, id)`
 * (docs/DATABASE.md §7). RLS decides the rows; this query only shapes them.
 */
export async function listLeads(
  ctx: Pick<RequestContext, 'tx'>,
  options: ListLeadsOptions = {},
): Promise<LeadPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const after = options.cursor === undefined ? undefined : decodeCursor(options.cursor);
  const o = schema.opportunities;
  const a = schema.accounts;
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const p = schema.contactPhones;

  const rows = await ctx.tx
    .select({
      opportunity: o,
      account: { id: a.id, type: a.type, name: a.name },
      contact: { id: c.id, name: c.name },
      phone: p.e164,
    })
    .from(o)
    .innerJoin(a, eq(a.id, o.accountId))
    .innerJoin(ac, and(eq(ac.accountId, a.id), eq(ac.role, 'owner')))
    .innerJoin(c, eq(c.id, ac.contactId))
    .innerJoin(p, and(eq(p.contactId, c.id), eq(p.isPrimary, true)))
    .where(
      and(
        isNull(o.archivedAt),
        after === undefined
          ? undefined
          : or(
              lt(o.updatedAt, after.updatedAt),
              and(eq(o.updatedAt, after.updatedAt), lt(o.id, after.id)),
            ),
      ),
    )
    .orderBy(desc(o.updatedAt), desc(o.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((r) => toLeadDto(r.opportunity, r.account, r.contact, r.phone)),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.opportunity.updatedAt, last.opportunity.id)
        : null,
  };
}

/** For tests and admin tools: how many leads the caller can see. */
export async function countLeads(ctx: Pick<RequestContext, 'tx'>): Promise<number> {
  const [row] = await ctx.tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.opportunities)
    .where(isNull(schema.opportunities.archivedAt));
  return row?.n ?? 0;
}
