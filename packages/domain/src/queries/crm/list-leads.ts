import { DomainError, IdSchema, type LeadDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
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

/**
 * Leads visible to the caller, newest change first, keyset-paginated by `(updated_at, id)`
 * (docs/DATABASE.md §7). RLS decides the rows; this query only shapes them. The cursor carries
 * the timestamp as Postgres text: rows written in one transaction share `now()` to the
 * microsecond, and a millisecond cursor would skip them at a page boundary.
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
      updatedAtText: sql<string>`${o.updatedAt}::text`,
    })
    .from(o)
    .innerJoin(a, eq(a.id, o.accountId))
    // One owner per customer and one main phone per contact (unique indexes), so these joins
    // never repeat a lead; a lead whose owner or phone is not recorded yet is still listed.
    .leftJoin(ac, and(eq(ac.accountId, a.id), eq(ac.role, 'owner')))
    .leftJoin(c, eq(c.id, ac.contactId))
    .leftJoin(p, and(eq(p.contactId, c.id), eq(p.isPrimary, true)))
    .where(
      and(
        isNull(o.archivedAt),
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
  const last = page.at(-1);
  return {
    items: page.map((r) => toLeadDto(r.opportunity, r.account, r.contact, r.phone)),
    nextCursor:
      rows.length > limit && last !== undefined
        ? encodeCursor(last.updatedAtText, last.opportunity.id)
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
