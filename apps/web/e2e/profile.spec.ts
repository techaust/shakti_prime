import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedOut,
  snap,
  test,
} from './support/fixtures';
import { signInThroughScreens } from './support/sign-in';
import { seededUsers } from './support/users';

// A person of this project's own (from the seed), so switching their theme never changes what
// another journey running at the same time sees. The sign-in also passes the code screen.
test.use(signedOut);

test('the profile switches the theme and the higher contrast, and keeps them', async ({ page }) => {
  const person = seededUsers().profileUsers[projectName()];
  await signInThroughScreens(page, person.email, person.secret);
  await page.goto('/settings/profile');
  await expect(page.getByRole('heading', { name: 'Your profile', level: 1 })).toBeVisible();
  const html = page.locator('html');
  // The choices are radios inside their labels, drawn as one segmented control.
  const choose = async (name: string) => {
    await page
      .locator('label')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .click();
    await expect(page.getByRole('radio', { name })).toBeChecked();
  };

  await choose('Same as device');
  await expectNoAxeViolations(page);
  await snap(page, 'profile');

  await choose('Dark');
  await expect(html).toHaveAttribute('data-theme', /dark/);
  await choose('Light');
  await expect(html).toHaveAttribute('data-theme', /light/);

  const contrast = page.getByRole('switch', { name: 'Higher contrast' });
  await contrast.click();
  await expect(contrast).toHaveAttribute('aria-checked', 'true');
  // Saved on the profile once the switch is no longer busy.
  await expect(contrast).toHaveAttribute('aria-busy', 'false');
  await page.reload();
  await expect(contrast).toHaveAttribute('aria-checked', 'true');
  await expectNoAxeViolations(page);

  // Back to the defaults, so the next run starts from the same screen.
  await contrast.click();
  await expect(contrast).toHaveAttribute('aria-checked', 'false');
  await expect(contrast).toHaveAttribute('aria-busy', 'false');
  await choose('Same as device');
});
