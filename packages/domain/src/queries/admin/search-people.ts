import {
  PersonSearchHitDto,
  SearchInput,
  type PersonSearchHitDto as PersonSearchHit,
} from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq, exists, ilike, inArray, or } from 'drizzle-orm';
import { checkPermission } from '../../command/run-command';
import { parseQueryInput } from '../parse-input';
import { containsPattern } from '../search-text';

type SearchContext = Pick<RequestContext, 'tx' | 'principal' | 'entityIds'>;

/**
 * The ⌘K search for team members (DESIGN.md §6), for a user administrator only, as Admin › Team
 * members is: staff who hold a role in a company of the request whose name or work email holds
 * the typed text, by name, at most `limit` (20) of them.
 */
export async function searchPeople(
  ctx: SearchContext,
  rawInput: unknown,
): Promise<PersonSearchHit[]> {
  const input = parseQueryInput(SearchInput, rawInput, 'admin.users.search');
  checkPermission(ctx.principal, 'admin.users.write', 'all');
  const pattern = containsPattern(input.q);
  const u = schema.users;
  const uer = schema.userEntityRoles;
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
        or(ilike(u.name, pattern), ilike(u.email, pattern)),
      ),
    )
    .orderBy(asc(u.name), asc(u.id))
    .limit(input.limit);
  return rows.map((r) => PersonSearchHitDto.parse(r));
}
