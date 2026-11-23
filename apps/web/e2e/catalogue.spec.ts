import {
  expect,
  expectNoAxeViolations,
  signedInAs,
  showCompany,
  snap,
  test,
} from './support/fixtures';

// The catalogue and the GST rates are shared by every company, and the seed writes none of them,
// so these journeys open the screens and the add dialogs and close them again: no journey adds a
// row another journey's screenshot would show.

test.describe('as an Executive, acting for every company', () => {
  test.use(signedInAs('executive'));

  test('the items, and the add item dialog', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Catalogue', level: 1 })).toBeVisible();
    await showCompany(page, 'All companies');
    await expect(page.getByRole('link', { name: 'Items' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    await snap(page, 'catalogue-items');

    await page.getByRole('button', { name: 'Add item' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an item' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Add item' })).toBeFocused();
  });

  test('the kits, and the add kit dialog', async ({ page }) => {
    await page.goto('/catalogue/kits');
    await showCompany(page, 'All companies');
    await expect(page.getByRole('link', { name: 'Kits' })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
    await snap(page, 'catalogue-kits');

    await page.getByRole('button', { name: 'Add kit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a kit' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('the GST rates, and the add rate dialog', async ({ page }) => {
    await page.goto('/settings/tax');
    await expect(page.getByRole('heading', { name: 'Tax rates', level: 1 })).toBeVisible();
    await showCompany(page, 'All companies');
    await expectNoAxeViolations(page);
    await snap(page, 'tax-rates');

    await page.getByRole('button', { name: 'Add rate' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a GST rate' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('as Accounts, in one company', () => {
  test.use(signedInAs('accounts'));

  test('reads the GST rates and is told changes need every company', async ({ page }) => {
    await page.goto('/settings/tax');
    await expect(page.getByRole('heading', { name: 'Tax rates', level: 1 })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('apply to every company in the group');
    await expect(page.getByRole('button', { name: 'Add rate' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'tax-rates-one-company');
  });
});

test.describe('as a tele-caller, who reads prices only', () => {
  test.use(signedInAs('teleCaller'));

  test('reads the catalogue without the add actions', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Catalogue', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add item' })).toHaveCount(0);
    await expect(page.getByRole('note')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'catalogue-read-only');
  });

  test('cannot open the GST rates', async ({ page }) => {
    await page.goto('/settings/tax');
    await expect(page.getByRole('heading', { name: 'Tax rates', level: 1 })).toHaveCount(0);
  });
});

// Stock and warranty (phase3 §6.1, C5). The seeded cable is opened and its form filled but never
// saved, so no other journey's picture of the catalogue changes.
test.describe('stock and warranty, as an Executive acting for every company', () => {
  test.use(signedInAs('executive'));

  test('the item sheet shows the terms, and the form checks them before saving', async ({
    page,
  }) => {
    await page.goto('/catalogue');
    await showCompany(page, 'All companies');
    await page.getByRole('button', { name: 'Open Solar cable 4 sq mm' }).click();
    const sheet = page.getByRole('dialog', { name: 'Solar cable 4 sq mm' });
    const stock = sheet.getByRole('region', { name: 'Stock and warranty' });
    await expect(stock).toBeVisible();
    await expect(stock.getByText('Kept in stock')).toBeVisible();
    await expect(stock.getByText('The same unit as stock')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'catalogue-item-stock');

    await sheet.getByRole('button', { name: 'Edit' }).click();
    const form = page.getByRole('dialog', { name: 'Edit Solar cable 4 sq mm' });
    const terms = form.getByRole('group', { name: 'Stock and warranty' });
    await expect(terms).toBeVisible();
    await terms.getByLabel('Warranty to the customer, in months').fill('400');
    await terms.getByLabel('Bought in').selectOption({ label: 'Piece' });
    await terms.getByLabel('How much one bought unit holds').fill('0.5');
    await form.getByRole('button', { name: 'Save item' }).click();
    await expect(
      terms.getByText('Enter whole months from 0 to 360, or leave it empty.'),
    ).toBeVisible();
    await expect(
      terms.getByText('Enter how many stock units one bought unit holds', { exact: false }),
    ).toBeVisible();
    // A serial pattern is asked only of an item with a serial number on each piece.
    await expect(terms.getByLabel('Shape of its serial numbers')).toHaveCount(0);
    await form.getByLabel('Each piece has its own serial number').check();
    await expect(terms.getByLabel('Shape of its serial numbers')).toBeVisible();
    await expectNoAxeViolations(page);
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toBeHidden();
  });

  test('Import items opens a new import of catalogue items', async ({ page }) => {
    await page.goto('/catalogue');
    await showCompany(page, 'All companies');
    await page.getByRole('link', { name: 'Import items' }).click();
    await expect(page).toHaveURL(/\/imports\/new\?kind=items$/);
    await expect(page.getByLabel('What the file holds')).toHaveValue('items');
    await expectNoAxeViolations(page);
    await snap(page, 'imports-new-items');
  });
});

test.describe('stock and warranty, as a tele-caller who reads prices only', () => {
  test.use(signedInAs('teleCaller'));

  test('reads the terms without changing them, and is not offered the import', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('link', { name: 'Import items' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open Solar cable 4 sq mm' }).click();
    const sheet = page.getByRole('dialog', { name: 'Solar cable 4 sq mm' });
    await expect(sheet.getByRole('region', { name: 'Stock and warranty' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
