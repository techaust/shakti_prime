import { expect, expectNoAxeViolations, signedInAs, showCompany, snap, test } from './support/fixtures';

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
