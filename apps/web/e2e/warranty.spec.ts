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
import { STOCK_JOURNEY, WARRANTY_JOURNEY, warrantyJourneyOf } from './support/users';

// R3's warranty claims (docs/03-roadmap-appendix/phase3.md §7.5). The seed gives each project a
// customer of company 1 with two delivered serials of a pump (one in warranty, one whose warranty
// ended), the pump's cost in stock, a quarantine bin, and a closed claim with its costs
// (`e2e/setup/warranty.ts`). The Inventory Manager adds the replacement to stock, raises a claim
// from Account 360, is refused the serial whose warranty ended, identifies the one in warranty,
// gives the replacement and takes the faulty one into quarantine, sends it to the supplier and
// closes the claim by the credit, never seeing a cost; and rejects a claim that is not a fault.
// The General Manager opens the closed claim and sees no cost; Accounts sees both.

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

  test('takes a claim from Account 360 through the replacement, the supplier return and the credit, refused a serial out of warranty with its date, and never sees a cost', async ({
    page,
  }) => {
    const j = warrantyJourneyOf(projectName());
    const run = `R${String(Date.now()).slice(-8)}`;
    const replacementNo = `JWR-${run}-${projectName().slice(-2).toUpperCase()}`;
    const [storageBin] = STOCK_JOURNEY.bins;

    // The replacement comes into stock first, as the store finds it.
    await page.goto('/inventory/stock');
    await (await hydrated(page.getByLabel('Item', { exact: true }))).fill(j.sku);
    await page.getByRole('button', { name: 'Show stock' }).click();
    await rowOf(dataGrid(page, 'Stock by hub, bin and item'), j.sku)
      .first()
      .getByRole('link', { name: j.pump })
      .click();
    await (await hydrated(page.getByRole('button', { name: 'Adjust stock' }))).click();
    const adjust = page.getByRole('dialog', { name: `Adjust stock of ${j.pump}` });
    await adjust.getByLabel('Hub').selectOption({ label: STOCK_JOURNEY.hub.name });
    await adjust
      .getByLabel('Bin', { exact: true })
      .selectOption({ label: `${storageBin} (Storage)` });
    await adjust.getByLabel('Change').selectOption({ label: 'Found (add stock)' });
    await adjust.getByLabel('Serial numbers').fill(replacementNo);
    await adjust.getByLabel('Reason').fill(`Replacement stock, walk ${run}`);
    await adjust.getByRole('button', { name: 'Save adjustment' }).click();
    await expect(page.getByText('Stock adjusted.')).toBeVisible();

    await openCustomer(page, j.farm);
    await (await hydrated(page.getByRole('button', { name: 'Raise a warranty claim' }))).click();
    const raise = page.getByRole('dialog', { name: 'Raise a warranty claim' });
    await expect(raise.getByLabel('Site')).toHaveValue(/.+/);
    await snap(page, 'warranty-raise-dialog', { element: raise });
    await raise.getByLabel('Fault reported').fill(`No water since Monday, walk ${run}`);
    await expectNoAxeViolations(page);
    await raise.getByRole('button', { name: 'Raise the claim' }).click();
    await expect(page.getByRole('heading', { name: /^Warranty claim /, level: 1 })).toBeVisible();
    await expect(page.getByText(`No water since Monday, walk ${run}`)).toBeVisible();
    await expectNoAxeViolations(page);

    // The serial whose warranty ended is refused, naming the day it ended.
    await (await hydrated(page.getByRole('button', { name: 'Identify the serial' }))).click();
    const identify = page.getByRole('dialog', { name: 'Identify the faulty serial' });
    const serial = identify.getByLabel('Serial');
    await serial.selectOption({ label: `${j.expiredSerial}, ${j.pump}` });
    await expect(identify.getByText('Warranty until 31-01-2025')).toBeVisible();
    await identify.getByRole('button', { name: 'Identify' }).click();
    await expect(
      identify.getByText(
        'The warranty on this serial ended on 31-01-2025. Reject the claim, or offer a paid repair.',
      ),
    ).toBeVisible();
    await snap(page, 'warranty-identify-dialog', { element: identify });
    await expectNoAxeViolations(page);
    // The one in warranty the seed left for this run.
    const valid = serial.locator('option', { hasText: `${j.validSerial}-` }).first();
    await serial.selectOption((await valid.getAttribute('value')) ?? '');
    await identify.getByRole('button', { name: 'Identify' }).click();
    await expect(page.getByText('Serial identified.')).toBeVisible();

    // The replacement from stock; the faulty pump came back with the engineer.
    await (await hydrated(page.getByRole('button', { name: 'Give a replacement' }))).click();
    const replace = page.getByRole('dialog', { name: 'Give a replacement from stock' });
    await replace
      .getByLabel('From bin')
      .selectOption({ label: `${storageBin}, ${STOCK_JOURNEY.hub.name}` });
    await replace.getByLabel('Serial number of the replacement').fill(replacementNo);
    await replace.getByLabel('The faulty item').selectOption({ label: 'Back with us now' });
    await replace
      .getByLabel('Quarantine bin')
      .selectOption({ label: `${WARRANTY_JOURNEY.quarantineBin}, ${STOCK_JOURNEY.hub.name}` });
    await snap(page, 'warranty-replace-dialog', { element: replace });
    await expectNoAxeViolations(page);
    await replace.getByRole('button', { name: 'Give the replacement' }).click();
    await expect(page.getByText('Replacement given.')).toBeVisible();
    await expect(page.getByRole('link', { name: replacementNo })).toBeVisible();

    // To the supplier with their reference.
    await (await hydrated(page.getByRole('button', { name: 'Send to the supplier' }))).click();
    const rma = page.getByRole('dialog', { name: 'Send the faulty item to the supplier' });
    await rma.getByLabel('Supplier').selectOption({ label: 'Journey pump supplier' });
    // Pictured before the reference, which names the run.
    await snap(page, 'warranty-rma-dialog', { element: rma });
    await rma.getByLabel('Supplier’s return reference').fill(`RMA-${run}`);
    await expectNoAxeViolations(page);
    await rma.getByRole('button', { name: 'Send to the supplier' }).click();
    await expect(page.getByText('Sent to the supplier.')).toBeVisible();

    // The supplier's credit closes it; the Inventory Manager never sees a cost.
    await (await hydrated(page.getByRole('button', { name: 'Record the credit' }))).click();
    const settle = page.getByRole('dialog', { name: 'Record the supplier’s credit' });
    await snap(page, 'warranty-settle-dialog', { element: settle });
    await settle.getByLabel('Credit amount in rupees').fill('12,400.00');
    await expectNoAxeViolations(page);
    await settle.getByRole('button', { name: 'Close the claim' }).click();
    await expect(page.getByText('Claim closed with the credit.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Costs' })).toHaveCount(0);
    await expect(page.getByText(/₹/)).toHaveCount(0);
  });

  test('rejects a claim that is not a fault', async ({ page }) => {
    const j = warrantyJourneyOf(projectName());
    const run = `R${String(Date.now()).slice(-8)}`;
    await openCustomer(page, j.farm);
    await (await hydrated(page.getByRole('button', { name: 'Raise a warranty claim' }))).click();
    const raise = page.getByRole('dialog', { name: 'Raise a warranty claim' });
    await raise.getByLabel('Fault reported').fill(`Pipe cut by a plough, walk ${run}`);
    await raise.getByRole('button', { name: 'Raise the claim' }).click();
    await expect(page.getByRole('heading', { name: /^Warranty claim /, level: 1 })).toBeVisible();
    await (await hydrated(page.getByRole('button', { name: 'Reject the claim' }))).click();
    const reject = page.getByRole('dialog', { name: 'Reject the claim' });
    await reject.getByLabel('Why it is rejected').fill(`Damage, not a fault, walk ${run}`);
    await expectNoAxeViolations(page);
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText('Claim rejected.')).toBeVisible();
    await expect(page.getByText(`Damage, not a fault, walk ${run}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject the claim' })).toHaveCount(0);
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
    // The rows and the counts grow with every walk, so only the page around them is pictured.
    await snap(page, 'warranty-list', {
      mask: [
        dataGrid(page, 'Warranty claims, newest first'),
        page.getByRole('navigation', { name: 'Show claims' }),
      ],
    });
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
