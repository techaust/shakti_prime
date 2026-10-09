import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { standInForTurnstile } from './turnstile';
import { storageStatePath, type ProjectName, type SignedInRole } from './users';

export { expect };
export { expectNoAxeViolations } from './axe';
export { snap } from './snap';

/**
 * Playwright's `test`, whose every browser context serves the Turnstile stand-in (turnstile.ts).
 * A run against an environment with real Turnstile keys (staging, through E2E_BASE_URL) sets
 * E2E_REAL_TURNSTILE=1 and keeps Cloudflare's own widget.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    if (process.env.E2E_REAL_TURNSTILE !== '1') await standInForTurnstile(context);
    await provide(context);
  },
  // `E2E_CPU_THROTTLE=6` slows the browser's own work six times, as a machine short of memory and
  // processors does: the way to reproduce a journey that fails only on a loaded machine (a click
  // before the page has hydrated, a wait that is too short).
  page: async ({ page }, provide) => {
    const rate = Number(process.env.E2E_CPU_THROTTLE ?? '1');
    if (rate > 1) {
      const session = await page.context().newCDPSession(page);
      await session.send('Emulation.setCPUThrottlingRate', { rate });
    }
    await provide(page);
  },
});

/** The running project (desktop light, desktop dark, phone), for the per-project people of the seed. */
export function projectName(): ProjectName {
  return base.info().project.name as ProjectName;
}

/** `test.use(signedInAs('teleCaller'))`: the specs of a describe block act as that role. */
export function signedInAs(role: SignedInRole): { storageState: string } {
  return { storageState: storageStatePath(role) };
}

/** A fresh visitor with no session, for the public screens. */
export const signedOut = { storageState: { cookies: [], origins: [] } };

/**
 * A data grid by its caption: the table on wider screens, the list of cards on a phone
 * (packages/ui/src/data-grid.tsx), whichever the project shows.
 */
export function dataGrid(page: Page, caption: string): Locator {
  return page
    .getByRole('table', { name: caption })
    .or(page.getByRole('list', { name: caption }))
    .filter({ visible: true });
}

/**
 * Waits until React has taken over an element. Before that, a click on it does nothing and text
 * typed into it is lost when the page hydrates; on a machine short of processors the gap between
 * the page showing and the page working is seconds long. React marks each host element it hydrates
 * with an internal key (`__reactProps$...`), which is what this waits for.
 */
export async function hydrated(locator: Locator): Promise<Locator> {
  await locator.waitFor();
  await expect
    .poll(() =>
      locator.evaluate((el) => Object.keys(el).some((key) => key.startsWith('__reactProps$'))),
    )
    .toBe(true);
  return locator;
}

/**
 * Narrows the screen to one company through the company switcher, as a person with several
 * companies does, and waits until the screen shows it.
 */
export async function showCompany(page: Page, company: string): Promise<void> {
  await page.getByRole('button', { name: /^Showing .*\. Choose a company$/ }).click();
  await page.getByRole('menuitemradio', { name: company }).click();
  await expect(
    page.getByRole('button', { name: `Showing ${company}. Choose a company` }),
  ).toBeVisible({ timeout: 30_000 });
}
