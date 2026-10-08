import type { Browser, Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { storageStatePath, type ProjectName } from './support/users';

/** The one project that marks all of the shared tele-caller's notices read. */
const MARK_ALL_PROJECT: ProjectName = 'desktop-light';

// Notifications (PRD RPT-04, docs/03-roadmap-appendix/phase1.md §8.1): a lead a team lead gives a tele-caller
// reaches her bell and opens from the notification centre; a possible duplicate of her own
// customer does the same; and she sets her notifications. Without a queue the app delivers each
// update to the notify worker in its own process right after the change is saved.

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

async function addLead(
  page: Page,
  lead: { name: string; mobile: string; line: string },
): Promise<void> {
  await page.goto('/leads/new');
  await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
  await page.getByLabel('Customer name').fill(lead.name);
  await page.getByLabel('Mobile number').fill(lead.mobile);
  const company = page.getByLabel('Company', { exact: true });
  if (await company.isVisible()) await company.selectOption({ label: 'Shakti Supreme' });
  await page.getByLabel('Line of business').selectOption({ label: lead.line });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByText(`Lead saved for ${lead.name}.`)).toBeVisible({ timeout: 30_000 });
}

/** The bell, once it counts at least one unread notice; the page is read again until it does. */
async function bellWithUnread(page: Page) {
  const bell = page.getByRole('button', { name: /^Notifications, (\d+|100 or more) unread$/ });
  await expect(async () => {
    await page.reload();
    await expect(bell).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  return bell;
}

/** The notification centre, opened from the bell. */
async function openCentre(page: Page) {
  const bell = await bellWithUnread(page);
  await bell.click();
  const centre = page.getByRole('dialog', { name: 'Notifications' });
  await expect(centre).toBeVisible();
  return centre;
}

async function asTeleCaller(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStatePath('teleCaller') });
  return context.newPage();
}

test.describe('a lead given to a tele-caller', () => {
  test.use(signedInAs('teamLead'));

  test('reaches her bell, and she opens the lead from the notification centre', async ({
    page,
    browser,
  }) => {
    test.slow();
    const name = `Bhagirath Meena ${String(Date.now()).slice(-6)}`;
    await addLead(page, { name, mobile: freshMobile(), line: 'Farmer Pumps' });

    // The team lead hands the new lead to the tele-caller from the board.
    await page.goto('/leads/board?pipeline=farmer_pumps');
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    await page.getByRole('menuitem', { name: 'Assign to someone' }).click();
    const dialog = page.getByRole('dialog', { name: `Assign ${name}` });
    await dialog.getByLabel('Person').selectOption({ label: 'Neha Saini' });
    await dialog.getByRole('button', { name: 'Assign lead' }).click();
    await expect(page.getByText(`${name} is now with Neha Saini.`)).toBeVisible();

    const caller = await asTeleCaller(browser);
    await caller.goto('/home');
    const centre = await openCentre(caller);
    const notice = centre.getByRole('listitem').filter({ hasText: name }).first();
    await expect(notice.getByRole('link', { name: 'A lead was given to you' })).toBeVisible();
    await expect(notice.getByText('Not read yet')).toBeVisible();
    await expectNoAxeViolations(caller, { include: '[role="dialog"]' });

    await notice.getByRole('link', { name: 'A lead was given to you' }).click();
    await expect(caller).toHaveURL(/\/customers\/[0-9a-f-]+\?company=1$/);
    await expect(caller.getByRole('heading', { name, level: 1 })).toBeVisible();
    await caller.context().close();
  });
});

test.describe('notices as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('a possible duplicate of her customer reaches the centre, and she marks it read', async ({
    page,
  }) => {
    test.slow();
    const name = `Sohan Lal Gurjar ${String(Date.now()).slice(-6)}`;
    const mobile = freshMobile();
    await addLead(page, { name, mobile, line: 'Farmer Pumps' });
    // The same number for another line of business: a second customer, put forward as a duplicate.
    await addLead(page, { name, mobile, line: 'Residential Rooftop' });

    const centre = await openCentre(page);
    const notice = centre
      .getByRole('listitem')
      .filter({
        has: page.getByRole('link', { name: 'A customer or lead of yours may be a duplicate' }),
      })
      .filter({ hasText: name })
      .first();
    await expect(notice).toBeVisible();
    await notice
      .getByRole('button', {
        name: 'Mark as read: A customer or lead of yours may be a duplicate',
      })
      .click();
    await expect(notice.getByText('Not read yet')).toHaveCount(0);
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    await snap(page, 'notification-centre', { mask: [centre.getByRole('list')] });
  });

  test('she chooses which notices reach her, and her quiet hours', async ({ page }) => {
    await page.goto('/settings/notifications');
    await expect(
      page.getByRole('heading', { name: 'Notification settings', level: 1 }),
    ).toBeVisible();
    // No alert keys locally: the page says alerts are not set up, and notices still arrive.
    await expect(page.getByText('Alerts are not set up yet.')).toBeVisible();

    const pushCall = page.getByRole('checkbox', {
      name: 'Send “A call of yours is due” as an alert',
    });
    const showCall = page.getByRole('checkbox', {
      name: 'Show “A call of yours is due” in Notifications',
    });
    await expect(showCall).toBeChecked();
    await pushCall.uncheck();
    await page.getByLabel('Quiet from').fill('22:00');
    await page.getByLabel('Quiet until').fill('07:00');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Your notification settings are saved.')).toBeVisible();

    await page.reload();
    await expect(pushCall).not.toBeChecked();
    await expect(showCall).toBeChecked();
    await expect(page.getByLabel('Quiet from')).toHaveValue('22:00');
    await expect(page.getByLabel('Quiet until')).toHaveValue('07:00');
    await expectNoAxeViolations(page);
    await snap(page, 'notification-settings');

    // Quiet hours of one time only are refused in plain words.
    await page.getByLabel('Quiet until').fill('');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(
      page.getByText('Enter both quiet hours times, or leave both empty for no quiet hours.'),
    ).toBeVisible();
  });

  test('the profile menu opens the notification settings', async ({ page }) => {
    await page.goto('/home');
    await page.getByRole('button', { name: 'Your account' }).click();
    await page.getByRole('menuitem', { name: 'Notification settings' }).click();
    await expect(page).toHaveURL(/\/settings\/notifications$/);
  });
});

test.describe('all notices read at once, as a store manager', () => {
  test.use(signedInAs('storeManager'));

  test('marks every unread notice read', async ({ page }) => {
    // Every project signs in as the same store manager, so one project alone marks all of his
    // notices read; no other journey reads his notices.
    test.skip(projectName() !== MARK_ALL_PROJECT, 'marked read once, in one project');
    test.slow();
    const name = `Mangal Singh ${String(Date.now()).slice(-6)}`;
    const mobile = freshMobile();
    await addLead(page, { name, mobile, line: 'Farmer Pumps' });
    await addLead(page, { name, mobile, line: 'Residential Rooftop' });

    const centre = await openCentre(page);
    await expect(centre.getByText('Not read yet').first()).toBeVisible();
    await centre.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(page.getByText('All notices are marked as read.')).toBeVisible();
    await expect(centre.getByText('Not read yet')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
  });
});
