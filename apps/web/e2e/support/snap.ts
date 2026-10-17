import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Regions whose content changes from run to run: anything the markup marks `data-dynamic`, times,
 * and frames (the bot check's own, and the print previews, which the print module checks). A
 * journey masks its changing rows and codes through `mask`.
 */
const DYNAMIC = ['main [data-dynamic]', '[role="dialog"] [data-dynamic]', 'time', 'iframe'];

/** Gives the masked values their fixed width (`data-snap-fixed`) while the picture is taken. */
const SNAP_CSS = join(import.meta.dirname, 'snap.css');

/**
 * Parts of every page masked whole, never resized:
 * - the main menu: its entries come from the principal's grants, which the `visibleNav` unit tests
 *   cover (apps/web/src/nav.test.ts, screens/palette.test.ts). In the Linux runs the Executive's menu
 *   showed Converting in some runs and not in others, with no change to its grants, so a picture
 *   of a screen never depends on the menu;
 * - the top bar's notification bell and Agent Inbox, whose counts (shown, or not shown at none)
 *   move as other journeys file notices and suggestions;
 * - the bot check's widget.
 */
function alwaysMasked(page: Page): Locator[] {
  return [
    page.getByRole('navigation', { name: 'Main menu' }),
    page.locator('header button[aria-haspopup="dialog"]'),
    page.locator('header a[href="/inbox"]'),
    page.locator('div[data-dynamic]'),
  ];
}

/**
 * Marks the masked values that take their width from their own text: an inline element or a
 * text-only item of a flex row (`data-snap-fixed`), a table cell holding one (`data-snap-cell`)
 * and its table (`data-snap-table`), whose heads keep their columns' minimum widths
 * (`data-snap-width`, the width a head had before). A block, a form field or a region keeps its
 * own size.
 */
async function markFixedWidths(masks: Locator[]): Promise<void> {
  for (const mask of masks) {
    await mask.evaluateAll((elements) => {
      for (const el of elements) {
        if (!(el instanceof HTMLElement) || el.closest('header, nav')) continue;
        // A table holding a changing value is laid out from its heads alone while the picture is
        // taken, so a longer value in any cell never moves its columns. A fixed layout ignores a
        // cell's minimum width, so each head is given the widest minimum its column's cells or their
        // contents set (a box of controls, `min-w-*`), as the browser's own layout keeps it.
        const table = el.closest('table');
        if (table !== null && !table.hasAttribute('data-snap-table')) {
          table.setAttribute('data-snap-table', '');
          // A minimum in pixels only: `auto` sets none, and a share of the cell (`min-w-full`) none
          // of its own.
          const px = (value: string): number => (value.endsWith('px') ? parseFloat(value) : 0);
          const heads = Array.from(table.rows.item(0)?.cells ?? []);
          heads.forEach((head, i) => {
            let least = 0;
            for (const row of Array.from(table.rows)) {
              // Only rows laid out column for column; a cell spanning columns sets no minimum.
              const cell = row.cells.length === heads.length ? row.cells.item(i) : null;
              if (cell === null) continue;
              const style = getComputedStyle(cell);
              const inset =
                parseFloat(style.paddingLeft) +
                parseFloat(style.paddingRight) +
                parseFloat(style.borderLeftWidth) +
                parseFloat(style.borderRightWidth);
              least = Math.max(least, px(style.minWidth));
              for (const inner of Array.from(cell.querySelectorAll('*'))) {
                const min = px(getComputedStyle(inner).minWidth);
                if (min > 0) least = Math.max(least, min + inset);
              }
            }
            if (least > 0) {
              head.setAttribute('data-snap-width', head.style.width);
              head.style.width = `${String(Math.ceil(least))}px`;
            }
          });
        }
        if (el.tagName === 'TD' || el.tagName === 'TH') {
          el.setAttribute('data-snap-cell', '');
          continue;
        }
        if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'TABLE', 'TR'].includes(el.tagName)) continue;
        const display = getComputedStyle(el).display;
        const parent = el.parentElement ? getComputedStyle(el.parentElement).display : '';
        const textOnlyFlexItem = parent.includes('flex') && el.childElementCount === 0;
        if (display.startsWith('inline') || textOnlyFlexItem)
          el.setAttribute('data-snap-fixed', '');
      }
    });
  }
}

/**
 * Compares the page with its baseline for the running project (desktop light, desktop dark,
 * phone). Baselines are made and compared only on Linux, inside the Playwright image
 * (`pnpm --filter web e2e:snap`), so fonts and anti-aliasing match CI; elsewhere the call returns
 * without comparing, and no baseline is ever written from another system.
 */
export async function snap(
  page: Page,
  name: string,
  options: { mask?: Locator[]; fullPage?: boolean } = {},
): Promise<void> {
  if (process.platform !== 'linux') return;
  await test.step(`screenshot ${name}`, async () => {
    const fullPage = options.fullPage ?? true;
    if (fullPage) {
      // A full-page picture draws the fixed top bar where the page is scrolled to, and a run leaves
      // the page wherever its last action (or a reload) scrolled it, so the picture starts at the top.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    }
    // Fonts are loaded before the picture, so a late font swap never shows as a difference.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const changing = [
      ...DYNAMIC.map((selector) => page.locator(selector)),
      ...(options.mask ?? []),
    ];
    await markFixedWidths(changing);
    try {
      await expect(page).toHaveScreenshot(`${name}.png`, {
        fullPage,
        // A long page (the design board) takes more than one quick capture to settle.
        timeout: 60_000,
        mask: [...alwaysMasked(page), ...changing],
        stylePath: SNAP_CSS,
      });
    } finally {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll(
          '[data-snap-fixed], [data-snap-cell], [data-snap-table]',
        )) {
          el.removeAttribute('data-snap-fixed');
          el.removeAttribute('data-snap-cell');
          el.removeAttribute('data-snap-table');
        }
        // The heads' widths go back to what they were.
        for (const head of document.querySelectorAll<HTMLElement>('[data-snap-width]')) {
          head.style.width = head.getAttribute('data-snap-width') ?? '';
          head.removeAttribute('data-snap-width');
        }
      });
    }
  });
}
