import { asPrincipal, closeDb, principalFor } from '@shakti/db/testing';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { leadSearchQuery } from '../../src/queries/crm/search-leads';

afterAll(closeDb);

/** The plan of the ⌘K lead search for `q`, as the given role reads it through the policies. */
async function plan(q: string, role: 'general_manager' | 'tele_caller_cc'): Promise<string> {
  return asPrincipal(principalFor(role, [1]), async (ctx) => {
    // The suite's tables are small, where a full read is cheapest; turned off only to show that
    // the index can serve the search. With 100,000 phones the planner picks it unaided.
    await ctx.tx.execute(sql`set local enable_seqscan = off`);
    const { query } = await leadSearchQuery(ctx, { q });
    const rows = (await ctx.tx.execute(sql`explain ${query}`)) as unknown as {
      'QUERY PLAN': string;
    }[];
    return rows.map((r) => r['QUERY PLAN']).join('\n');
  });
}

describe('⌘K search by the last digits of a phone (0051)', () => {
  it('finds the phones through the index on the reversed number, under the policies', async () => {
    for (const role of ['general_manager', 'tele_caller_cc'] as const) {
      for (const q of ['4821', '98765 43210', '+91 98765 43210']) {
        const text = await plan(q, role);
        expect(text, `${role} ${q}`).toContain('contact_phones_e164_reversed_idx');
      }
    }
  });

  it('matches the digits as a prefix of the reversed number, never as a pattern', async () => {
    const text = await plan('4821', 'general_manager');
    expect(text).toContain(`e164_reversed ^@ '1284'::text`);
    expect(text).not.toMatch(/e164 ~~ /);
  });
});
