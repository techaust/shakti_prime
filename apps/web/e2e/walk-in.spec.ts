import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';

/** A mobile number no earlier run used, typed the way the counter types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

test.describe('the walk-in form as a Store Manager', () => {
  test.use(signedInAs('storeManager'));

  test('opens with the name box ready and Hinglish as the language for calls', async ({ page }) => {
    await page.goto('/leads/walk-in');
    await expect(page.getByRole('heading', { name: 'Walk-in customer', level: 1 })).toBeVisible();
    // One company, so the name box takes focus for the first customer.
    await expect(page.getByLabel('Customer name')).toBeFocused();
    await expect(page.getByLabel('Language for calls')).toHaveValue('hinglish');
    // The referral code box waits for lead creation to apply codes.
    await expect(page.getByLabel('Referral code')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'leads-walk-in');
  });

  test('saves a walk-in from the keyboard and is ready for the next customer', async ({ page }) => {
    await page.goto('/leads/walk-in');
    const nameBox = page.getByLabel('Customer name');
    await expect(nameBox).toBeFocused();
    const name = `Sita Ram ${String(Date.now()).slice(-5)}`;
    await page.keyboard.type(name);
    await page.keyboard.press('Tab');
    await page.keyboard.type(freshMobile());
    await page.getByLabel('Interested in').selectOption({ label: 'Farmer Pumps' });

    // A PIN without its village is answered on the form, with the village box focused.
    await page.getByLabel('PIN code').fill('302001');
    await page.getByLabel('PIN code').press('Enter');
    await expect(page.getByText('Enter the village for this PIN code.')).toBeVisible();
    await expect(page.getByLabel('Village or town')).toBeFocused();

    await page.keyboard.type('Chomu');
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(`Walk-in saved for ${name}. The form is ready for the next customer.`),
    ).toBeVisible();
    await expect(nameBox).toHaveValue('');
    await expect(nameBox).toBeFocused();
  });

  test('saves a dealer enquiry without asking for a village', async ({ page }) => {
    await page.goto('/leads/walk-in');
    const name = `Gupta Traders ${String(Date.now()).slice(-5)}`;
    await page.getByLabel('Customer name').fill(name);
    await page.getByLabel('Mobile number').fill(freshMobile());
    await page.getByLabel('Interested in').selectOption({ label: 'Dealer and Wholesale' });
    await expect(page.getByLabel('Village or town')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save walk-in' }).click();
    await expect(
      page.getByText(`Walk-in saved for ${name}. The form is ready for the next customer.`),
    ).toBeVisible();
  });
});

test.describe('the walk-in form as Accounts', () => {
  test.use(signedInAs('accounts'));

  test('is not a screen the role may open', async ({ page }) => {
    await page.goto('/leads/walk-in');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Walk-in customer' })).toHaveCount(0);
  });
});
