import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { solidPng } from './support/png';
import { SNAPSHOT_LEADS, storageStatePath } from './support/users';

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * A customer of this journey's own: a lead added through the lead form (in `company`, for a
 * person who works in several), then found on the customers list by name and opened. Answers the
 * name and Account 360's address.
 */
async function addCustomer(
  page: Page,
  first: string,
  company = 'Shakti Supreme',
): Promise<{ name: string; url: string }> {
  const name = `${first} ${String(Date.now()).slice(-6)}`;
  await page.goto('/leads/new');
  await page.getByLabel('Customer name').fill(name);
  await page.getByLabel('Mobile number').fill(freshMobile());
  const companies = page.getByLabel('Company', { exact: true });
  if (await companies.isVisible()) await companies.selectOption({ label: company });
  await page.getByLabel('Line of business').selectOption({ index: 1 });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  // The lead form waits for its number check and the journeys' other uploads and leads share the
  // machine, so a save can take several seconds when two projects add leads at once.
  await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });

  await page.goto('/customers');
  await page.getByRole('searchbox', { name: 'Find a customer' }).fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await dataGrid(page, 'Customers').getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  return { name, url: page.url() };
}

const section = (page: Page, title: string) => page.getByRole('region', { name: title });

test.describe('customers as an Executive', () => {
  test.use(signedInAs('executive'));

  test('opens the customers list', async ({ page }) => {
    await page.goto('/customers');
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(dataGrid(page, 'Customers')).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('records a consent with its proof, then withdraws it', async ({ page }) => {
    await addCustomer(page, 'Suresh Choudhary');
    await expectNoAxeViolations(page);
    // An Executive changes the customer's details.
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();

    const consents = section(page, 'Consent');
    await expect(consents.getByText('No consent recorded yet.')).toBeVisible();
    await consents.getByRole('button', { name: 'Record consent' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Record consent' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Version of the consent text').fill('v2');
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Signed consent form.png',
      mimeType: 'image/png',
      buffer: solidPng(320, 200, [230, 230, 220]),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(
      dialog.getByText('Uploaded and checked. It is kept with this consent.'),
    ).toBeVisible({ timeout: 45_000 });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Record consent' }).click();
    await expect(dialog).toBeHidden();
    await expect(consents.getByText('In force')).toBeVisible();
    await expect(consents.getByRole('button', { name: 'Open proof' })).toBeVisible();

    await consents.getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Withdraw this consent' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Withdraw consent' }).click();
    await expect(page.getByText('Consent withdrawn.')).toBeVisible();
    await expect(consents.getByText('Withdrawn', { exact: true })).toBeVisible();
    await expect(consents.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
    const history = section(page, 'History');
    await expect(history.getByText('Consent withdrawn')).toBeVisible();
    await expect(history.getByText('Consent recorded')).toBeVisible();
  });

  test('adds a task and marks it done', async ({ page }) => {
    await addCustomer(page, 'Dinesh Prajapat', 'Shakti Motor Pumps');
    const tasks = section(page, 'Tasks');
    await tasks.getByRole('button', { name: 'Add task' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add a task' })).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('What to do').selectOption({ label: 'Call back' });
    await dialog.getByLabel('Short note').fill('Ask about the borewell depth');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(tasks.getByText('Call back · Ask about the borewell depth')).toBeVisible();
    await tasks.getByRole('button', { name: 'Mark done' }).click();
    await expect(page.getByText('Task marked done.')).toBeVisible();
    await expect(tasks.getByText('No open tasks.')).toBeVisible();
  });

  test('makes tags for the company from the tag dialog', async ({ page }) => {
    await addCustomer(page, 'Kailash Meena');
    await section(page, 'Leads').getByRole('button', { name: 'Add tag' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Add a tag' })).toBeVisible();
    await expect(dialog.getByLabel('Or make a new tag')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('customers as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('opens the customers list, which holds only the customers of their own leads', async ({
    page,
  }) => {
    await page.goto('/customers');
    await expect(page.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    // The snapshot company's customers belong to another company and another caller.
    const first = SNAPSHOT_LEADS[0].name;
    await page.getByRole('searchbox', { name: 'Find a customer' }).fill(first);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByText('No customers match this search. Check the spelling or try fewer letters.'),
    ).toBeVisible();
  });

  test('records consent and adds a task for their own customer, but makes no tags', async ({
    page,
  }) => {
    await addCustomer(page, 'Gopal Gurjar');
    await expectNoAxeViolations(page);
    await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();

    const consents = section(page, 'Consent');
    await consents.getByRole('button', { name: 'Record consent' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Version of the consent text').fill('v2');
    await dialog.getByRole('button', { name: 'Record consent' }).click();
    await expect(dialog).toBeHidden();
    await expect(consents.getByText('In force')).toBeVisible();
    // Recorded without proof, so there is none to open.
    await expect(consents.getByRole('button', { name: 'Open proof' })).toHaveCount(0);

    const tasks = section(page, 'Tasks');
    await tasks.getByRole('button', { name: 'Add task' }).click();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(tasks.getByRole('button', { name: 'Mark done' })).toBeVisible();

    // Tags are made by team leads, GMs and Executives; a caller only puts them on leads.
    await section(page, 'Leads').getByRole('button', { name: 'Add tag' }).click();
    await expect(dialog.getByRole('heading', { name: 'Add a tag' })).toBeVisible();
    await expect(dialog.getByLabel('Or make a new tag')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('sizes a lead from Account 360 and sees it in the history', async ({ page }) => {
    const { name } = await addCustomer(page, 'Bhagirath Jat');
    const leads = section(page, 'Leads');
    await leads.getByRole('button', { name: 'Size this lead' }).click();
    const sizing = section(page, 'Sizing');
    await expect(
      sizing.getByText('Not sized yet. Enter the measurements and work out the size.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    // The tabs move with the arrow keys.
    await sizing.getByRole('tab', { name: 'Pump' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(sizing.getByRole('tab', { name: 'Rooftop solar' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await sizing.getByLabel('Units used a month (kWh)').fill('300');
    await sizing.getByLabel('Shade-free roof area (m²)').fill('40');
    await sizing.getByLabel('Sanctioned load (kW)').fill('5');
    await sizing.getByRole('button', { name: 'Work out size' }).click();
    await expect(page.getByText('Sizing saved.')).toBeVisible();
    await expect(sizing.getByText('Within limits')).toBeVisible();
    await expectNoAxeViolations(page);

    const history = section(page, 'History');
    await expect(history.getByText('Sizing worked out')).toBeVisible();
    await expect(history.getByText('Rooftop solar sizing, within limits')).toBeVisible();
    // The opened panel with its result, once the saved message has gone; the customer's name and
    // number and the dates change from run to run.
    // A toast waits while the pointer is over it, and the button just pressed can sit beneath it.
    await page.mouse.move(0, 0);
    await expect(page.getByText('Sizing saved.')).toBeHidden({ timeout: 15_000 });
    await snap(page, 'customer-sizing', {
      mask: [page.getByText(name), page.getByText(/\d{5}/), page.getByText(/\b20\d\d\b/)],
    });

    await leads.getByRole('button', { name: 'Hide sizing' }).click();
    await expect(sizing).toHaveCount(0);
  });

  test('cannot open a customer someone else looks after', async ({ page, browser }) => {
    // An Executive's customer in the caller's own company.
    const executive = await browser.newContext({ storageState: storageStatePath('executive') });
    const theirs = await addCustomer(await executive.newPage(), 'Ramesh Saini');
    await executive.close();
    await page.goto(theirs.url);
    await expect(page.getByRole('heading', { name: "We couldn't find this screen" })).toBeVisible();
    await expect(page.getByText(theirs.name)).toHaveCount(0);
  });
});

// The screenshots: the snapshot caller's customers, which only the seed writes (users.ts), so
// every run shows the same rows; times and dates are masked.
test.describe('the customers of the snapshot company', () => {
  test.use(signedInAs('snapshotCaller'));

  test('the list and Account 360 show the seeded customers', async ({ page }) => {
    await page.goto('/customers');
    const grid = dataGrid(page, 'Customers');
    for (const lead of SNAPSHOT_LEADS) {
      await expect(grid.getByRole('link', { name: lead.name })).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await snap(page, 'customers-list');

    const first = SNAPSHOT_LEADS[0].name;
    await grid.getByRole('link', { name: first }).click();
    await expect(page.getByRole('heading', { name: first, level: 1 })).toBeVisible();
    await expect(section(page, 'History').getByText('Lead added')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'customer-account', { mask: [page.getByText(/\b20\d\d\b/)] });
  });
});
