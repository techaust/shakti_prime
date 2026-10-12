import { expect, signedInAs, test } from './support/fixtures';
import { waitForBotCheck } from './support/sign-in';
import { E2E_PASSWORD, emailFor } from './support/users';

test.use(signedInAs('teleCaller'));

test('a sign-in that ended while a screen was open goes to sign-in and back to that screen (WEB-7)', async ({
  page,
}) => {
  await page.goto('/leads/new');
  await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
  await page.getByLabel('Customer name').fill(`Mohan Lal ${String(Date.now()).slice(-5)}`);
  await page.getByLabel('Mobile number').fill('98765 43210');
  // The browser drops the session cookie, as it does when the idle limit passes.
  await page.context().clearCookies();
  await page.getByRole('button', { name: 'Save lead' }).click();

  await page.waitForURL('**/sign-in?reason=session_ended&returnTo=%2Fleads%2Fnew');
  await expect(page.getByText('You were signed out.', { exact: false })).toBeVisible();
  await page.getByLabel('Email').fill(emailFor('teleCaller'));
  await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
  await waitForBotCheck(page);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/leads/new');
  await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
});
