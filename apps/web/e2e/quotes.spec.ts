import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import {
  QUOTE_JOURNEY_COMPANY,
  QUOTE_TIER,
  SNAPSHOT_COMPANY,
  SNAPSHOT_QUOTE_LEAD,
  seededUsers,
} from './support/users';

// Quotes (docs/03-roadmap-appendix/phase1.md §7.3). The seed makes a price tier of its own with two items and
// a price list of it in the journeys' company and the snapshot company, test values for the
// journeys alone (`e2e/setup/quotes.ts`): a sized lead per project goes to a sent quote with its
// document here, and the snapshot company's one quote, made by the seed, gives the screenshots.

/** A titled part of a page (`<section aria-labelledby>`), by its heading. */
function section(page: Page, name: string) {
  return page.getByRole('region', { name });
}

test.describe('as an Executive, a sized lead to a sent quote', () => {
  test.use(signedInAs('executive'));

  test('sets the customer’s price tier, makes the quote, prints it, sends it, finds it, re-quotes and withdraws it', async ({
    page,
  }) => {
    // A long journey: the quote is printed by Chromium in the app before it can be sent.
    test.setTimeout(240_000);
    const lead = seededUsers().quotes.journeyLeads[projectName()];
    await page.goto(
      `/customers/${lead.accountId}?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}`,
    );
    await expect(page.getByRole('heading', { name: lead.name, level: 1 })).toBeVisible();

    // The customer has no price tier: an Executive gives it one (PRICE-1).
    await page.getByRole('button', { name: 'Set price tier' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Price tier' })).toBeVisible();
    await dialog.getByLabel('Price tier').selectOption({ label: QUOTE_TIER });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save the tier' }).click();
    await expect(page.getByText('Price tier saved.')).toBeVisible();
    await expect(page.getByText(QUOTE_TIER, { exact: true })).toBeVisible();

    // The lead was sized by the seed; its quote is priced from the tier's list.
    await section(page, 'Leads').getByRole('link', { name: 'Make a quote' }).click();
    await expect(
      page.getByRole('heading', { name: `Quote for ${lead.name}`, level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel('Item or kit')
      .selectOption({ label: 'Solar module 540 Wp (JRN-MOD-540), ₹12,000.00' });
    await page.getByLabel('Quantity').fill('5');
    await page.getByRole('button', { name: 'Work out the quote' }).click();
    const preview = section(page, 'The quote as it will be made');
    // Five modules at ₹12,000 with 12% GST in the company's own state: CGST and SGST of ₹3,600.
    await expect(preview.getByText('₹67,200.00').first()).toBeVisible();
    await expect(preview.getByText('CGST')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Make the quote' }).click();

    const title = page.getByRole('heading', { level: 1, name: /^SMP\/Q\/\d{4}-\d{2}\/\d{4,}$/ });
    await expect(title).toBeVisible({ timeout: 60_000 });
    const quoteNo = (await title.textContent()) ?? '';
    await expect(page.getByText('Not sent yet', { exact: true })).toBeVisible();
    // No queue on this machine: the worker prints the quote in the app after it is made.
    await expect(page.getByText('The quote document is ready.')).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);

    // The document opens through a short-lived address; it is fetched here, since a browser
    // without a PDF viewer saves a PDF rather than showing it.
    const signed = page
      .context()
      .waitForEvent('request', (r) => r.url().includes('/api/v1/files/local/'));
    const opened = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Open the document' }).click();
    const tab = await opened;
    const pdf = await page.request.get((await signed).url());
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toBe('application/pdf');
    expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await tab.close();

    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.getByText('Quote marked as sent.')).toBeVisible();
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark as sent' })).toHaveCount(0);

    // ⌘K finds the quote by its number (RPT-03).
    await page
      .getByRole('button', { name: /^Search or go to/ })
      .first()
      .click();
    const palette = page.getByRole('dialog');
    await palette.getByRole('combobox').fill(quoteNo);
    await expect(palette.getByText(quoteNo).first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');

    // A re-quote makes a new quote of the same items at today's prices and keeps the old one.
    await page.getByRole('button', { name: 'Re-quote' }).click();
    await expect(title).not.toHaveText(quoteNo, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: quoteNo })).toBeVisible();

    // The new quote is withdrawn, with the reason.
    await page.getByRole('button', { name: 'Withdraw' }).click();
    await expect(dialog.getByRole('heading', { name: 'Withdraw this quote' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Why it is withdrawn').fill('The customer chose a smaller system');
    await dialog.getByRole('button', { name: 'Withdraw the quote' }).click();
    await expect(page.getByText('Quote withdrawn.')).toBeVisible();
    await expect(page.getByText('Withdrawn', { exact: true })).toBeVisible();
    await expect(page.getByText('The customer chose a smaller system')).toBeVisible();
  });
});

test.describe('as an Executive, the board', () => {
  test.use(signedInAs('executive'));

  test('shows each card’s sized kWp and how long the lead has been in its stage', async ({
    page,
  }) => {
    await page.goto(
      `/leads/board?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}&pipeline=residential_rooftop`,
    );
    await expect(page.getByText(/\d kWp · In this stage/).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

// The screenshots: the snapshot company's one quote, which only the seed makes, so every run
// shows the same rows; dates and times are masked.
test.describe('the quotes of the snapshot company', () => {
  test.use(signedInAs('executive'));

  test('the list, the quote and the builder', async ({ page }) => {
    // The seed's quote may still be printing when the list opens.
    test.setTimeout(180_000);
    const { quotes } = seededUsers();
    await page.goto('/quotes');
    await expect(page.getByRole('heading', { name: 'Quotes', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    const grid = dataGrid(page, 'Quotes');
    await expect(grid.getByRole('link', { name: quotes.snapshotQuoteNo })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'quotes-list');

    await grid.getByRole('link', { name: quotes.snapshotQuoteNo }).click();
    await expect(page.getByRole('heading', { name: quotes.snapshotQuoteNo, level: 1 })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(page.getByRole('link', { name: SNAPSHOT_QUOTE_LEAD.name })).toBeVisible();
    await expect(page.getByText('The quote document is ready.')).toBeVisible({ timeout: 60_000 });
    await expectNoAxeViolations(page);
    await snap(page, 'quote-page');

    await page.goto(
      `/quotes/new?company=${String(SNAPSHOT_COMPANY.entityId)}&lead=${quotes.snapshotLeadId}`,
    );
    await expect(
      page.getByRole('heading', { name: `Quote for ${SNAPSHOT_QUOTE_LEAD.name}`, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText(QUOTE_TIER, { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'quote-builder');
  });

  test('Account 360 lists the customer’s quotes', async ({ page }) => {
    const { quotes } = seededUsers();
    await page.goto(`/quotes/${String(SNAPSHOT_COMPANY.entityId)}/${quotes.snapshotQuoteId}`);
    await page.getByRole('link', { name: SNAPSHOT_QUOTE_LEAD.name }).click();
    await expect(
      page.getByRole('heading', { name: SNAPSHOT_QUOTE_LEAD.name, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    const list = section(page, 'Quotes');
    await expect(list.getByRole('link', { name: quotes.snapshotQuoteNo })).toBeVisible();
    await expect(page.getByText(QUOTE_TIER, { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('reads the quotes of their own leads, and cannot open the quote builder', async ({
    page,
  }) => {
    // Quotes are read with their leads; making one takes the quote permission a caller lacks.
    await page.goto('/quotes');
    await expect(page.getByRole('heading', { name: 'Quotes', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    const { quotes } = seededUsers();
    await page.goto(
      `/quotes/new?company=${String(SNAPSHOT_COMPANY.entityId)}&lead=${quotes.snapshotLeadId}`,
    );
    await expect(page.getByRole('heading', { name: "We couldn't find this screen" })).toBeVisible();
  });
});
