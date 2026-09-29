import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('team members', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Team members', level: 1 })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoAxeViolations(page);
    // The people and their last sign-in change with every run of the suites.
    await snap(page, 'team-members', { mask: [page.getByRole('table')] });
  });

  test('activity log', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity log', level: 1 })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'activity-log', { mask: [page.getByRole('table')] });
  });

  test('companies', async ({ page }) => {
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Companies' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'companies');
  });

  test('the design preview', async ({ page }) => {
    // The board shows every component in four themes, so axe has the most to read here.
    test.slow();
    await page.goto('/design');
    await expect(page.getByRole('heading', { name: 'Design preview', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'design');
  });
});
