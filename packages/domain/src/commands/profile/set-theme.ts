import { DomainError, SetThemeInput, ThemeDto, type Theme } from '@shakti/contracts';
import { sql } from 'drizzle-orm';
import { defineCommand } from '../../command/define-command';

/**
 * `profile.theme.set`: the caller saves System, Light or Dark on their own profile. The write goes
 * through `app.set_own_theme()`, which changes only the theme of the caller's own row; the users
 * table grants no one else's row and no other column to this command.
 */
export const setTheme = defineCommand({
  name: 'profile.theme.set',
  permission: 'profile.write',
  minScope: 'own',
  input: SetThemeInput,
  output: ThemeDto,
  async handler(ctx, input) {
    const rows = (await ctx.tx.execute(
      sql`select app.set_own_theme(${input.theme}) as theme`,
    )) as unknown as { theme: Theme | null }[];
    const theme = rows[0]?.theme;
    if (theme == null) {
      throw new DomainError('not_found', 'no active user for this request');
    }
    return { theme };
  },
});
