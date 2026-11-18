import type { Page } from '@playwright/test';
import {
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
  SNAPSHOT_COMPANY,
  WHATSAPP_QUOTES,
  seededUsers,
} from './support/users';

// WhatsApp quotes (docs/03-roadmap-appendix/phase2.md §7.1). The seed gives the snapshot company,
// which has a WhatsApp number, its quote and order templates mapped to the two customer updates,
// a sized lead per project whose customer writes on WhatsApp and agreed to it, and one quote the
// platform accepted on WhatsApp with a one-time code (`e2e/setup/whatsapp-quotes.ts`). Nothing
// reaches WhatsApp: no number has a send key here, so a queued message waits.

/** A titled part of a page (`<section aria-labelledby>`), by its heading. */
function section(page: Page, name: string) {
  return page.getByRole('region', { name });
}

test.describe('as an Executive, Settings › WhatsApp templates', () => {
  test.use(signedInAs('executive'));

  test('shows the company’s templates and saves the template of each customer update', async ({
    page,
  }) => {
    await page.goto('/settings/whatsapp-templates');
    await expect(page.getByRole('heading', { name: 'WhatsApp templates', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    const company = section(page, SNAPSHOT_COMPANY.name);
    const quoteSent = company.getByLabel('Quote sent');
    await expect(quoteSent).toHaveValue(/.+/);
    await expect(quoteSent.locator('option:checked')).toHaveText(
      WHATSAPP_QUOTES.templates.quote.label,
    );
    await expect(
      company.getByRole('table', { name: `WhatsApp templates of ${SNAPSHOT_COMPANY.name}` }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'whatsapp-templates');

    // Saving the update as it is changes nothing a screenshot shows; it says so.
    await quoteSent
      .locator('xpath=ancestor::form[1]')
      .getByRole('button', { name: 'Save' })
      .click();
    await expect(page.getByText('Quote sent saved.')).toBeVisible();
  });
});

test.describe('as an Executive, a quote sent on WhatsApp', () => {
  test.use(signedInAs('executive'));

  test('makes the quote and sends it on the customer’s WhatsApp chat', async ({ page }) => {
    // The quote is printed by Chromium in the app before it can be sent.
    test.setTimeout(240_000);
    const lead = seededUsers().whatsappQuotes.leads[projectName()];
    // The quote journeys' company, so the quote this journey makes never shows in the snapshot
    // company's lists.
    await page.goto(
      `/customers/${lead.accountId}?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}`,
    );
    await expect(page.getByRole('heading', { name: lead.name, level: 1 })).toBeVisible();
    await section(page, 'Leads').getByRole('link', { name: 'Make a quote' }).click();
    await page
      .getByLabel('Item or kit')
      .selectOption({ label: 'Solar module 540 Wp (JRN-MOD-540), ₹12,000.00' });
    await page.getByLabel('Quantity').fill('5');
    await page.getByRole('button', { name: 'Work out the quote' }).click();
    await page.getByRole('button', { name: 'Make the quote' }).click();
    await expect(page.getByText('The quote document is ready.')).toBeVisible({ timeout: 90_000 });

    await page.getByRole('button', { name: 'Send the quote' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Send this quote' })).toBeVisible();
    const whatsapp = dialog.getByRole('radio', { name: "On WhatsApp, from the company's number" });
    await expect(whatsapp).toBeEnabled({ timeout: 30_000 });
    await expect(dialog.getByText(/gets the quote document with an Accept button/)).toBeVisible();
    await whatsapp.check();
    await expectNoAxeViolations(page);
    // The dialog alone: the page behind it shows the new quote's number, which depends on how many
    // quotes the other journeys made first.
    await snap(page, 'quote-send-dialog', { element: dialog });
    await dialog.getByRole('button', { name: 'Send on WhatsApp' }).click();
    await expect(
      page.getByText('Quote sent. It goes to the customer on WhatsApp in a moment.'),
    ).toBeVisible();
    await expect(page.getByText('Sent', { exact: true })).toBeVisible();
  });
});

test.describe('as an Executive, a quote accepted on WhatsApp', () => {
  test.use(signedInAs('executive'));

  test('shows that it was accepted on WhatsApp with a one-time code, and its order', async ({
    page,
  }) => {
    const { whatsappQuotes } = seededUsers();
    await page.goto(
      `/quotes/${String(SNAPSHOT_COMPANY.entityId)}/${whatsappQuotes.acceptedQuoteId}`,
    );
    await expect(
      page.getByRole('heading', { name: whatsappQuotes.acceptedQuoteNo, level: 1 }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('How it was accepted')).toBeVisible();
    await expect(
      page.getByText('On WhatsApp, with the Accept button and a one-time code'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /\/SO\// })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
