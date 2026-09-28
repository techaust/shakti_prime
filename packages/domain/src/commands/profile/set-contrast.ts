import {
  ContrastDto,
  DomainError,
  SetContrastInput,
  type ContrastPreference,
} from '@shakti/contracts';
import { schema } from '@shakti/db';
import { eq, sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `profile.contrast.set`: the caller turns Higher contrast on or off on their own profile. The
 * write goes through `app.set_own_contrast()`, which changes only the contrast of the caller's own
 * row, as `profile.theme.set` does for the theme.
 */
export const setContrast = defineCommand({
  name: 'profile.contrast.set',
  permission: 'profile.write',
  minScope: 'own',
  input: SetContrastInput,
  output: ContrastDto,
  async handler(ctx, input) {
    const [current] = await ctx.tx
      .select({ contrast: schema.users.contrast })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.principal.id))
      .limit(1);
    const rows = (await ctx.tx.execute(
      sql`select app.set_own_contrast(${input.contrast}) as contrast`,
    )) as unknown as { contrast: ContrastPreference | null }[];
    const contrast = rows[0]?.contrast;
    if (contrast == null) {
      throw new DomainError('not_found', 'no active user for this request');
    }
    ctx.audit({
      aggregateType: 'user',
      aggregateId: ctx.principal.id,
      entityId: null,
      before: { contrast: current?.contrast ?? null },
      after: { contrast },
    });
    return { contrast };
  },
});
