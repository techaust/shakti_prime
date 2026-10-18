import type { ContrastPreference, Theme } from '@shakti/contracts';

// The contract values the app shell and the profile page read on every staff screen (the theme
// sync, the profile menu, the theme and contrast choices, the password form), apart from the rest
// of `contract-values.ts`, so a screen that needs none of the others never downloads them
// (BLUEPRINT §11.4). `contract-values.ts` re-exports them, and `contract-values.test.ts` keeps each
// equal to the contract's own.

/** Theme preference (docs/08-design-system.md §7), in the order the profile menu offers it. */
export const THEMES = ['system', 'light', 'dark'] as const satisfies readonly Theme[];

export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/** Contrast preference (docs/08-design-system.md §2.1). */
export const CONTRASTS = ['standard', 'high'] as const satisfies readonly ContrastPreference[];

/** The shortest password the policy accepts (docs/07-security.md §2). */
export const PASSWORD_MIN_LENGTH = 12;
