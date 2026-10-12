import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Regions whose content changes from run to run: anything the markup marks `data-dynamic` (the
 * bot-check widget), times, and frames (the bot check's own, and the print previews, which the
 * print module checks). A journey masks its changing rows and codes through `mask`.
 */
const DYNAMIC = ['[data-dynamic]', 'time', 'iframe'];

/**
 * `fixedTimes` gives every `time` one fixed width while the picture is taken, for screens where a
 * date sits in running text. A masked date is still as wide as its digits (each digit of the text
 * font has its own width), so without it a date a few pixels wider can move the words beside it to
 * another line and shift the whole page below (the converting board on a phone).
 */
const FIXED_TIMES = join(import.meta.dirname, 'fixed-times.css');

/**
 * Compares the page with its baseline for the running project (desktop light, desktop dark,
 * phone). Baselines are made and compared only on Linux, inside the Playwright image
 * (`pnpm --filter web e2e:snap`), so fonts and anti-aliasing match CI; elsewhere the call returns
 * without comparing, and no baseline is ever written from another system.
 */
export async function snap(
  page: Page,
  name: string,
  options: { mask?: Locator[]; fullPage?: boolean; fixedTimes?: boolean } = {},
): Promise<void> {
  if (process.platform !== 'linux') return;
  await test.step(`screenshot ${name}`, async () => {
    // Fonts are loaded before the picture, so a late font swap never shows as a difference.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: options.fullPage ?? true,
      // A long page (the design board) takes more than one quick capture to settle.
      timeout: 60_000,
      mask: [...DYNAMIC.map((selector) => page.locator(selector)), ...(options.mask ?? [])],
      ...(options.fixedTimes === true ? { stylePath: FIXED_TIMES } : {}),
    });
  });
}
