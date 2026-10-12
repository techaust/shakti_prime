import type { Browser, Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  test,
} from './support/fixtures';
import { insideCallingHours, setServerClock } from './support/clock';
import {
  QUOTE_JOURNEY_COMPANY,
  seededUsers,
  storageStatePath,
  type SignedInRole,
} from './support/users';

// The role journeys of the UAT packs (docs/13-client-packs/uat, docs/03-roadmap-appendix/phase1.md
// §10): each crosses the screens one role works on, and hands over to the next role where the
// business does. Every journey makes its own customers and leads through the screens; the dealer
// credit journey's dealer is the seed's (`e2e/setup/uat.ts`). Run against staging they need the
// same signed-in people (users.ts) and the seed's dealers and journey prices.

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** A name of this run's own. */
const fresh = (first: string) => `${first} ${String(Date.now()).slice(-6)}`;

/** Another person's page in the same browser, signed in as that role. */
async function asRole(browser: Browser, role: SignedInRole): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return context.newPage();
}

/** Presses a workspace key until it takes: before the page hydrates a key does nothing. */
async function press(page: Page, key: string, until: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.locator('body').press(key);
    await until();
  }).toPass();
}

/** Opens a lead in the calling or converting workspace from the keyboard by its name. */
async function openLead(page: Page, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: /Find a lead/ });
  await press(page, '/', async () => {
    await expect(search).toBeFocused({ timeout: 1_000 });
  });
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
  await expect(hit).toContainText(name);
  await hit.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name, level: 2 })).toBeFocused();
}

/** Finds a customer on Customers and opens their page. */
async function openCustomer(page: Page, name: string): Promise<void> {
  await page.goto('/customers');
  await page.getByRole('searchbox', { name: 'Find a customer' }).fill(name);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await dataGrid(page, 'Customers').getByRole('link', { name }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test.describe('UAT: a Cold Caller qualifies a lead and the Lead Converter takes it on', () => {
  test.use(signedInAs('teleCaller'));

  test('new lead, a call that qualifies it, and the lead on the converter’s board', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000);
    await setServerClock(context, insideCallingHours());
    const name = fresh('Bhanwar Lal Jat');

    // Home, then the lead form.
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/leads/new');
    await page.getByLabel('Customer name').fill(name);
    await page.getByLabel('Mobile number').fill(freshMobile());
    await page.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
    await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });

    // Calling: the number, then 8, Qualified.
    await page.goto('/calling');
    await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();
    await openLead(page, name);
    await page.keyboard.press('d');
    await expect(page.getByText('Number to dial')).toBeVisible();
    await expectNoAxeViolations(page);
    await page.keyboard.press('8');
    await expect(page.getByText('Call saved. The lead moved to Qualified.').first()).toBeVisible();
    // A Cold Caller makes no quotes: there is no Converting screen in her menu.
    await expect(page.getByRole('link', { name: 'Converting' })).toHaveCount(0);

    // The present Lead Converter of company 1 is given the lead; it is on her board, needing a
    // sizing before a quote.
    const converter = await asRole(browser, 'converter');
    await setServerClock(converter.context(), insideCallingHours());
    await expect(async () => {
      await converter.goto('/converting');
      await expect(converter.getByRole('heading', { name: 'Converting', level: 1 })).toBeVisible();
      await openLead(converter, name);
    }).toPass({ timeout: 90_000 });
    await expect(converter.getByRole('tab', { name: 'Calls', selected: true })).toBeVisible();
    await expect(
      converter.getByRole('listitem').filter({ hasText: name }).filter({
        hasText: 'Sizing needed before a quote',
      }),
    ).not.toHaveCount(0);
    await expectNoAxeViolations(converter);
    await converter.context().close();
  });
});

test.describe('UAT: a Store Manager serves a walk-in customer', () => {
  test.use(signedInAs('storeManager'));

  test('walk-in, the customer’s page with a note, and the lead in the converting workspace', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = fresh('Kamla Devi Kumawat');
    await page.goto('/leads/walk-in');
    await expect(page.getByRole('heading', { name: 'Walk-in customer', level: 1 })).toBeVisible();
    await page.getByLabel('Customer name').fill(name);
    await page.getByLabel('Mobile number').fill(freshMobile());
    await page.getByLabel('Interested in').selectOption({ label: 'Farmer Pumps' });
    await page.getByLabel('PIN code').fill('302001');
    await page.getByLabel('Village or town').fill('Chomu');
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Save walk-in' }).click();
    await expect(
      page.getByText(`Walk-in saved for ${name}. The form is ready for the next customer.`),
    ).toBeVisible({ timeout: 30_000 });

    // The customer's page: a note on the timeline.
    await openCustomer(page, name);
    const history = page.getByRole('region', { name: 'History' });
    await history.getByRole('button', { name: 'Add note' }).click();
    const note = page.getByRole('dialog');
    await note.getByLabel('Note', { exact: true }).fill('Wants a 5 HP pump before the sowing season');
    await note.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(history.getByText('Wants a 5 HP pump before the sowing season')).toBeVisible();
    await expectNoAxeViolations(page);

    // The same lead in the converting workspace, where the quote is made.
    await page.goto('/converting');
    await expect(page.getByRole('heading', { name: 'Converting', level: 1 })).toBeVisible();
    await openLead(page, name);
    await expectNoAxeViolations(page);
  });
});

