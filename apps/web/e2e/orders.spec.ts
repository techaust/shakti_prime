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
import { solidPng } from './support/png';
import {
  QUOTE_JOURNEY_COMPANY,
  SNAPSHOT_COMPANY,
  SNAPSHOT_DEALER,
  seededUsers,
} from './support/users';

// Orders, acceptance and dealer credit (docs/03-roadmap-appendix/phase1.md §8.3). The seed gives each project a
// fresh sized lead and two dealers priced from the journeys' own tier (`e2e/setup/orders.ts`);
// every price, limit and outstanding figure is a test value for the journeys alone. The snapshot
// company's dealer, its terms and its one draft order, made by the seed, give the screenshots.

/** A titled part of a page (`<section aria-labelledby>`), by its heading. */
function section(page: Page, name: string) {
  return page.getByRole('region', { name });
}

/** A day in India, `daysAgo` days before today, as DD-MM-YYYY, as the date fields take it. */
function dmy(daysAgo = 0): string {
  const at = new Date(Date.now() + 330 * 60_000 - daysAgo * 86_400_000);
  const [y, m, d] = at.toISOString().slice(0, 10).split('-');
  return `${d ?? ''}-${m ?? ''}-${y ?? ''}`;
}

test.describe('as an Executive, a signed quote to a confirmed order', () => {
  test.use(signedInAs('executive'));

  test('records the signed copy, which makes the order, confirms it and sees the lead won', async ({
    page,
  }) => {
    // A long journey: the quote is printed in the app before it can be sent and accepted.
    test.setTimeout(240_000);
    const lead = seededUsers().orders.acceptLeads[projectName()];
    await page.goto(
      `/quotes/new?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}&lead=${lead.leadId}`,
    );
    await expect(
      page.getByRole('heading', { name: `Quote for ${lead.name}`, level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel('Item or kit')
      .selectOption({ label: 'Solar module 540 Wp (JRN-MOD-540), ₹12,000.00' });
    await page.getByLabel('Quantity').fill('2');
    await page.getByRole('button', { name: 'Work out the quote' }).click();
    await page.getByRole('button', { name: 'Make the quote' }).click();
    const quoteTitle = page.getByRole('heading', {
      level: 1,
      name: /^SMP\/Q\/\d{4}-\d{2}\/\d{4,}$/,
    });
    await expect(quoteTitle).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('The quote document is ready.')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    await expect(page.getByText('Quote marked as sent.')).toBeVisible();

    // The customer's signed copy accepts the quote and makes its order (SAL-05).
    await page.getByRole('button', { name: 'Record acceptance' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Record acceptance' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Signed quote.png',
      mimeType: 'image/png',
      buffer: solidPng(320, 200, [240, 240, 235]),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(dialog.getByText('The signed copy is ready.')).toBeVisible({ timeout: 45_000 });
    await dialog.getByRole('button', { name: 'Record acceptance' }).click();
    await expect(page.getByText(/^Quote accepted\. Order SMP\/SO\//)).toBeVisible();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: /^SMP\/SO\/\d{4}-\d{2}\/\d{4,}$/ }).click();
    const orderTitle = page.getByRole('heading', {
      level: 1,
      name: /^SMP\/SO\/\d{4}-\d{2}\/\d{4,}$/,
    });
    await expect(orderTitle).toBeVisible({ timeout: 30_000 });
    const orderNo = (await orderTitle.textContent()) ?? '';
    await expect(page.getByText('Not confirmed yet', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    // Confirming checks the credit (a household customer passes) and wins the lead.
    await page.getByRole('button', { name: 'Confirm the order' }).click();
    await expect(page.getByText('Order confirmed.')).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm the order' })).toHaveCount(0);

    await page.getByRole('link', { name: lead.name }).click();
    await expect(page.getByRole('heading', { name: lead.name, level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(section(page, 'Leads').getByText('Won', { exact: true })).toBeVisible();
    await expect(section(page, 'Orders').getByRole('link', { name: orderNo })).toBeVisible();
  });
});

test.describe('as an Executive, a dealer order over its limit', () => {
  test.use(signedInAs('executive'));

  test('is held with the limit named, released with a reason, then confirmed', async ({ page }) => {
    test.setTimeout(120_000);
    const dealer = seededUsers().orders.heldDealers[projectName()];
    await page.goto(
      `/customers/${dealer.accountId}?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}`,
    );
    await expect(page.getByRole('heading', { name: dealer.name, level: 1 })).toBeVisible();
    await section(page, 'Orders').getByRole('link', { name: 'New dealer order' }).click();
    await expect(
      page.getByRole('heading', { name: `Order for ${dealer.name}`, level: 1 }),
    ).toBeVisible();
    await page
      .getByLabel('Item', { exact: true })
      .selectOption({ label: 'Solar module 540 Wp (JRN-MOD-540), ₹12,000.00' });
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Work out the order' }).click();
    // One module at ₹12,000 with 12% GST in the company's own state.
    const preview = section(page, 'The order as it will be made');
    await expect(preview.getByText('₹13,440.00').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Make the order' }).click();

    const title = page.getByRole('heading', { level: 1, name: /^SMP\/SO\/\d{4}-\d{2}\/\d{4,}$/ });
    await expect(title).toBeVisible({ timeout: 30_000 });

    // The credit check holds it and names the limit (SAL-07).
    await page.getByRole('button', { name: 'Confirm the order' }).click();
    await expect(page.getByText('This order is held for credit.')).toBeVisible();
    await expect(page.getByText(/over their credit limit of ₹1,000\.00/)).toBeVisible();
    await expect(page.getByText('Held for credit', { exact: true })).toBeVisible();
    await expectNoAxeViolations(page);

    // Only the Executive releases it, with a reason; the next confirmation then passes once.
    await page.getByRole('button', { name: 'Release the hold' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Release the credit hold' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Why it is released').fill('Paid by cheque at the counter today');
    await dialog.getByRole('button', { name: 'Release the hold' }).click();
    await expect(page.getByText('Credit hold released. Confirm the order now.')).toBeVisible();
    await expect(page.getByText(/Paid by cheque at the counter today/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm the order' }).click();
    await expect(page.getByText('Order confirmed.')).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
  });
});

test.describe('as Accounts, dealer credit', () => {
  test.use(signedInAs('accounts'));

  test('enters a dealer’s credit limit and days, then its outstanding, and reads the history', async ({
    page,
  }) => {
    const dealer = seededUsers().orders.creditDealers[projectName()];
    await page.goto('/dealer-credit');
    await expect(page.getByRole('heading', { name: 'Dealer credit', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await page
      .getByRole('button', { name: `Enter the credit limit and days of ${dealer.name}` })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: `Credit limit and days of ${dealer.name}` }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Credit limit in rupees').fill('50,000');
    await dialog.getByLabel('Credit days').fill('30');
    await dialog.getByRole('button', { name: 'Save the terms' }).click();
    await expect(page.getByText('Credit limit and days saved.')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByRole('button', { name: `Enter the outstanding of ${dealer.name}` }).click();
    await expect(
      dialog.getByRole('heading', { name: `Outstanding of ${dealer.name}` }),
    ).toBeVisible();
    await dialog.getByLabel('Outstanding in rupees').fill('12,500');
    await dialog.getByLabel('As of').fill(dmy());
    await dialog.getByLabel('Oldest unpaid invoice').fill('RCREF/SI/JOURNEY/0001');
    await dialog.getByLabel('Date of that invoice').fill(dmy(40));
    await dialog.getByRole('button', { name: 'Save the outstanding' }).click();
    await expect(page.getByText('Outstanding saved.')).toBeVisible();
    await expect(dialog).toBeHidden();
    const grid = dataGrid(page, 'Dealers');
    await expect(grid.getByText('₹12,500.00').first()).toBeVisible();
    // The invoice is 40 days old today, and the row says so.
    await expect(grid.getByText('RCREF/SI/JOURNEY/0001, 40 days old')).toBeVisible();

    await page.getByRole('button', { name: `Earlier entries of ${dealer.name}` }).click();
    await expect(
      dialog.getByRole('heading', { name: `Earlier entries of ${dealer.name}` }),
    ).toBeVisible();
    await expect(dialog.getByText(/^Limit ₹50,000\.00, 30 days$/).first()).toBeVisible();
    await expect(dialog.getByText(/^₹12,500\.00 as of /).first()).toBeVisible();
    await expect(
      dialog.getByText(/^Oldest unpaid invoice RCREF\/SI\/JOURNEY\/0001, dated /).first(),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('reads the orders list, and cannot open dealer credit', async ({ page }) => {
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/dealer-credit');
    await expect(page.getByRole('heading', { name: "We couldn't find this screen" })).toBeVisible();
  });
});

// The screenshots: the snapshot company's dealer and its one draft order, which only the seed
// makes, so every run shows the same rows; dates and times are masked.
test.describe('the orders of the snapshot company', () => {
  test.use(signedInAs('executive'));

  test('the list, the order, the dealer order form and dealer credit', async ({ page }) => {
    const { orders } = seededUsers();
    await page.goto('/orders');
    await expect(page.getByRole('heading', { name: 'Orders', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    const grid = dataGrid(page, 'Orders');
    await expect(grid.getByRole('link', { name: orders.snapshotOrderNo })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'orders-list');

    await grid.getByRole('link', { name: orders.snapshotOrderNo }).click();
    await expect(page.getByRole('heading', { name: orders.snapshotOrderNo, level: 1 })).toBeVisible(
      { timeout: 30_000 },
    );
    await expect(page.getByRole('link', { name: SNAPSHOT_DEALER })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'order-page');

    await page.goto(
      `/orders/new?company=${String(SNAPSHOT_COMPANY.entityId)}&dealer=${orders.snapshotDealerId}`,
    );
    await expect(
      page.getByRole('heading', { name: `Order for ${SNAPSHOT_DEALER}`, level: 1 }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'order-builder');

    await page.goto(`/dealer-credit?company=${String(SNAPSHOT_COMPANY.entityId)}`);
    await expect(page.getByRole('heading', { name: 'Dealer credit', level: 1 })).toBeVisible();
    await expect(dataGrid(page, 'Dealers').getByText(SNAPSHOT_DEALER)).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'dealer-credit');
  });
});
