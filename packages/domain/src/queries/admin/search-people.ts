import {
  PersonSearchHitDto,
  SearchInput,
  type PersonSearchHitDto as PersonSearchHit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, desc, eq, exists, ilike, inArray, or, sql } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { matchTier, resembles, similarityTo, useNameSimilarity } from '../name-match';
import { parseQueryInput } from '../parse-input';
import { containsPattern, matchesBySimilarity } from '../search-text';

type SearchContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The ⌘K search for team members (DESIGN.md §6), for a user administrator only, as Admin › Team
 * members is: staff who hold a role in a company of the request whose name or work email holds
 * the typed text, or whose name resembles it in spelling (three characters or more, as the lead
 * search), at most `limit` (20) of them. A name or email that is the text comes first, then one
 * that starts with it, then the closest in spelling, then by name. `users.name` has no trigram
 * index: the staff list is a few hundred rows, which a scan reads at once.
 */
export async function searchPeople(
  ctx: SearchContext,
  rawInput: unknown,
): Promise<PersonSearchHit[]> {
  const input = parseQueryInput(SearchInput, rawInput, 'admin.users.search');
  checkPermission(ctx.principal, 'admin.users.write', 'all');
  const q = input.q;
  const pattern = containsPattern(q);
  const bySpelling = matchesBySimilarity(q);
  if (bySpelling) await useNameSimilarity(ctx.tx);
  const u = schema.users;
  const uer = schema.userEntityRoles;
  const tier = sql<number>`greatest(${matchTier(q, u.name)}, ${matchTier(q, u.email)})`;
  const rows = await ctx.tx
    .select({ id: u.id, displayName: u.name, email: u.email })
    .from(u)
    .where(
      and(
        exists(
          ctx.tx
            .select({ one: uer.id })
            .from(uer)
            .where(and(eq(uer.userId, u.id), inArray(uer.entityId, [...ctx.entityIds]))),
        ),
        or(
          ilike(u.name, pattern),
          ilike(u.email, pattern),
          bySpelling ? resembles(q, u.name) : undefined,
        ),
      ),
    )
    .orderBy(desc(tier), desc(similarityTo(q, u.name)), asc(u.name), asc(u.id))
    .limit(input.limit);
  return rows.map((r) => PersonSearchHitDto.parse(r));
}