test.describe('UAT: the Executive’s day', () => {
  test.use(signedInAs('executive'));

  test('home, the Activity log and Integration health', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity log', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Integration health', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('UAT: a customers file and its row counts, as the cutover checks them', () => {
  test.use(signedInAs('gm'));

  test('adds a file and reads, then downloads, what happened to each row', async ({ page }) => {
    test.setTimeout(180_000);
    const repeated = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    const other = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    await page.goto('/imports/new');
    await page.getByLabel('What the file holds').selectOption({ label: 'Customers' });
    const file = `cutover-${String(Date.now()).slice(-6)}.csv`;
    await page.locator('input[type="file"]').setInputFiles({
      name: file,
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `${[
          'Name,Mobile,Village',
          `Mangi Lal Jat,${repeated},Kishangarh`,
          `Mangi Lal Jat,${repeated},Kishangarh`,
          `Sunita Gurjar,${other},Nasirabad`,
          'Prakash Meena,12345,Kekri',
        ].join('\n')}\n`,
      ),
    });
    await expect(page.getByRole('heading', { name: `Import of ${file}`, level: 1 })).toBeVisible({
      timeout: 45_000,
    });
    await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Site type', level: 3 }) })
      .getByLabel('For rows with this empty')
      .selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Check the rows' }).click();
    await page.getByRole('button', { name: 'Add 2 customers' }).click({ timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Customers added' })).toBeVisible({
      timeout: 90_000,
    });

    // Four rows in the file: two customers added, one row repeated, one refused for its number.
    const counts = page.getByRole('region', { name: 'What happened to each row' });
    const line = (label: string) => counts.getByRole('row', { name: new RegExp(`^${label}`) });
    await expect(line('Rows in the file')).toContainText('4');
    await expect(line('Added as new records')).toContainText('2');
    await expect(line('Repeated in the file')).toContainText('1');
    await expect(line('Not added')).toContainText('1');
    await expect(line('The phone number was wrong')).toContainText('1');
    await expectNoAxeViolations(page);

    const download = page.waitForEvent('download');
    await counts.getByRole('button', { name: 'Download as CSV' }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe(`${file.replace(/\.csv$/, '')} row counts.csv`);
    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8').split('\r\n').slice(0, 3)).toEqual([
      'What happened,Rows',
      'Rows in the file,4',
      'Added as new records,2',
    ]);
  });
});

test.describe('UAT: a dealer order held for credit, from Accounts to the Executive', () => {
  test.use(signedInAs('executive'));

  test('Accounts sets the limit, the order is held, the Executive releases it, Accounts sees it', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const dealer = seededUsers().uat.dealers[projectName()];
    const company = String(QUOTE_JOURNEY_COMPANY.entityId);

    // Accounts sets a small limit with 30 credit days.
    const accounts = await asRole(browser, 'journeyAccounts');
    await accounts.goto('/dealer-credit');
    await expect(accounts.getByRole('heading', { name: 'Dealer credit', level: 1 })).toBeVisible();
    await accounts.getByRole('button', { name: `Actions for ${dealer.name}` }).click();
    await accounts.getByRole('menuitem', { name: 'Enter limit and days' }).click();
    const terms = accounts.getByRole('dialog');
    await terms.getByLabel('Credit limit in rupees').fill('1,000');
    await terms.getByLabel('Credit days').fill('30');
    await expectNoAxeViolations(accounts);
    await terms.getByRole('button', { name: 'Save the terms' }).click();
    await expect(accounts.getByText('Credit limit and days saved.')).toBeVisible();

    // The Executive makes the dealer's order; confirming it is held, naming the limit.
    await page.goto(`/customers/${dealer.accountId}?company=${company}`);
    await expect(page.getByRole('heading', { name: dealer.name, level: 1 })).toBeVisible();
    await page
      .getByRole('region', { name: 'Orders' })
      .getByRole('link', { name: 'New dealer order' })
      .click();
    await page
      .getByLabel('Item', { exact: true })
      .selectOption({ label: 'Solar module 540 Wp (JRN-MOD-540), ₹12,000.00' });
    await page.getByLabel('Quantity').fill('1');
    await page.getByRole('button', { name: 'Work out the order' }).click();
    await expect(
      page.getByRole('region', { name: 'The order as it will be made' }).getByText('₹13,440.00').first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Make the order' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /\/SO\// })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Confirm the order' }).click();
    await expect(page.getByText('This order is held for credit.')).toBeVisible();
    await expect(page.getByText(/over their credit limit of ₹1,000\.00/)).toBeVisible();
    await expectNoAxeViolations(page);

    // Accounts cannot release it; only the Executive may, with a reason.
    await accounts.goto(page.url());
    await expect(accounts.getByText('This order is held for credit.')).toBeVisible();
    await expect(accounts.getByRole('button', { name: 'Release the hold' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Release the hold' }).click();
    const release = page.getByRole('dialog');
    await release.getByLabel('Why it is released').fill('Dealer paid by cheque at the counter');
    await release.getByRole('button', { name: 'Release the hold' }).click();
    await expect(page.getByText('Credit hold released. Confirm the order now.')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm the order' }).click();
    await expect(page.getByText('Order confirmed.')).toBeVisible();

    // Accounts sees the confirmed order counted against the dealer.
    await accounts.goto('/dealer-credit');
    await expect(dataGrid(accounts, 'Dealers').getByText('₹13,440.00').first()).toBeVisible();
    await expectNoAxeViolations(accounts);
    await accounts.context().close();
  });
});
