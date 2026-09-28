// The browser-tab icon of the web app (`apps/web/src/app/icon.svg`), generated from the tokens by
// `pnpm --filter @shakti/tokens build`, so it always carries the current accent. A favicon is
// one file for every theme, so it takes the light values, as the print templates do.
import { colors } from './tokens';

/** The "S" mark, drawn for a 32 × 32 box. */
const MARK =
  'M20.8 11.2c-.9-1.2-2.6-1.9-4.6-1.9-2.8 0-4.9 1.4-4.9 3.6 0 2.1 1.6 3 4.6 3.6 2.3.5 3 1 3 1.9 0 1-1.1 1.7-2.9 1.7-1.7 0-3.1-.7-3.9-1.8l-1.7 1.4c1.1 1.6 3.2 2.5 5.6 2.5 3.1 0 5.3-1.5 5.3-3.9 0-2.2-1.6-3.1-4.8-3.7-2.1-.4-2.8-.9-2.8-1.8 0-.9 1-1.5 2.5-1.5 1.4 0 2.6.5 3.3 1.4z';

/** The icon's SVG: the mark in the text-on-accent colour on an accent tile. */
export function renderAppIcon(): string {
  const tile = colors.accent.light;
  const mark = colors['accent-fg'].light;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${tile}"/><path d="${MARK}" fill="${mark}"/></svg>\n`;
}
