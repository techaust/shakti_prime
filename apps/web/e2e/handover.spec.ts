import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  test,
} from './support/fixtures';
import { storageStatePath } from './support/users';

// The handover of qualified leads (PRD TEL-02, docs/03-roadmap-appendix/phase1.md §8.2): a tele-caller
// qualifies a lead and the present Lead Converter gets it, with her callback and the customer; with
// no converter in the company it reaches the Sales Team Lead's Agent Inbox; a team lead sets who
// takes leads; a person switches their own presence; and a leaving caller's leads move at once.
// Without a queue the app hands the lead over in its own process right after the stage is saved.

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** A lead of this journey's own, added through the lead form; answers the customer's name. */
async function addLead(page: Page, first: string, company?: string): Promise<string> {
  const name = `${first} ${String(Date.now()).slice(-6)}`;
  await page.goto('/leads/new');
  await page.getByLabel('Customer name').fill(name);
  await page.getByLabel('Mobile number').fill(freshMobile());
  const companies = page.getByLabel('Company', { exact: true });
  if (company !== undefined && (await companies.isVisible())) {
    await companies.selectOption({ label: company });
  }
  await page.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });
  return name;
}

/** Opens the customer's page from the customers list. */
async function openCustomer(page: Page, name: string): Promise<void> {
  await page.goto('/customers');
  await page.getByRole('searchbox', { name: 'Find a customer' }).fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await dataGrid(page, 'Customers').getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

/** Moves the lead to Qualified from the board, which asks for the handover. */
async function qualify(page: Page, name: string): Promise<void> {
  await page.goto('/leads/board?pipeline=farmer_pumps');
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  const dialog = page.getByRole('dialog', { name: `Move ${name}` });
  await dialog.getByLabel('Stage').selectOption({ label: 'Qualified' });
  await dialog.getByRole('button', { name: 'Move lead' }).click();
  await expect(page.getByText(`${name} moved to Qualified.`)).toBeVisible({ timeout: 30_000 });
}

test.describe('a lead a tele-caller qualifies', () => {
  test.use(signedInAs('teleCaller'));

  test('goes to the present Lead Converter with her callback and the customer', async ({
    page,
    browser,
  }) => {
    test.slow();
    const name = await addLead(page, 'Hari Om Gurjar');
    await openCustomer(page, name);
    const tasks = page.getByRole('region', { name: 'Tasks' });
    await tasks.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('What to do').selectOption({ label: 'Call back' });
    await dialog.getByLabel('Short note').fill('Ask about the borewell depth');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(tasks.getByText('Call back · Ask about the borewell depth')).toBeVisible();
    const customerUrl = page.url();

    await qualify(page, name);

    // The converter's bell counts the lead, and the notice opens the customer, who is now hers.
    const context = await browser.newContext({ storageState: storageStatePath('converter') });
    const converter = await context.newPage();
    await converter.goto('/home');
    const bell = converter.getByRole('button', {
      name: /^Notifications, (\d+|100 or more) unread$/,
    });
    await expect(async () => {
      await converter.reload();
      await expect(bell).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await bell.click();
    const centre = converter.getByRole('dialog', { name: 'Notifications' });
    const notice = centre.getByRole('listitem').filter({ hasText: name }).first();
    await expect(notice.getByRole('link', { name: 'A lead was given to you' })).toBeVisible();
    await expectNoAxeViolations(converter, { include: '[role="dialog"]' });
    await notice.getByRole('link', { name: 'A lead was given to you' }).click();
    await expect(converter.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(converter.getByText('Looked after by Kishan Verma')).toBeVisible();
    const converterTasks = converter.getByRole('region', { name: 'Tasks' });
    await expect(
      converterTasks.getByText('Call back · Ask about the borewell depth'),
    ).toBeVisible();
    expect(converter.url()).toBe(customerUrl);
    await context.close();
  });

  test('switches her own presence on her profile', async ({ page }) => {
    await page.goto('/settings/profile');
    await expect(page.getByRole('heading', { name: 'Taking new leads', level: 2 })).toBeVisible();
    const present = page.getByLabel('I am present in Shakti Supreme');
    await present.check();
    await expect(page.getByText('You are present in Shakti Supreme.')).toBeVisible();
    await expect(present).toBeChecked();
    await expectNoAxeViolations(page);
    await present.uncheck();
    await expect(page.getByText('You are away in Shakti Supreme.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('I am present in Shakti Supreme')).not.toBeChecked();
  });
});

test.describe('a qualified lead with no Lead Converter in its company', () => {
  test.use(signedInAs('executive'));

  test('reaches the Sales Team Lead through the Agent Inbox', async ({ page, browser }) => {
    test.slow();
    const name = await addLead(page, 'Mangilal Prajapat', 'Shakti Motor Pumps');
    await qualify(page, name);

    const context = await browser.newContext({ storageState: storageStatePath('teamLead') });
    const lead = await context.newPage();
    await lead.goto('/inbox');
    await expect(async () => {
      await lead.reload();
      await expect(lead.getByRole('heading', { name: `${name} is ready for a quote` })).toBeVisible(
        {
          timeout: 2_000,
        },
      );
    }).toPass({ timeout: 30_000 });
    const card = lead.getByRole('listitem').filter({ hasText: name });
    await expect(card.getByText('Qualified lead with no Lead Converter free')).toBeVisible();
    await expectNoAxeViolations(lead);
    await card.getByRole('button', { name: 'Done' }).click();
    await expect(card).toHaveCount(0);
    await context.close();
  });
});

test.describe('lead converters as a team lead', () => {
  test.use(signedInAs('teamLead'));

  test('lists the people who work on leads and sets how many one takes', async ({ page }) => {
    await page.goto('/converters');
    await expect(page.getByRole('heading', { name: 'Lead converters', level: 1 })).toBeVisible();
    const table = dataGrid(page, 'People who work on leads and their part in the handover');
    // A row of the table, or a card of the list on a phone.
    const row = table.locator('tr, li').filter({ hasText: 'Kishan Verma' }).first();
    await expect(row).toBeVisible();
    await expect(row.getByText('Present')).toBeVisible();
    await expectNoAxeViolations(page);

    await row.getByRole('button', { name: 'Edit settings for Kishan Verma' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings for Kishan Verma' });
    await expect(dialog.getByLabel('Takes qualified leads')).toBeChecked();
    await dialog.getByLabel('Most open leads').fill('500');
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Settings for Kishan Verma are saved.')).toBeVisible();
    await expect(row.getByText('500')).toBeVisible();
  });
});

test.describe('a leaving caller', () => {
  test.use(signedInAs('executive'));

  test('has all their leads moved to one person at once', async ({ page }) => {
    test.slow();
    const leaver = `E2E leaver ${projectName()}`;
    await page.goto('/admin/users');
    await page.getByRole('button', { name: `Actions for ${leaver}` }).click();
    await page.getByRole('menuitem', { name: 'Move all leads' }).click();
    const dialog = page.getByRole('dialog', { name: `Move all leads from ${leaver}` });
    await dialog.getByLabel('Give the leads to').selectOption({ label: 'Kishan Verma' });
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    await dialog.getByRole('button', { name: 'Move leads' }).click();
    await expect(page.getByText(`2 leads moved from ${leaver}.`)).toBeVisible({ timeout: 30_000 });

    // Nothing is left with them: a second run finds no lead to move.
    await page.getByRole('button', { name: `Actions for ${leaver}` }).click();
    await page.getByRole('menuitem', { name: 'Move all leads' }).click();
    const again = page.getByRole('dialog', { name: `Move all leads from ${leaver}` });
    await again.getByLabel('Give the leads to').selectOption({ label: 'Kishan Verma' });
    await again.getByRole('button', { name: 'Move leads' }).click();
    await expect(page.getByText(`${leaver} had no leads to move.`)).toBeVisible();
  });
});
