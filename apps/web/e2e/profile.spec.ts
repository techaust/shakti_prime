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
  const person = seededUsers().verifyUsers[projectName()];
  await signInThroughScreens(page, person.email, person.secret);
  await page.goto('/settings/profile');
  await expect(page.getByRole('heading', { name: 'Your profile', level: 1 })).toBeVisible();
  const html = page.locator('html');

  await page.getByRole('radio', { name: 'Same as device' }).check();
  await expectNoAxeViolations(page);
  await snap(page, 'profile');

  await page.getByRole('radio', { name: 'Dark' }).check();
  await expect(html).toHaveClass(/dark/);
  await page.getByRole('radio', { name: 'Light' }).check();
  await expect(html).not.toHaveClass(/dark/);

  const contrast = page.getByRole('switch', { name: 'Higher contrast' });
  await contrast.click();
  await expect(contrast).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(contrast).toHaveAttribute('aria-checked', 'true');
  await expectNoAxeViolations(page);

  // Back to the defaults, so the next run starts from the same screen.
  await contrast.click();
  await expect(contrast).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('radio', { name: 'Same as device' }).check();
});
