import {
  LeadSearchHitDto,
  OpportunityStateSchema,
  SearchInput,
  type LeadSearchHitDto as LeadSearchHit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { matchTier, resembles, similarityTo, useNameSimilarity } from '../name-match';
import { parseQueryInput } from '../parse-input';
import { containsPattern, matchesBySimilarity, phoneDigits } from '../search-text';
import { scopeFilter } from './list-leads';

type SearchContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/** The typed digits backwards, the prefix of `contact_phones.e164_reversed` they end. */
function reversed(digits: string): string {
  let out = '';
  for (const d of digits) out = d + out;
  return out;
}

/**
 * The ⌘K search for leads (docs/08-design-system.md §6, Command palette): the leads the caller can see whose
 * customer name, a contact's name or the site's village holds the typed text or, for three
 * characters or more, resembles it in spelling (pg_trgm word similarity, `NAME_SIMILARITY`), so
 * "Rmesh" finds "Ramesh" (docs/08-design-system.md §9); or, when the text is digits, one of whose contacts'
 * phones ends with them. The same own, team and company narrowing as the leads list
 * (`scopeFilter`, AUDIT M33); RLS still decides every row. Bounded by `limit` (at most 20): a
 * name or village that is the text comes first, then one that starts with it, then the closest
 * in spelling, then the newest change.
 *
 * Under the policies Postgres will not use `ilike` or pg_trgm's operators (not leakproof) as an
 * index condition, so on its own this query would test every lead in the caller's scope (1.3 s
 * for an Executive at 50,000 leads, docs/04-architecture-appendix/lists.md). The candidates therefore come first
 * from `app.lead_search_ids()` (0052), a security-definer lookup that uses the trigram indexes on
 * the customer, contact and village names and the index on the phone written backwards
 * (`contact_phones.e164_reversed`, 0051), keeps to the leads and customers the caller may read
 * as the policies do, and returns the ids of the first `limit` matches in this query's order
 * (never more than 200). This query then reads only those leads, under the policies, with all its
 * own conditions and its order, so what the caller sees is exactly what RLS allows and what the
 * search found before.
 */
export async function searchLeads(ctx: SearchContext, rawInput: unknown): Promise<LeadSearchHit[]> {
  const { query } = await leadSearchQuery(ctx, rawInput);
  const rows = await query;
  return rows.map((r) =>
    LeadSearchHitDto.parse({ ...r, state: OpportunityStateSchema.parse(r.state) }),
  );
}

/**
 * The query `searchLeads` runs, unexecuted, so the security suite can read its plan. Checks the
 * input and the permission first, as `searchLeads` does.
 */
export async function leadSearchQuery(ctx: SearchContext, rawInput: unknown) {
  const input = parseQueryInput(SearchInput, rawInput, 'crm.lead.search');
  checkPermission(ctx.principal, 'crm.lead.read', 'own');
  const q = input.q;
  const pattern = containsPattern(q);
  const digits = phoneDigits(q);
  const bySpelling = matchesBySimilarity(q);
  if (bySpelling) await useNameSimilarity(ctx.tx);

  const o = schema.opportunities;
  const a = schema.accounts;
  const cs = schema.customerSites;
  const pl = schema.pipelines;
  const ac = schema.accountContacts;
  const c = schema.contacts;
  const ph = schema.contactPhones;

  const contactNamed = exists(
    ctx.tx
      .select({ one: sql`1` })
      .from(ac)
      .innerJoin(c, eq(c.id, ac.contactId))
      .where(
        and(
          eq(ac.accountId, o.accountId),
          or(ilike(c.name, pattern), bySpelling ? resembles(q, c.name) : undefined),
        ),
      ),
  );
  // `^@` (starts_with) is leakproof, so the index serves it under the policies; the digits hold
  // no pattern character. The customers are found once, not per lead (a hashed subplan).
  const phoneEnds =
    digits === undefined
      ? undefined
      : inArray(
          o.accountId,
          ctx.tx
            .select({ accountId: ac.accountId })
            .from(ph)
            .innerJoin(ac, eq(ac.contactId, ph.contactId))
            .where(sql`${ph.e164Reversed} ^@ ${reversed(digits)}`),
        );

  // The best score among the lead's contacts' names, for the order.
  const bestContact = (score: (name: typeof c.name) => SQL<number>) =>
    ctx.tx
      .select({ best: sql<number>`max(${score(c.name)})` })
      .from(ac)
      .innerJoin(c, eq(c.id, ac.contactId))
      .where(eq(ac.accountId, o.accountId));
  const tier = sql<number>`greatest(${matchTier(q, a.name)}, ${matchTier(q, cs.village)}, ${bestContact((n) => matchTier(q, n))})`;
  const closeness = sql<number>`greatest(${similarityTo(q, a.name)}, ${similarityTo(q, cs.village)}, ${bestContact((n) => similarityTo(q, n))})`;

  // The candidates, found through the indexes by the definer lookup (0052), then read here under
  // the policies and tested against every condition below.
  const phoneReversed = digits === undefined ? null : reversed(digits);
  const candidates = sql`${o.id} in (select candidate from app.lead_search_ids(${q}::text, ${bySpelling}::boolean, ${phoneReversed}::text, ${input.limit}::integer) as candidate)`;

  const query = ctx.tx
    .select({
      id: o.id,
      entityId: o.entityId,
      state: o.state,
      pipelineKey: pl.key,
      customerName: a.name,
      village: cs.village,
    })
    .from(o)
    // A lead's customer is always readable to whoever reads the lead (AUDIT M25).
    .innerJoin(a, eq(a.id, o.accountId))
    .innerJoin(pl, eq(pl.id, o.pipelineId))
    .leftJoin(cs, eq(cs.id, o.siteId))
    .where(
      and(
        candidates,
        isNull(o.archivedAt),
        inArray(o.entityId, [...ctx.entityIds]),
        scopeFilter(ctx),
        or(
          ilike(a.name, pattern),
          ilike(cs.village, pattern),
          bySpelling ? resembles(q, a.name) : undefined,
          bySpelling ? resembles(q, cs.village) : undefined,
          contactNamed,
          phoneEnds,
        ),
      ),
    )
    .orderBy(desc(tier), desc(closeness), desc(o.updatedAt), desc(o.id))
    .limit(input.limit);
  // Wrapped: a query builder is thenable, so returning it bare would run it.
  return { query };
}
