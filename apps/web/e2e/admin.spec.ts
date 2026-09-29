import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
  showCompany,
} from './support/fixtures';
import { SNAPSHOT_COMPANY, SNAPSHOT_LEADS } from './support/users';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  // The team and the Activity log are shown for the snapshot company, where only the seed writes
  // (users.ts), so the screenshots show real rows; only times are masked.
  test('team members', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Team members', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    const grid = dataGrid(page, 'Team members');
    await expect(grid.getByText('Geeta Kumari')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'team-members');
  });

  test('activity log', async ({ page }) => {
    await page.goto('/admin/activity');
    await expect(page.getByRole('heading', { name: 'Activity log', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await page.getByLabel('What happened').selectOption({ label: 'Lead added' });
    await page.getByLabel('Person').selectOption({ label: 'Geeta Kumari' });
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    const grid = dataGrid(page, 'Activity log');
    await expect(grid.getByText('Lead added')).toHaveCount(SNAPSHOT_LEADS.length, {
      timeout: 30_000,
    });
    await expectNoAxeViolations(page);
    // The window's dates are today's and the last week's.
    await snap(page, 'activity-log', { mask: [page.getByLabel('From'), page.getByLabel('To')] });
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
