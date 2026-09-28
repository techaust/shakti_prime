import {
  DeletedViewDto,
  DeleteViewInput,
  DomainError,
  newId,
  SAVED_VIEWS_PER_SCREEN,
  SavedViewDto,
  SaveViewInput,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { and, count, eq } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';
import { toSavedViewDto } from '../../queries/profile/saved-views';

const v = schema.savedViews;

/** A view as its audit row records it; the settings are the grid's own ids and words. */
function audited(row: { screen: string; name: string; settingsJson: unknown }) {
  return { screen: row.screen, name: row.name, settings: row.settingsJson };
}

/**
 * `profile.view.save`: the caller saves how a grid looks (columns, sort, filters, row height) as a
 * view of their own; with `id`, renames or updates one of their own views. RLS lets a person
 * reach only their own views, so someone else's id answers `not_found`, as a removed one does.
 */
export const saveView = defineCommand({
  name: 'profile.view.save',
  permission: 'profile.write',
  minScope: 'own',
  input: SaveViewInput,
  output: SavedViewDto,
  auditFields: ['screen', 'name', 'settings'],
  constraintReasons: { saved_views_name_unique: 'saved_view_name_taken' },
  async handler(ctx, input) {
    const owner = ctx.principal.id;
    if (input.id === undefined) {
      const [held] = await ctx.tx
        .select({ n: count() })
        .from(v)
        .where(and(eq(v.principalId, owner), eq(v.screen, input.screen)));
      if ((held?.n ?? 0) >= SAVED_VIEWS_PER_SCREEN) {
        throw new DomainError('validation_failed', 'too many saved views on this screen', {
          reason: 'saved_view_limit',
        });
      }
      const [row] = await ctx.tx
        .insert(v)
        .values({
          id: newId(),
          principalId: owner,
          screen: input.screen,
          name: input.name,
          settingsJson: input.settings,
        })
        .returning();
      if (row === undefined) throw new DomainError('internal', 'saved view was not stored');
      ctx.audit({
        aggregateType: 'saved_view',
        aggregateId: row.id,
        entityId: null,
        after: audited(row),
      });
      return toSavedViewDto(row);
    }

    const [before] = await ctx.tx
      .select()
      .from(v)
      .where(and(eq(v.id, input.id), eq(v.principalId, owner)))
      .limit(1);
    if (before?.screen !== input.screen) {
      throw new DomainError('not_found', 'no saved view with this id', {
        reason: 'saved_view_gone',
      });
    }
    const [row] = await ctx.tx
      .update(v)
      .set({ name: input.name, settingsJson: input.settings })
      .where(and(eq(v.id, input.id), eq(v.principalId, owner)))
      .returning();
    if (row === undefined) {
      throw new DomainError('not_found', 'no saved view with this id', {
        reason: 'saved_view_gone',
      });
    }
    ctx.audit({
      aggregateType: 'saved_view',
      aggregateId: row.id,
      entityId: null,
      before: audited(before),
      after: audited(row),
    });
    return toSavedViewDto(row);
  },
});

/** `profile.view.delete`: the caller removes one of their own saved views. */
export const deleteView = defineCommand({
  name: 'profile.view.delete',
  permission: 'profile.write',
  minScope: 'own',
  input: DeleteViewInput,
  output: DeletedViewDto,
  auditFields: ['screen', 'name', 'settings'],
  async handler(ctx, input) {
    const [row] = await ctx.tx
      .delete(v)
      .where(and(eq(v.id, input.id), eq(v.principalId, ctx.principal.id)))
      .returning();
    if (row === undefined) {
      throw new DomainError('not_found', 'no saved view with this id', {
        reason: 'saved_view_gone',
      });
    }
    ctx.audit({
      aggregateType: 'saved_view',
      aggregateId: row.id,
      entityId: null,
      before: audited(row),
    });
    return { id: row.id };
  },
});
