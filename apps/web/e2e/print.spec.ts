import type { Page } from '@playwright/test';
import type { PrintImage } from '../src/print/company';
import { spikeCompany, spikeLabels, spikeQuote } from '../src/print/fixtures/spike-documents';
import { renderLabelsHtml, type LabelSize } from '../src/print/label-template';
import { renderLetterheadProof } from '../src/print/letterhead-proof-template';
import { renderQuote } from '../src/print/quote-template';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { solidPng } from './support/png';

/** A4 and the label stocks at 96 pixels to the inch. */
const A4 = { width: 794, height: 1123 };
const LABELS: Record<LabelSize, { width: number; height: number }> = {
  '50x25': { width: 189, height: 95 },
  '100x50': { width: 378, height: 189 },
};

const picture = (width: number, height: number, colour: [number, number, number]): PrintImage => ({
  contentType: 'image/png',
  base64: solidPng(width, height, colour).toString('base64'),
});

/** The spike company with a logo and a letterhead strip, both plain colour. */
const company = spikeCompany({
  logo: picture(160, 160, [94, 106, 210]),
  letterhead: picture(1800, 200, [246, 246, 248]),
});

/** A template's own page, as Chromium prints it: light, at the paper's size, fonts loaded. */
async function show(page: Page, html: string, size: { width: number; height: number }) {
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test.describe('the print templates (ADR 0009), light only', () => {
  test.beforeEach(() => {
    // Printed documents are always light, whatever the screen: one project holds the baselines.
    test.skip(projectName() !== 'desktop-light', 'printed documents are light only');
  });

  test('the quotation, with the selling company’s letterhead, logo and bank account', async ({
    page,
  }) => {
    const { html } = await renderQuote({ ...spikeQuote(1), company });
    await show(page, html, A4);
    await expect(page.getByText(company.legalName).first()).toBeVisible();
    await expect(page.getByText(company.bank?.accountNumber ?? '')).toBeVisible();
    await snap(page, 'print-quote');
  });

  test('the company proof page', async ({ page }) => {
    const { html } = renderLetterheadProof({ company, printedOn: '2026-10-04' });
    await show(page, html, A4);
    await expect(page.getByRole('heading', { name: 'Proof page' })).toBeVisible();
    await snap(page, 'print-proof');
  });

  for (const size of ['50x25', '100x50'] as const) {
    test(`the QR label, ${size} mm`, async ({ page }) => {
      const html = await renderLabelsHtml(spikeLabels(1), size);
      await show(page, html, LABELS[size]);
      await snap(page, `print-label-${size}`);
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

test.describe('a General Manager', () => {
  test.use(signedInAs('gm'));

  test('sees the companies without the bank account form or the proof page', async ({ page }) => {
    await page.goto('/settings/companies');
    await expect(dataGrid(page, 'Companies')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print a proof page' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Bank account' })).toHaveCount(0);
  });
});
