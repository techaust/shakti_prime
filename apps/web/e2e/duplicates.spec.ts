import type { Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SNAPSHOT_COMPANY } from './support/users';

// Duplicates (CRM-03, docs/design/phase1.md §7.4): a customer typed in twice is found by the lead
// form and shown on /duplicates, merged and the merge undone from the kept customer's page; a
// repeat enquiry for the same line of business within 30 days goes to the open lead.

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

async function addLead(
  page: Page,
  lead: { name: string; mobile: string; line: string },
): Promise<void> {
  await page.goto('/leads/new');
  await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
  await page.getByLabel('Customer name').fill(lead.name);
  await page.getByLabel('Mobile number').fill(lead.mobile);
  // A person in more than one company chooses it first; its lines of business follow.
  const company = page.getByLabel('Company', { exact: true });
  if (await company.isVisible()) await company.selectOption({ label: 'Shakti Supreme' });
  await page.getByLabel('Line of business').selectOption({ label: lead.line });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
}

test.describe('duplicates as a sales team lead', () => {
  test.use(signedInAs('teamLead'));

  test('finds a customer typed in twice, merges the two and undoes the merge', async ({ page }) => {
    // Three lead forms, a merge, an undo and three accessibility checks: a long journey.
    test.slow();
    const name = `Kishan Lal ${String(Date.now()).slice(-6)}`;
    const mobile = freshMobile();
    await addLead(page, { name, mobile, line: 'Farmer Pumps' });
    // The first save of a journey may wait on a server that has just started.
    await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });

    // The same person asks about a rooftop: a second customer, put forward as a duplicate.
    await addLead(page, { name, mobile, line: 'Residential Rooftop' });
    await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible();

    // Asked again about pumps within 30 days: the enquiry goes to the open pumps lead.
    await addLead(page, { name, mobile, line: 'Farmer Pumps' });
    await expect(
      page.getByText(`${name} already has an open lead for this. The enquiry was added to it.`),
    ).toBeVisible();

    await page.goto('/duplicates');
    await expect(
      page.getByRole('heading', { name: 'Possible duplicates', level: 1 }),
    ).toBeVisible();
    const card = page.getByRole('article').filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('95% match')).toBeVisible();
    await expect(card.getByText('Same phone number')).toBeVisible();
    await expectNoAxeViolations(page);
    const kept = await card.getByRole('link', { name }).first().getAttribute('href');
    expect(kept).not.toBeNull();

    await card.getByRole('button', { name: 'Merge', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge customers' });
    await expect(dialog).toBeVisible();
    // What moves is counted before anyone confirms: the other customer's one lead.
    await expect(dialog.getByText('History entries')).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    await dialog.getByRole('button', { name: 'Merge customers' }).click();
    await expect(page.getByText('Customers merged.')).toBeVisible();
    await expect(card).toHaveCount(0);

    // The kept customer shows the merge, with the button that undoes it.
    await page.goto(kept ?? '/customers');
    const merges = page.getByRole('region', { name: 'Merged into this customer' });
    await expect(merges.getByText(`${name} was merged into this customer on`)).toBeVisible();
    await expectNoAxeViolations(page);
    await merges.getByRole('button', { name: 'Undo merge' }).click();
    await expect(
      page.getByText('Merge undone. Both customers are back as they were.'),
    ).toBeVisible();
    await expect(merges).toHaveCount(0);
    // The card is open again, on both customers' pages and on /duplicates.
    await expect(page.getByRole('article').filter({ hasText: name })).toHaveCount(1);
  });
});

// The screenshot: the snapshot company, where only the seed writes and no pair is ever found, so
// the screen shows the same every run.
test.describe('the duplicates of the snapshot company', () => {
  test.use(signedInAs('executive'));

  test('show none', async ({ page }) => {
    await page.goto('/duplicates');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await expect(page.getByText('No possible duplicates right now.')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'duplicates');
  });
});
