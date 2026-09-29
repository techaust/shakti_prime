import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedOut,
  snap,
  test,
} from './support/fixtures';
import { submitCode, submitSignIn, waitForBotCheck } from './support/sign-in';
import { totpCode } from './support/totp';
import { E2E_PASSWORD, emailFor, seededUsers } from './support/users';

test.use(signedOut);

test('the public landing page leads to sign-in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'landing');
  await page.getByRole('link', { name: 'Staff sign in' }).first().click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('the sign-in screen', async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'sign-in');
});

test('sign-in refuses a wrong password and keeps the email', async ({ page }) => {
  await submitSignIn(page, emailFor('teleCaller'), 'not the right password at all');
  await expect(page.getByText(/couldn.t sign you in with that email and password/)).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveValue(emailFor('teleCaller'));
  await expectNoAxeViolations(page);
  await snap(page, 'sign-in-wrong-password');
});

test('the forgotten-password screen answers the same for any address', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page.getByRole('heading', { name: 'Get a new password link' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'forgot-password');
  await page.getByLabel('Email').fill(`nobody-${projectName()}@shakti.test`);
  await waitForBotCheck(page);
  await page.getByRole('button', { name: 'Send link' }).click();
  await expect(page.getByText('If this email belongs to a staff account')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('an invited person chooses a password from the link', async ({ page }) => {
  await page.goto(seededUsers().setPasswordLinks[projectName()]);
  await expect(page.getByRole('heading', { name: 'Choose your password' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'set-password');
  await page.getByLabel('New password').fill(E2E_PASSWORD);
  await page.getByLabel('Type it again').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Save password' }).click();
  await expect(page.getByText('Your password is saved. You can sign in now.')).toBeVisible();
  await expectNoAxeViolations(page);
});

test('a dead set-password link offers a new one', async ({ page }) => {
  await page.goto('/set-password');
  await expect(page.getByRole('link', { name: 'Ask for a new link' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'set-password-expired');
});

test('a role that needs an authenticator app sets one up at first sign-in', async ({ page }) => {
  await submitSignIn(page, seededUsers().enrolEmails[projectName()]);
  await page.waitForURL('**/two-factor');
  await expect(page.getByRole('heading', { name: 'Set up your authenticator app' })).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'two-factor-enrol');
  await page.getByLabel('Your password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Begin setup' }).click();
  await expect(
    page.getByRole('heading', { name: 'Scan this with your authenticator app' }),
  ).toBeVisible();
  const key = page.locator('p.font-mono');
  const secret = (await key.textContent()) ?? '';
  await expectNoAxeViolations(page);
  // The QR code, the key and the backup codes are new at every enrolment.
  await snap(page, 'two-factor-scan', {
    mask: [page.getByRole('img'), key, page.locator('ul.font-mono')],
  });
  await page.getByLabel('6-digit code from the app').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.waitForURL('**/home');
});

test('a person with an authenticator app types its code at sign-in', async ({ page }) => {
  const person = seededUsers().verifyUsers[projectName()];
  await submitSignIn(page, person.email);
  await page.waitForURL('**/two-factor');
  await expect(
    page.getByRole('heading', { name: 'Enter the code from your authenticator app' }),
  ).toBeVisible();
  await expectNoAxeViolations(page);
  await snap(page, 'two-factor-verify');
  await submitCode(page, person.secret);
  await page.waitForURL('**/home');
});
