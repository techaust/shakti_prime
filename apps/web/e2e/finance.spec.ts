import type { Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { seededUsers } from './support/users';

// FN1 proformas and payment milestones (docs/03-roadmap-appendix/phase5.md §6.1). The seed gives
// each project two dealers' orders of company 1, confirmed by the journeys' Lead Converter, whose
// payments the platform planned from the standard terms on confirmation (`e2e/setup/finance.ts`).

/** The order's Payments tab, by its heading. */
function paymentsTab(page: Page) {
  return page.getByRole('region', { name: 'Payments', exact: true });
}

/** A table by its caption: the table on wider screens, the list of cards on a phone. */
function rows(page: Page, caption: string) {
  return page
    .getByRole('table', { name: caption })
    .or(page.getByRole('list', { name: caption }))
    .filter({ visible: true });
}

test.describe('as Accounts, an order’s payments and its proforma', () => {
  test.use(signedInAs('accounts'));

  test('sees the payments planned on confirmation and issues a proforma with its PDF', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { entityId, orders } = seededUsers().finance;
    const order = orders[projectName()].accounts;
    await page.goto(`/orders/${String(entityId)}/${order.orderId}`);
    await expect(page.getByRole('heading', { level: 1, name: order.soNo })).toBeVisible();
    const tab = paymentsTab(page);
    await expect(tab).toBeVisible();
    // Planned from the standard terms when the order was confirmed: half now, half before dispatch.
    const payments = rows(page, 'Payments of this order');
    await expect(payments.getByText('Advance')).toBeVisible();
    await expect(payments.getByText('Balance')).toBeVisible();
    await expect(payments.getByText('₹13,945.00')).toBeVisible();
    await expect(payments.getByText('₹13,944.00')).toBeVisible();
    await expect(tab.getByText('Dispatch waits for a payment')).toBeVisible();
    // Only the Executive waives a payment.
    await expect(tab.getByRole('button', { name: /^Waive/ })).toHaveCount(0);

    await tab.getByRole('button', { name: 'Issue proforma' }).click();
    await expect(page.getByText('Proforma issued')).toBeVisible();
    const proformas = rows(page, 'Proformas of this order');
    await expect(proformas.getByText(/^SS\/PI\/\d{4}-\d{2}\/\d{4,}$/)).toBeVisible();
    await expect(tab.getByRole('button', { name: 'Issue proforma' })).toHaveCount(0);
    // The render worker prints it on the company's letterhead; the tab shows it once attached.
    await expect(async () => {
      await page.reload();
      await expect(paymentsTab(page).getByRole('button', { name: 'Open PDF' })).toBeVisible({
        timeout: 2_000,
      });
    }).toPass({ timeout: 90_000 });

    await expectNoAxeViolations(page);
    await snap(page, 'finance-order-payments-accounts', {
      // The proforma's number and the time it was issued change with the run.
      mask: [
        rows(page, 'Proformas of this order').getByText(/^SS\/PI\//),
        rows(page, 'Proformas of this order').locator('time'),
        page.locator('time'),
      ],
    });
  });
});

test.describe('as the Lead Converter, her own order’s payments', () => {
  test.use(signedInAs('converter'));

  test('sees the payments and their state, with no waiver and no proforma to issue', async ({
    page,
  }) => {
    const { entityId, orders } = seededUsers().finance;
    const order = orders[projectName()].converter;
    await page.goto(`/orders/${String(entityId)}/${order.orderId}`);
    await expect(page.getByRole('heading', { level: 1, name: order.soNo })).toBeVisible();
    const tab = paymentsTab(page);
    const payments = rows(page, 'Payments of this order');
    await expect(payments.getByText('Advance')).toBeVisible();
    await expect(payments.getByText('Due', { exact: true })).toBeVisible();
    await expect(payments.getByText('Waiting', { exact: true })).toBeVisible();
    await expect(tab.getByText('No proforma has been issued for this order.')).toBeVisible();
    await expect(tab.getByRole('button', { name: /^Waive/ })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Issue proforma' })).toHaveCount(0);
    await expect(tab.getByRole('button', { name: 'Plan payments' })).toHaveCount(0);

    await expectNoAxeViolations(page);
    await snap(page, 'finance-order-payments-converter', { mask: [page.locator('time')] });
  });
});

test.describe('as an Executive, Settings › Payment terms', () => {
  test.use(signedInAs('executive'));

  test('shows the standard terms of a kind of order and publishes a new version', async ({
    page,
  }) => {
    await page.goto('/settings/payment-terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Payment terms' })).toBeVisible();
    // RCREF's commercial projects: a company and a kind of order no other journey changes.
    await page.getByLabel('Company', { exact: true }).selectOption({ label: 'RCREF' });
    await page
      .getByLabel('Kind of order', { exact: true })
      .selectOption({ label: 'Commercial solar projects' });
    await expect(rows(page, 'Payments of these terms').getByText('Advance')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'finance-payment-terms', {
      mask: [page.getByRole('region', { name: 'Current terms', exact: true }).locator('p.text-sm')],
    });

    await page.getByRole('button', { name: 'Change terms' }).click();
    const dialog = page.getByRole('dialog');
    // From whatever the current version holds, down to its first payment.
    await expect(dialog.getByLabel('Payment name').first()).toBeVisible();
    const remove = dialog.getByRole('button', { name: /^Remove payment/ });
    // Each payment has a Remove button while there are two or more.
    for (let rows = await remove.count(); rows > 1; rows -= 1) {
      await remove.last().click();
      await expect(remove).toHaveCount(rows - 1 > 1 ? rows - 1 : 0);
    }
    await dialog.getByLabel('Payment name').fill('Advance');
    await dialog.getByLabel('Kind').selectOption({ label: 'Percentage' });
    await dialog.getByLabel('Percentage or amount').fill('60');
    await dialog.getByRole('button', { name: 'Add payment' }).click();
    // 60 + nothing yet: the total is said before it is sent.
    await expect(
      dialog.getByText('The percentages add up to 60 %. They must add up to 100 %.'),
    ).toBeVisible();
    await dialog.getByLabel('Payment name').last().fill('After installation');
    await dialog.getByLabel('Percentage or amount').last().fill('40');
    await dialog.getByLabel('When it is due').last().selectOption({ label: 'On installation' });
    await expect(dialog.getByText('The percentages add up to 100 %.')).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Publish version' }).click();
    await expect(page.getByText('Payment terms published')).toBeVisible();
    await expect(
      rows(page, 'Payments of these terms').first().getByText('After installation'),
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Current terms', exact: true })
        .getByText(/^Version \d+, published/),
    ).toBeVisible();
  });
});
