import {
  expect,
  expectNoAxeViolations,
  signedInAs,
  showCompany,
  snap,
  test,
} from './support/fixtures';

// Saving a role signs out everyone who holds it, the journeys' own people included, so these
// journeys change a choice and undo it; the save itself is covered by the command's tests.

test.describe('as an Executive, acting for every company', () => {
  test.use(signedInAs('executive'));

  test('the roles, and a change undone on one role', async ({ page }) => {
    await page.goto('/admin/roles');
    await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toBeVisible();
    await showCompany(page, 'All companies');
    await expectNoAxeViolations(page);
    // Holder counts change as other journeys invite people; the names and grants do not.
    await snap(page, 'roles');

    await page.getByRole('link', { name: 'Change permissions of Store Manager' }).click();
    await expect(
      page.getByRole('heading', { name: 'Permissions of Store Manager', level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('No changes yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expectNoAxeViolations(page);

    const seeLeads = page.getByLabel('See leads');
    const before = await seeLeads.inputValue();
    await seeLeads.selectOption(before === 'none' ? 'own' : 'none');
    await expect(page.getByText('No changes yet.')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo changes' }).click();
    await expect(seeLeads).toHaveValue(before);
    await expect(page.getByText('No changes yet.')).toBeVisible();
  });
});

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('cannot open the roles', async ({ page }) => {
    await page.goto('/admin/roles');
    await expect(page.getByRole('heading', { name: 'Roles', level: 1 })).toHaveCount(0);
  });
});
