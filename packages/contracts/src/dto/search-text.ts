import { z } from 'zod';

/** The fewest characters a search looks for: one letter finds half the customers. */
export const SEARCH_MIN_CHARS = 2;

/** What a person types into the ⌘K search: a name, a village or the last digits of a phone. */
export const SearchTextSchema = z.string().trim().min(SEARCH_MIN_CHARS).max(80);
