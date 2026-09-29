import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('opens the price lists', async ({ page }) => {
    await page.goto('/price-master');
    await expect(page.getByRole('heading', { name: 'Price lists', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'price-master-executive');
  });
});

test.describe('as a tele-caller, who reads prices only', () => {
  test.use(signedInAs('teleCaller'));

  test('opens the price lists without the price action', async ({ page }) => {
    await page.goto('/price-master');
    await expect(page.getByRole('heading', { name: 'Price lists', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Set price/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'price-master-read-only');
  });
});
