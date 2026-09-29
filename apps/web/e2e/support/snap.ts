import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Regions whose content changes from run to run: times and dates, error references, avatars
 * drawn from generated ids, the bot-check widget and the Next.js route announcer. Marked in the
 * markup with `data-dynamic` where no stable selector exists.
 */
const DYNAMIC = [
  '[data-dynamic]',
  'time',
  '[data-slot="avatar"]',
  '.cf-turnstile, [data-turnstile]',
  'iframe',
];

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
    // Fonts are loaded before the picture, so a late font swap never shows as a difference.
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: options.fullPage ?? true,
      mask: [...DYNAMIC.map((selector) => page.locator(selector)), ...(options.mask ?? [])],
    });
  });
}
