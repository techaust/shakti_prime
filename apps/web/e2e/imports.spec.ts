import type { Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
  showCompany,
} from './support/fixtures';
import { SNAPSHOT_COMPANY, SNAPSHOT_IMPORT_FILE } from './support/users';

/** A mobile number no earlier run used, so each run's file differs and is taken again. */
const freshMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

/**
 * Sends a file through the import screen's uploader: it goes to the file store on a signed
 * address, passes its checks (in the app itself on this machine, with no queue), and the screen
 * then reads it and opens its job.
 */
async function uploadImport(page: Page, name: string, lines: string[]): Promise<void> {
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\n')}\n`) });
  // The job screen reads the whole file back, so it may take a moment.
  await expect(page.getByRole('heading', { name: `Import of ${name}`, level: 1 })).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
}

test.describe('as a GM', () => {
  test.use(signedInAs('gm'));

  test('uploads a spreadsheet of leads and opens its job', async ({ page }) => {
    // The upload and its checks come between three pages, each read by axe.
    test.slow();
    await page.goto('/imports');
    await expect(page.getByRole('heading', { name: 'Imports', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'New import' }).first().click();
    await expect(page.getByRole('heading', { name: 'New import', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'imports-upload');
    // The PIN code list is for all four companies at once, which a GM of one does not work in.
    await expect(
      page.getByLabel('What the file holds').locator('option', { hasText: 'PIN code list' }),
    ).toHaveCount(0);

    await uploadImport(page, 'leads.csv', [
      'Name,Mobile,Village',
      'Geeta Devi,98290 11111,Ajmer',
      'Suresh Jat,98290 22222,Beawar',
      `Harish Saini,${freshMobile()},Kekri`,
    ]);
    await expectNoAxeViolations(page);
    await snap(page, 'imports-job', { mask: [page.getByText(/, started /)] });
  });

  test('uploads a spreadsheet of customers, matches its columns and checks its rows', async ({
    page,
  }) => {
    // The upload and its checks, then matching and checking the rows: one step after another.
    test.slow();
    await page.goto('/imports/new');
    await page.getByLabel('What the file holds').selectOption({ label: 'Customers' });
    await expect(
      page.getByText('Rows with the same mobile number become one customer.'),
    ).toBeVisible();
    const repeated = freshMobile();
    await uploadImport(page, 'customers.csv', [
      'Name,Mobile,Village',
      `Kamla Devi,${repeated},Kishangarh`,
      `Kamla Devi,${repeated},Kishangarh`,
      `Ramesh Gurjar,${freshMobile()},Nasirabad`,
    ]);
    await expectNoAxeViolations(page);
    // The file names villages but no kind of site: one is chosen for every row.
    await page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'Site type', level: 3 }) })
      .getByLabel('For rows with this empty')
      .selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Check the rows' }).click();
    // Matching, then checking every row against the customers already there.
    await expect(page.getByRole('button', { name: 'Add 2 customers' })).toBeVisible({
      timeout: 60_000,
    });
    // The second row of one mobile number is folded into the first customer.
    await page.getByLabel('Show').selectOption({ label: 'All rows' });
    await expect(
      page
        .getByText('Same mobile number as row 1. Its company is added to that customer.')
        // The rows show as a table on a wide screen and as cards on a phone.
        .filter({ visible: true }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('adds post offices to the PIN code list, which the lead form then finds', async ({
    page,
  }) => {
    // The upload and its checks, matching, checking and adding the rows, then the lead form.
    test.slow();
    await page.goto('/imports/new');
    await page.getByLabel('Company', { exact: true }).selectOption({ label: 'Shakti Supreme' });
    await page.getByLabel('What the file holds').selectOption({ label: 'PIN code list' });
    await expectNoAxeViolations(page);
    // Made-up offices under a PIN no post office uses (9 starts the Army Postal Service's PINs);
    // the last column differs each run, so the same file is taken again.
    await uploadImport(page, 'pin-codes.csv', [
      'Pincode,OfficeName,Taluk,District,StateName,Run',
      `999001,Kherovan B.O,Sotikul,Balvanti,Rajasthan,${freshMobile()}`,
      `999001,Mandravi B.O,Sotikul,Balvanti,Rajasthan,${freshMobile()}`,
    ]);
    await page.getByRole('button', { name: 'Check the rows' }).click();
    await page.getByRole('button', { name: 'Add 2 offices' }).click({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'PIN codes added' })).toBeVisible({
      timeout: 45_000,
    });
    await expectNoAxeViolations(page);

    await page.goto('/leads/new');
    const pin = page.getByLabel('PIN code');
    await pin.fill('999001');
    await expect(page.getByText('Tehsil Sotikul, district Balvanti.')).toBeVisible();
    // Its post offices are offered for the village, by the place each names.
    await expect(page.locator('#lead-village-offices option[value="Kherovan"]')).toHaveCount(1);
    await expectNoAxeViolations(page);
    await pin.fill('999999');
    await expect(
      page.getByText(
        'This PIN is not in the PIN code list. The site is saved and marked for someone to check.',
      ),
    ).toBeVisible();
  });
});

// The screenshot of the imports list: the snapshot company's one import, made by the seed.
test.describe('the imports of the snapshot company', () => {
  test.use(signedInAs('executive'));

  test('the list shows the import', async ({ page }) => {
    await page.goto('/imports');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await expect(dataGrid(page, 'Imports').getByText(SNAPSHOT_IMPORT_FILE)).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'imports-list');
  });
});
