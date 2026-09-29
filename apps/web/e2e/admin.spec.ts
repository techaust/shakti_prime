import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('team members', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Team members', level: 1 })).toBeVisible();
    const grid = dataGrid(page, 'Team members');
    await expect(grid).toBeVisible();
    await expectNoAxeViolations(page);
    // The people and their last sign-in change with every run of the suites.
    await snap(page, 'team-members', { mask: [grid] });
  });

  test('activity log', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity log', level: 1 })).toBeVisible();
    const grid = dataGrid(page, 'Activity log');
    await expect(grid).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'activity-log', { mask: [grid] });
  });

  test('companies', async ({ page }) => {
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    await expect(dataGrid(page, 'Companies')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'companies');
  });

  test('the design preview', async ({ page }) => {
    // The board shows every component in four themes, so axe has the most to read here.
    test.slow();
    await page.goto('/design');
    await expect(page.getByRole('heading', { name: 'Design preview', level: 1 })).toBeVisible();
    await snap(page, 'design');
    // The print previews are the paper templates in sandboxed frames without scripts, where axe
    // cannot run; printed documents are checked by the print module's own tests.
    await expectNoAxeViolations(page, { removeFrames: 'iframe[sandbox]' });
  });
});
