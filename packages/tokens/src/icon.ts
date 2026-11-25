// The browser-tab icon of the web app (`apps/web/src/app/icon.svg`), generated from the tokens by
// `pnpm --filter @shakti/tokens build`, so it always carries the current accent. A favicon is
// one file for every theme, so it takes the light values, as the print templates do.
import { colors } from './tokens';

/**
 * The Spark S, drawn for a 32 × 32 box: its small-size cut, in one colour with a wider spark so
 * the cut still shows at 16 px. The full mark is `apps/web/public/brand/shakti-prime-mark.svg`.
 */
const MARK =
  'M24.84 6.82H13.05A5.44 5.44 0 0 0 13.05 17.7H13.91L15.72 14.3H13.05A2.04 2.04 0 0 1 13.05 10.22H23.03ZM7.16 25.18H18.95A5.44 5.44 0 0 0 18.95 14.3H18.09L16.28 17.7H18.95A2.04 2.04 0 0 1 18.95 21.78H8.97Z';

/** The icon's SVG: the mark in the text-on-accent colour on an accent tile. */
export function renderAppIcon(): string {
  const tile = colors.accent.light;
  const mark = colors['accent-fg'].light;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${tile}"/><path d="${MARK}" fill="${mark}"/></svg>\n`;
}
