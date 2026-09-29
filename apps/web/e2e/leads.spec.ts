import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';

test.describe('leads as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('opens the leads list', async ({ page }) => {
    await page.goto('/leads');
    await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
    await expect(page.getByRole('grid').or(page.getByRole('table'))).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'leads-list-tele-caller');
  });
});
