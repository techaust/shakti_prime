import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { seededUsers } from './support/users';

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('home shows the shortcuts for the role', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'home-tele-caller');
  });

  test('a screen the role may not open shows the not-found screen', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the home screen' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'not-found-tele-caller');
  });

  test('the profile menu opens from the keyboard and gives focus back', async ({ page }) => {
    await page.goto('/home');
    const button = page.getByRole('button', { name: 'Your account' });
    await button.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Your profile' })).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="menu"]' });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Your account' })).toBeFocused();
  });
});

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('the company switcher changes the leads shown', async ({ page }) => {
    const lead = seededUsers().secondCompanyLead;
    const switcher = page.getByRole('button', { name: /^Showing .*\. Choose a company$/ });
    const leads = dataGrid(page, 'Leads');
    await page.goto('/leads');

    await switcher.click();
    await page.getByRole('menuitemradio', { name: 'Shakti Supreme' }).click();
    // The switch reloads the screen for the chosen company.
    await expect(
      page.getByRole('button', { name: 'Showing Shakti Supreme. Choose a company' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(leads.getByText(lead)).toHaveCount(0);

    await switcher.click();
    await page.getByRole('menuitemradio', { name: 'Shakti Motor Pumps' }).click();
    await expect(
      page.getByRole('button', { name: 'Showing Shakti Motor Pumps. Choose a company' }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(leads.getByText(lead).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
