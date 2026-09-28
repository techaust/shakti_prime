import { z } from 'zod';
import { ContrastSchema } from '../../auth/enums';

/**
 * The signed-in person turns Higher contrast on or off for their own screens (DESIGN.md §2.1);
 * like the theme, it follows them to every device.
 */
export const SetContrastInput = z.object({ contrast: ContrastSchema }).strict();
export type SetContrastInput = z.infer<typeof SetContrastInput>;

export const ContrastDto = z.object({ contrast: ContrastSchema }).strict();
export type ContrastDto = z.infer<typeof ContrastDto>;
