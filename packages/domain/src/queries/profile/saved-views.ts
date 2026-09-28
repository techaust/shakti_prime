import { ListSavedViewsInput, SavedViewSettings, type SavedViewDto } from '@shakti/contracts';
import { schema, type RequestContext } from '@shakti/db';
import { and, asc, eq } from 'drizzle-orm';
import { parseQueryInput } from '../parse-input';

type SavedViewRow = typeof schema.savedViews.$inferSelect;

/** What a view falls back to when its stored settings no longer parse. */
const DEFAULT_SETTINGS: SavedViewSettings = {
  columns: { hidden: [] },
  sort: null,
  filters: {},
  density: 'compact',
};

/**
 * A stored view as the screens read it. Settings saved by an older screen that no longer parse
 * fall back to the grid's defaults rather than failing the whole list.
 */
export function toSavedViewDto(row: SavedViewRow): SavedViewDto {
  const settings = SavedViewSettings.safeParse(row.settingsJson);
  return {
    id: row.id,
    screen: row.screen as SavedViewDto['screen'],
    name: row.name,
    settings: settings.success ? settings.data : DEFAULT_SETTINGS,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The caller's own saved views of one screen, by name. RLS shows no one else's. */
export async function listSavedViews(
  ctx: Pick<RequestContext, 'tx' | 'principal'>,
  rawInput: unknown,
): Promise<SavedViewDto[]> {
  const input = parseQueryInput(ListSavedViewsInput, rawInput, 'profile.views.list');
  const v = schema.savedViews;
  const rows = await ctx.tx
    .select()
    .from(v)
    .where(and(eq(v.principalId, ctx.principal.id), eq(v.screen, input.screen)))
    .orderBy(asc(v.name), asc(v.id));
  return rows.map(toSavedViewDto);
}
