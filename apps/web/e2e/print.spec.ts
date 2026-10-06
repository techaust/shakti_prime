import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

/** The template pages the seed writes (`e2e/setup/print-pages.ts`), with the spike's data. */
const PAGES = join(import.meta.dirname, '.print');
const printPage = (name: string) => readFileSync(join(PAGES, `${name}.html`), 'utf8');

/** A4 and the label stocks at 96 pixels to the inch. */
const A4 = { width: 794, height: 1123 };
const LABELS = {
  '50x25': { width: 189, height: 95 },
  '100x50': { width: 378, height: 189 },
} as const;

/** A template's own page, as Chromium prints it: light, at the paper's size, fonts loaded. */
async function show(tab: Page, html: string, size: { width: number; height: number }) {
  await tab.emulateMedia({ media: 'print', colorScheme: 'light' });
  await tab.setViewportSize(size);
  await tab.setContent(html, { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('the print templates (ADR 0009), light only', () => {
  test.beforeEach(() => {
    // Printed documents are always light, whatever the screen: one project holds the baselines.
    test.skip(projectName() !== 'desktop-light', 'printed documents are light only');
  });

  test('the quotation, with the selling company’s letterhead, logo and bank account', async ({
    page: tab,
  }) => {
    await show(tab, printPage('quote'), A4);
    await expect(tab.getByRole('heading', { name: 'Agro Solar Hub' })).toBeVisible();
    await expect(tab.getByText('Bank account for payment')).toBeVisible();
    await snap(tab, 'print-quote');
  });

  test('the quotation of a real quote, as the render worker prints it', async ({ page: tab }) => {
    // Written by the seed from its quote in the snapshot company, with the real loader
    // (`e2e/setup/quotes.ts`): Price Master prices, the tax engine's amounts, words and terms.
    await show(tab, printPage('quote-real'), A4);
    await expect(tab.getByRole('heading', { name: 'Quotation' })).toBeVisible();
    await expect(tab.getByText('Mohan Lal Saini')).toBeVisible();
    await expect(tab.getByText(/^Rupees .* only$/)).toBeVisible();
    // The quote's own dates change with the day the seed made it.
    await snap(tab, 'print-quote-real', {
      mask: [tab.locator('.meta dd'), tab.locator('.terms li')],
    });
  });

  test('the company proof page', async ({ page: tab }) => {
    await show(tab, printPage('proof'), A4);
    await expect(tab.getByRole('heading', { name: 'Proof page' })).toBeVisible();
    await snap(tab, 'print-proof');
  });

  for (const size of ['50x25', '100x50'] as const) {
    test(`the QR label, ${size} mm`, async ({ page: tab }) => {
      await show(tab, printPage(`label-${size}`), LABELS[size]);
      await snap(tab, `print-label-${size}`);
    });
  }
});

test.describe('the proof page of a company', () => {
  test.use(signedInAs('executive'));

  test('an Executive prints a proof page and opens it', async ({ page }) => {
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    await dataGrid(page, 'Companies')
      .getByRole('button', { name: 'Print a proof page' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /^Proof page of / })).toBeVisible();
    // No queue on this machine: the worker prints the page in the app before the answer comes.
    await expect(dialog.getByText('The proof page is ready.')).toBeVisible({ timeout: 45_000 });
    await expectNoAxeViolations(page);
    await snap(page, 'proof-dialog');

    // The new tab is sent to the file's signed address; the address itself is fetched here, since
    // a browser without a PDF viewer saves a PDF rather than showing it.
    const signed = page
      .context()
      .waitForEvent('request', (r) => r.url().includes('/api/v1/files/local/'));
    const opened = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Open the proof page' }).click();
    const tab = await opened;
    const pdf = await page.request.get((await signed).url());
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await tab.close();

    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();
    await expect(
      dataGrid(page, 'Companies').getByRole('button', { name: 'Print a proof page' }).first(),
    ).toBeFocused();
  });
});
