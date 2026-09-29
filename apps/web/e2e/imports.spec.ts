import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';

test.use(signedInAs('gm'));

test('uploads a spreadsheet of leads and opens its job', async ({ page }) => {
  await page.goto('/imports');
  await expect(page.getByRole('heading', { name: 'Imports', level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
  // The jobs grow with every run.
  await snap(page, 'imports-list', { mask: [page.getByRole('table')] });

  await page.getByRole('link', { name: 'New import' }).first().click();
  await expect(page.getByRole('heading', { name: 'New import', level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'imports-upload');

  const rows = [
    'Name,Mobile,Village',
    'Geeta Devi,98290 11111,Ajmer',
    'Suresh Jat,98290 22222,Beawar',
  ];
  await page.getByLabel('Spreadsheet file').setInputFiles({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(`${rows.join('\n')}\n`),
  });
  await page.getByRole('button', { name: 'Read the file' }).click();
  await expect(page.getByRole('heading', { name: 'Import of leads.csv', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Match the columns' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'imports-job', { mask: [page.getByText(/, started /)] });
});
