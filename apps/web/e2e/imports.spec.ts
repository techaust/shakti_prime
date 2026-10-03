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

test.describe('as a GM', () => {
  test.use(signedInAs('gm'));

  test('uploads a spreadsheet of leads and opens its job', async ({ page }) => {
    await page.goto('/imports');
    await expect(page.getByRole('heading', { name: 'Imports', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('link', { name: 'New import' }).first().click();
    await expect(page.getByRole('heading', { name: 'New import', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'imports-upload');

    const rows = [
      'Name,Mobile,Village',
      'Geeta Devi,98290 11111,Ajmer',
      'Suresh Jat,98290 22222,Beawar',
      // A file is taken once per company, so each run's file differs by one row.
      `Harish Saini,9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')},Kekri`,
    ];
    await page.getByLabel('Spreadsheet file').setInputFiles({
      name: 'leads.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${rows.join('\n')}\n`),
    });
    await page.getByRole('button', { name: 'Read the file' }).click();
    // The job screen reads the whole file back, so it may take a moment.
    await expect(page.getByRole('heading', { name: 'Import of leads.csv', level: 1 })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'imports-job', { mask: [page.getByText(/, started /)] });
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
