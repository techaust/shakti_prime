import { z } from 'zod';
import { ThemeSchema } from '../../auth/enums';

/** The signed-in person chooses System, Light or Dark for their own screens (DESIGN.md §7). */
export const SetThemeInput = z.object({ theme: ThemeSchema }).strict();
export type SetThemeInput = z.infer<typeof SetThemeInput>;

export const ThemeDto = z.object({ theme: ThemeSchema }).strict();
export type ThemeDto = z.infer<typeof ThemeDto>;
