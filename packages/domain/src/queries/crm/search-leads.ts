import {
  LeadSearchHitDto,
  OpportunityStateSchema,
  SearchInput,
  type LeadSearchHitDto as LeadSearchHit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import {
  and,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNull,
  like,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { matchTier, resembles, similarityTo, useNameSimilarity } from '../name-match';
import { parseQueryInput } from '../parse-input';
import { containsPattern, matchesBySimilarity, phoneDigits } from '../search-text';
import { scopeFilter } from './list-leads';

type SearchContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The ⌘K search for leads (DESIGN.md §6, Command palette): the leads the caller can see whose
 * customer name, a contact's name or the site's village holds the typed text or, for three
 * characters or more, resembles it in spelling (pg_trgm word similarity, `NAME_SIMILARITY`), so
 * "Rmesh" finds "Ramesh" (DESIGN.md §9); or, when the text is digits, one of whose contacts'
 * phones ends with them. The same own, team and company narrowing as the leads list
 * (`scopeFilter`, AUDIT M33); RLS still decides every row. Bounded by `limit` (at most 20): a
 * name or village that is the text comes first, then one that starts with it, then the closest
 * in spelling, then the newest change. The names and villages are served by their trigram
 * indexes; a phone's last digits are not indexed and are only tested on the leads the scope
 * already allows.
 */
export async function searchLeads(ctx: SearchContext, rawInput: unknown): Promise<LeadSearchHit[]> {
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
  const phoneEnds =
    digits === undefined
      ? undefined
      : exists(
          ctx.tx
            .select({ one: sql`1` })
            .from(ac)
            .innerJoin(ph, eq(ph.contactId, ac.contactId))
            .where(and(eq(ac.accountId, o.accountId), like(ph.e164, `%${digits}`))),
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

  const rows = await ctx.tx
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

  return rows.map((r) =>
    LeadSearchHitDto.parse({ ...r, state: OpportunityStateSchema.parse(r.state) }),
  );
}
