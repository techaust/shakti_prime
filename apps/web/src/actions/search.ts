'use server';

import { hasGrant, PaletteSearchInput, type PaletteSearchDto } from '@shakti/contracts';
import { executeQuery, searchLeads, searchPeople } from '@shakti/domain';
import { toResult, type ActionResult } from './result';
import { parseInput, requestMeta, signedIn } from './support';

/** Hits of each kind the palette shows: a short list the eye takes in, not a page. */
const HITS_PER_KIND = 8;

/**
 * The ⌘K palette's search (DESIGN.md §6): the leads and, for a user administrator, the team
 * members that match the typed text, in one read. A kind the caller may not read is skipped,
 * not refused, so a person who cannot see team members still finds their leads.
 */
export async function searchPalette(rawInput: unknown): Promise<ActionResult<PaletteSearchDto>> {
  return toResult('searchPalette', async () => {
    const principal = await signedIn();
    const { q } = parseInput(PaletteSearchInput, rawInput);
    const { requestId } = await requestMeta();
    const grants = principal.permissions;
    return executeQuery(principal, { requestId }, async (context) => ({
      leads: hasGrant(grants, 'crm.lead.read', 'own')
        ? await searchLeads(context, { q, limit: HITS_PER_KIND })
        : [],
      people: hasGrant(grants, 'admin.users.write', 'all')
        ? await searchPeople(context, { q, limit: HITS_PER_KIND })
        : [],
    }));
  });
}
