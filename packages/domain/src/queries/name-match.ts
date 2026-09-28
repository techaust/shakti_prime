import type { RequestTx } from '@shakti/db';
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { startsWithPattern } from './search-text';

/**
 * How closely a typed name must resemble a run of words in a stored name to count as a match
 * (pg_trgm's word similarity, 0 to 1). At 0.4 one dropped or changed letter in a short Indian
 * name still matches ("Rmesh" and "Ramash" both find "Ramesh", "Sunita" finds "Suneeta"), while
 * names that share only an ending do not ("Suresh" and "Mahesh" do not find "Ramesh").
 */
export const NAME_SIMILARITY = 0.4;

/**
 * Sets the similarity a `resembles()` match needs, for the rest of this transaction only
 * (`set_config(..., true)` is `set local`), so no other request sees it.
 */
export async function useNameSimilarity(tx: RequestTx): Promise<void> {
  await tx.execute(
    sql`select set_config('pg_trgm.word_similarity_threshold', ${String(NAME_SIMILARITY)}, true)`,
  );
}

/**
 * True when the typed text resembles a run of words in `column` (pg_trgm's `<%`), which the
 * column's GIN trigram index serves. Needs `useNameSimilarity()` earlier in the transaction.
 */
export function resembles(q: string, column: SQLWrapper): SQL<boolean> {
  return sql<boolean>`${q}::text <% ${column}`;
}

/** 2 when `column` is the typed text, 1 when it starts with it, else 0; any letter case. */
export function matchTier(q: string, column: SQLWrapper): SQL<number> {
  return sql<number>`case when lower(${column}) = lower(${q}::text) then 2 when ${column} ilike ${startsWithPattern(q)} then 1 else 0 end`;
}

/** How closely the typed text resembles a run of words in `column`, 0 for an empty column. */
export function similarityTo(q: string, column: SQLWrapper): SQL<number> {
  return sql<number>`coalesce(word_similarity(${q}::text, ${column}), 0)`;
}
