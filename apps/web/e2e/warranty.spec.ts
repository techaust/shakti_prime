import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  rowOf,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { WARRANTY_JOURNEY, warrantyJourneyOf } from './support/users';

// R3's warranty claims (docs/03-roadmap-appendix/phase3.md §7.5). The seed gives each project a
// customer of company 1 with two delivered serials of a pump, a claim already with the supplier
// and a closed claim with its costs (`e2e/setup/warranty.ts`). The Inventory Manager raises a
// claim from Account 360, is refused the serial whose warranty ended, identifies the one in
// warranty and rejects the claim, which frees the serial for the next run; and closes the claim
// with the supplier by its credit. The General Manager opens the closed claim and sees no cost;
// Accounts sees both. The replacement from stock and the supplier return wait for the ledger's
// reason registry (X4) and are added to these journeys with them.

async function openCustomer(page: Page, name: string): Promise<void> {
  await page.goto('/customers');
  await hydrated(page.getByRole('searchbox', { name: 'Find a customer' }));
  await page.getByRole('searchbox', { name: 'Find a customer' }).fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await dataGrid(page, 'Customers').getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

async function openClaim(page: Page, claimNo: string | RegExp): Promise<void> {
  await page.goto(`/inventory/warranty?company=${String(WARRANTY_JOURNEY.entityId)}`);
  await expect(page.getByRole('heading', { name: 'Warranty claims', level: 1 })).toBeVisible();
  await dataGrid(page, 'Warranty claims, newest first')
    .getByRole('link', { name: claimNo })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /^Warranty claim /, level: 1 })).toBeVisible();
}

test.describe('as the Inventory Manager, warranty claims', () => {
  test.use(signedInAs('inventoryManager'));

  test('raises a claim from Account 360, is refused a serial out of warranty with its date, identifies one in warranty and rejects the claim', async ({
    page,
  }) => {
    const j = warrantyJourneyOf(projectName());
    const run = `R${String(Date.now()).slice(-8)}`;
    await openCustomer(page, j.farm);

    await (await hydrated(page.getByRole('button', { name: 'Raise a warranty claim' }))).click();
    const raise = page.getByRole('dialog', { name: 'Raise a warranty claim' });
    await expect(raise.getByLabel('Site')).toHaveValue(/.+/);
    await snap(page, 'warranty-raise-dialog', { element: raise });
    await raise.getByLabel('Fault reported').fill(`No water since Monday, walk ${run}`);
    await expectNoAxeViolations(page);
    await raise.getByRole('button', { name: 'Raise the claim' }).click();
    await expect(page.getByRole('heading', { name: /^Warranty claim /, level: 1 })).toBeVisible();
    await expect(page.getByText('Raised', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`No water since Monday, walk ${run}`)).toBeVisible();
    await expectNoAxeViolations(page);

    // The serial whose warranty ended is refused, naming the day it ended.
    await (await hydrated(page.getByRole('button', { name: 'Identify the serial' }))).click();
    const identify = page.getByRole('dialog', { name: 'Identify the faulty serial' });
    await identify.getByLabel('Serial').selectOption({ label: `${j.expiredSerial}, ${j.pump}` });
    await expect(identify.getByText('Warranty until 31-01-2025')).toBeVisible();
    await identify.getByRole('button', { name: 'Identify' }).click();
    await expect(
      identify.getByText(
        'The warranty on this serial ended on 31-01-2025. Reject the claim, or offer a paid repair.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    // The one in warranty is identified.
    await identify.getByLabel('Serial').selectOption({ label: `${j.validSerial}, ${j.pump}` });
    await snap(page, 'warranty-identify-dialog', { element: identify });
    await identify.getByRole('button', { name: 'Identify' }).click();
    await expect(page.getByText('Serial identified.')).toBeVisible();
    await expect(page.getByRole('link', { name: j.validSerial })).toBeVisible();

    // Not a fault after all: rejected with why, which frees the serial for the next claim.
    await page.getByRole('button', { name: 'Reject the claim' }).click();
    const reject = page.getByRole('dialog', { name: 'Reject the claim' });
    await reject.getByLabel('Why it is rejected').fill(`Dry run of the borewell, walk ${run}`);
    await expectNoAxeViolations(page);
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Claim rejected.')).toBeVisible();
    await expect(page.getByText(`Dry run of the borewell, walk ${run}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject the claim' })).toHaveCount(0);
  });

  test('closes the claim with the supplier by its credit, and never sees the amount again', async ({
    page,
  }) => {
    await page.goto(
      `/inventory/warranty?company=${String(WARRANTY_JOURNEY.entityId)}&state=rma_raised`,
    );
    const list = dataGrid(page, 'Warranty claims, newest first');
    const j = warrantyJourneyOf(projectName());
    await rowOf(list, j.farm).first().getByRole('link').first().click();
    await expect(page.getByText('With the supplier', { exact: true }).first()).toBeVisible();
    await expectNoAxeViolations(page);

    await (await hydrated(page.getByRole('button', { name: 'Record the credit' }))).click();
    const settle = page.getByRole('dialog', { name: 'Record the supplier’s credit' });
    await snap(page, 'warranty-settle-dialog', { element: settle });
    await settle.getByLabel('Credit amount in rupees').fill('12,400.00');
    await expectNoAxeViolations(page);
    await settle.getByRole('button', { name: 'Close the claim' }).click();
    await expect(page.getByText('Claim closed with the credit.')).toBeVisible();
    await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();
    // The Inventory Manager holds no finance.cost.read: no cost on the sheet.
    await expect(page.getByRole('heading', { name: 'Costs' })).toHaveCount(0);
    await expect(page.getByText('₹12,400.00')).toHaveCount(0);
  });

  test('lists the claims by state', async ({ page }) => {
    await page.goto(`/inventory/warranty?company=${String(WARRANTY_JOURNEY.entityId)}`);
    await expect(page.getByRole('heading', { name: 'Warranty claims', level: 1 })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Show claims' })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Show claims' })
      .getByRole('link', { name: /^Closed \(/ })
      .click();
    await expect(
      rowOf(
        dataGrid(page, 'Warranty claims, newest first'),
        warrantyJourneyOf(projectName()).closedClaimNo,
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as the General Manager, a warranty claim', () => {
  test.use(signedInAs('gm'));

  test('shows the closed claim with no cost and no step to take', async ({ page }) => {
    const j = warrantyJourneyOf(projectName());
    await openClaim(page, j.closedClaimNo);
    await expect(page.getByText('Credit from the supplier')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Costs' })).toHaveCount(0);
    await expect(page.getByText(/₹/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Identify|Reject|Record/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'warranty-claim-closed-gm');
  });
});

test.describe('as Accounts, a warranty claim', () => {
  test.use(signedInAs('accounts'));

  test('shows the closed claim with its costs', async ({ page }) => {
    const j = warrantyJourneyOf(projectName());
    await openClaim(page, j.closedClaimNo);
    const costs = page.getByRole('region', { name: 'Costs' });
    await expect(costs).toContainText('₹18,500.00');
    await expect(costs).toContainText('₹16,250.50');
    await expectNoAxeViolations(page);
  });
});
