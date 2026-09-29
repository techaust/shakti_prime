import { z } from 'zod';
import { IdSchema } from '../../ids';

/**
 * The grids a person can save views of (DESIGN.md §6), each by one key; the database checks the
 * same list (`saved_views_screen_check`).
 */
export const SavedViewScreenSchema = z.enum(['leads', 'team_members', 'price_lists', 'imports', 'customers']);
export type SavedViewScreen = z.infer<typeof SavedViewScreenSchema>;

/** At most this many views per person on one screen. */
export const SAVED_VIEWS_PER_SCREEN = 30;

const ColumnIdSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/);

/**
 * What a view keeps: the hidden columns, the sort, the filters and the row height. Column ids are
 * the grid's own; a view that names a column the grid no longer has simply ignores it.
 */
export const SavedViewSettings = z
  .object({
    columns: z.object({ hidden: z.array(ColumnIdSchema).max(40) }).strict(),
    sort: z
      .object({ columnId: ColumnIdSchema, direction: z.enum(['asc', 'desc']) })
      .strict()
      .nullable(),
    filters: z
      .record(ColumnIdSchema, z.string().max(200))
      .refine((f) => Object.keys(f).length <= 20, { message: 'at most 20 filters' }),
    density: z.enum(['comfortable', 'compact']),
  })
  .strict();
export type SavedViewSettings = z.infer<typeof SavedViewSettings>;

const ViewNameSchema = z.string().trim().min(1).max(60);

/**
 * `profile.view.save`: saves the current grid as a new view, or, with `id`, renames or updates one
 * of the caller's own views.
 */
export const SaveViewInput = z
  .object({
    id: IdSchema.optional(),
    screen: SavedViewScreenSchema,
    name: ViewNameSchema,
    settings: SavedViewSettings,
  })
  .strict();
export type SaveViewInput = z.infer<typeof SaveViewInput>;

/** `profile.view.delete`: removes one of the caller's own views. */
export const DeleteViewInput = z.object({ id: IdSchema }).strict();
export type DeleteViewInput = z.infer<typeof DeleteViewInput>;

export const DeletedViewDto = z.object({ id: IdSchema }).strict();
export type DeletedViewDto = z.infer<typeof DeletedViewDto>;

export const ListSavedViewsInput = z.object({ screen: SavedViewScreenSchema }).strict();
export type ListSavedViewsInput = z.infer<typeof ListSavedViewsInput>;

export const SavedViewDto = z
  .object({
    id: IdSchema,
    screen: SavedViewScreenSchema,
    name: z.string(),
    settings: SavedViewSettings,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type SavedViewDto = z.infer<typeof SavedViewDto>;
