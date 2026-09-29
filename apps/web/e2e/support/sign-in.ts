import { expect, type Page } from '@playwright/test';
import { totpCode } from './totp';
import { E2E_PASSWORD } from './users';

/** Fills the sign-in form and waits for the bot check's answer before sending it. */
export async function submitSignIn(
  page: Page,
  email: string,
  password = E2E_PASSWORD,
): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  // Cloudflare's test site key answers at once; the form waits for that answer like a person would.
  await expect(page.locator('input[name="cf-turnstile-response"]')).not.toHaveValue('', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Types the current code of an authenticator app on the sign-in code screen. */
export async function submitCode(page: Page, secret: string): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Enter the code from your authenticator app' }),
  ).toBeVisible();
  await page.getByLabel('6-digit code from the app').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Confirm' }).click();
}

/** Signs in through the screens, with the second check when the role has one, and lands on home. */
export async function signInThroughScreens(
  page: Page,
  email: string,
  secret?: string,
): Promise<void> {
  await submitSignIn(page, email);
  if (secret !== undefined) {
    await page.waitForURL('**/two-factor');
    await submitCode(page, secret);
  }
  await page.waitForURL('**/home');
}
