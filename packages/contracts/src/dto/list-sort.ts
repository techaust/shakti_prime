import { z } from 'zod';

export const SortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/**
 * The order a grid asks its list for (DESIGN.md §6): one whitelisted column, up or down. The
 * column keys are the grid's own column ids, so a saved view's sort is sent as it is. A list
 * sorts over every row it can read, not over the rows already on screen, and its keyset cursor
 * belongs to one sort: "Load more" sends the same sort with the cursor.
 */
export const listSortOf = <const K extends readonly [string, ...string[]]>(columns: K) =>
  z.object({ column: z.enum(columns), direction: SortDirectionSchema }).strict();

/**
 * Leads: only the last change, which the `(updated_at, id)` indexes serve. The customer,
 * contact, phone, stage, status and company columns are not offered: each would need a join or
 * an index of its own to sort a large company's leads.
 */
export const LEAD_SORT_COLUMNS = ['updated'] as const;
export const LeadSortSchema = listSortOf(LEAD_SORT_COLUMNS);
export type LeadSort = z.infer<typeof LeadSortSchema>;

/** Admin › Team members: the staff list is small, so any stored column sorts it. */
export const USER_SORT_COLUMNS = ['name', 'email', 'authenticator', 'lastSignIn'] as const;
export const UserSortSchema = listSortOf(USER_SORT_COLUMNS);
export type UserSort = z.infer<typeof UserSortSchema>;

/** Price Master: the items of one price list, a catalogue of a few thousand at most. */
export const PRICE_SORT_COLUMNS = ['item', 'code', 'category', 'price', 'updated'] as const;
export const PriceSortSchema = listSortOf(PRICE_SORT_COLUMNS);
export type PriceSort = z.infer<typeof PriceSortSchema>;

/** Imports: the jobs of the companies being viewed. */
export const IMPORT_JOB_SORT_COLUMNS = [
  'file',
  'total',
  'valid',
  'committed',
  'startedBy',
  'started',
] as const;
export const ImportJobSortSchema = listSortOf(IMPORT_JOB_SORT_COLUMNS);
export type ImportJobSort = z.infer<typeof ImportJobSortSchema>;
