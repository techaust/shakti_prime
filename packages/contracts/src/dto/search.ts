import { z } from 'zod';
import { OpportunityStateSchema } from '../crm/enums';
import { EntityIdSchema, IdSchema } from '../ids';

/** The fewest characters a search looks for: one letter finds half the customers. */
export const SEARCH_MIN_CHARS = 2;

/** The most hits one search answers per kind: the palette shows a short list, not a page. */
export const SEARCH_MAX_HITS = 20;

/** What a person types into the ⌘K search: a name, a village or the last digits of a phone. */
export const SearchTextSchema = z.string().trim().min(SEARCH_MIN_CHARS).max(80);

/** A bounded search of one kind of record (DESIGN.md §6, Command palette). */
export const SearchInput = z
  .object({
    q: SearchTextSchema,
    limit: z.number().int().min(1).max(SEARCH_MAX_HITS).default(8),
  })
  .strict();
export type SearchInput = z.input<typeof SearchInput>;

/**
 * A lead the search found: only what the palette shows and what its link needs (the company,
 * the pipeline and the status, which open the leads board where the lead sits). Never a phone
 * number, a price or a cost (AGENTS.md §5).
 */
export const LeadSearchHitDto = z
  .object({
    id: IdSchema,
    entityId: EntityIdSchema,
    pipelineKey: z.string(),
    state: OpportunityStateSchema,
    customerName: z.string(),
    village: z.string().nullable(),
  })
  .strict();
export type LeadSearchHitDto = z.infer<typeof LeadSearchHitDto>;

/** A team member the search found, for a user administrator. */
export const PersonSearchHitDto = z
  .object({ id: IdSchema, displayName: z.string(), email: z.string() })
  .strict();
export type PersonSearchHitDto = z.infer<typeof PersonSearchHitDto>;

/** The palette's search: one text, looked for in every kind the caller may read. */
export const PaletteSearchInput = z.object({ q: SearchTextSchema }).strict();
export type PaletteSearchInput = z.input<typeof PaletteSearchInput>;

/** What the palette's search found; a kind the caller may not read comes back empty. */
export const PaletteSearchDto = z
  .object({ leads: z.array(LeadSearchHitDto), people: z.array(PersonSearchHitDto) })
  .strict();
export type PaletteSearchDto = z.infer<typeof PaletteSearchDto>;
