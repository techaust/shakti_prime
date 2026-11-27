import type { Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { QUOTE_JOURNEY_COMPANY, seededUsers } from './support/users';

// J2 customer loans (docs/03-roadmap-appendix/phase4.md §6.2, PRD CRM-08). The seed gives each
// project a dealer of the journeys' company and a fresh draft order of it (`e2e/setup/loans.ts`).
// The journeys' company has no lenders listed, so the loan names its lender by a typed name. Every
// amount and reference is a test value for the journeys alone.

/** A titled part of a page (`<section aria-labelledby>`), by its heading. */
function section(page: Page, name: string) {
  return page.getByRole('region', { name });
}

test.describe("as a General Manager, a customer's loan on an order", () => {
  test.use(signedInAs('journeyManager'));

  test('records the loan, its sanction and its payout, and the dispatch is let go', async ({
    page,
  }) => {
    test.slow();
    const seed = seededUsers().loans.orders[projectName()];
    await page.goto(`/orders/${String(QUOTE_JOURNEY_COMPANY.entityId)}/${seed.orderId}`);
    const loan = section(page, 'Loan');
    await expect(loan.getByText('No loan is recorded for this order.')).toBeVisible();
    await expect(loan.getByText('Dispatch does not wait for a loan')).toBeVisible();
    await expectNoAxeViolations(page);

    // Applied: the dispatch waits for the payout, the default.
    await (await hydrated(loan.getByRole('button', { name: 'Record a loan' }))).click();
    const create = page.getByRole('dialog', { name: 'Record a loan' });
    await create.getByLabel("Lender's name").fill('Marudhara Gramin Bank');
    await create.getByLabel('Amount applied for').fill('1,50,000');
    await create.getByLabel("Lender's reference").fill('MGB/2026/0042');
    await expect(create.getByLabel('Dispatch waits for')).toHaveValue('disbursed');
    await expectNoAxeViolations(page);
    await create.getByRole('button', { name: 'Record loan' }).click();
    await expect(page.getByText('Loan recorded')).toBeVisible();
    await expect(loan.getByText('Dispatch waits for this loan')).toBeVisible();
    await expect(loan.getByText('Applied', { exact: true })).toBeVisible();
    await expect(loan.getByText('Marudhara Gramin Bank')).toBeVisible();
    await expect(loan.getByText('₹1,50,000.00')).toBeVisible();

    // Sanctioned: the dispatch still waits.
    await loan.getByRole('button', { name: 'Record sanction' }).click();
    const sanction = page.getByRole('dialog', { name: 'Record the sanction' });
    await sanction.getByLabel('Sanctioned amount').fill('1,40,000');
    await sanction.getByRole('button', { name: 'Record sanction' }).click();
    await expect(page.getByText('Sanction recorded')).toBeVisible();
    await expect(loan.getByText('Sanctioned', { exact: true })).toBeVisible();
    await expect(loan.getByText('₹1,40,000.00')).toBeVisible();
    await expect(loan.getByText('Dispatch waits for this loan')).toBeVisible();

    // Paid out: the gate answer lets the dispatch go.
    await loan.getByRole('button', { name: 'Record payout' }).click();
    const payout = page.getByRole('dialog', { name: 'Record the payout' });
    await expect(payout.getByLabel("Lender's reference")).toHaveValue('MGB/2026/0042');
    await payout.getByRole('button', { name: 'Record payout' }).click();
    await expect(page.getByText('Payout recorded')).toBeVisible();
    await expect(loan.getByText('Paid out', { exact: true })).toBeVisible();
    await expect(loan.getByText('The loan lets the dispatch go')).toBeVisible();
    await expect(loan.getByRole('button', { name: 'Record a loan' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'order-loan-paid-out', { element: loan });

    // Account 360 lists the loan with its order.
    await page.goto(
      `/customers/${seed.accountId}?company=${String(QUOTE_JOURNEY_COMPANY.entityId)}`,
    );
    const loans = section(page, 'Loans');
    await expect(loans.getByText('Paid out', { exact: true }).first()).toBeVisible();
    await expect(loans.getByText(/Marudhara Gramin Bank · ₹1,40,000\.00/).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as the Executive, Settings › Lenders', () => {
  test.use(signedInAs('executive'));

  test("adds a lender to a company's list and switches it off", async ({ page }) => {
    const name = `Journey lender ${projectName()} ${String(Date.now()).slice(-6)}`;
    await page.goto('/settings/lenders');
    await expect(page.getByRole('heading', { name: 'Lenders', level: 1 })).toBeVisible();
    await (await hydrated(page.getByRole('button', { name: 'Add lender' }))).click();
    const add = page.getByRole('dialog', { name: 'Add a lender' });
    await expect(add.getByLabel("Lender's name")).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'lenders-add', { element: add });
    await add.getByLabel("Lender's name").fill(name);
    await add.getByRole('button', { name: 'Add lender' }).click();
    await expect(page.getByText('Lender added')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: name });
    await expect(row.getByText('In use')).toBeVisible();
    await row.getByRole('button', { name: `Switch off ${name}` }).click();
    await expect(row.getByText('Switched off')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
