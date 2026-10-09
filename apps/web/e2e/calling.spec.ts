import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';
import { SNAPSHOT_LEADS } from './support/users';

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/**
 * Calls may be saved and numbers shown only from 9 AM to 9 PM in India (TRAI). The journey runs
 * whenever CI runs, so outside those hours it checks that the workspace says so instead.
 */
function inCallingHours(at = new Date()): boolean {
  const minutes = (Math.floor(at.getTime() / 60_000) + 330) % 1440;
  // A margin at each end, so the hour does not change in the middle of the journey.
  return minutes >= 9 * 60 + 5 && minutes < 21 * 60 - 10;
}

/** A lead of the tele-caller's own, added through the lead form; answers the customer's name. */
async function addLead(page: Page, first: string): Promise<string> {
  const name = `${first} ${String(Date.now()).slice(-6)}`;
  await page.goto('/leads/new');
  await page.getByLabel('Customer name').fill(name);
  await page.getByLabel('Mobile number').fill(freshMobile());
  await page.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible({ timeout: 30_000 });
  return name;
}

/** Opens a lead in the workspace from the keyboard: `/`, its name, Enter, then the hit. */
async function findLead(page: Page, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: /Find a lead/ });
  // The workspace's keys work once the page has hydrated; a `/` pressed before then does nothing,
  // so it is pressed again until the search takes the keyboard.
  await expect(async () => {
    await page.locator('body').press('/');
    await expect(search).toBeFocused({ timeout: 1_000 });
  }).toPass();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
  await expect(hit).toContainText(name);
  await hit.focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name, level: 2 });
  await expect(heading).toBeVisible();
  // The workspace takes the keyboard back, so the next key is the workspace's.
  await expect(heading).toBeFocused();
}

const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByText(text).first()).toBeVisible();

test.describe('calling as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('opens the queue and the workspace', async ({ page }) => {
    await page.goto('/calling');
    await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Queue', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Call script', level: 2 })).toBeVisible();
    // A tele-caller has no team view.
    await expect(page.getByRole('link', { name: 'My team' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('works leads from the keyboard: an unanswered call, a callback and a qualified lead', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const unanswered = await addLead(page, 'Mohan Lal Saini');
    const callback = await addLead(page, 'Geeta Devi Yadav');
    const qualified = await addLead(page, 'Ramesh Kumar Meena');
    await page.goto('/calling');
    await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();

    await findLead(page, unanswered);
    // The script card names the lead's business line and the customer's call language, with no
    // script until the sales head gives one.
    await expect(
      page.getByText(
        'There is no call script for Farmer pumps customers in Hinglish yet. Your sales head will add it.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);

    if (!inCallingHours()) {
      // Outside 9 AM to 9 PM the number stays hidden and no call can be saved.
      await page.keyboard.press('d');
      await expect(
        page.getByText(
          'Calls can be made only between 9 AM and 9 PM. Try again during calling hours.',
        ),
      ).toBeVisible();
      await page.keyboard.press('3');
      await expect(
        page
          .getByText(
            'Calls can be made only between 9 AM and 9 PM. Try again during calling hours.',
          )
          .last(),
      ).toBeVisible();
      return;
    }

    // D shows the number to dial.
    await page.keyboard.press('d');
    await expect(page.getByText('Number to dial')).toBeVisible();

    // 3 is Not reachable: the call is saved and the next try is set for tomorrow morning.
    await page.keyboard.press('3');
    await toast(page, /^Call saved\. Next try /);
    await expect(page.getByText('Next call back:')).toBeVisible();
    await expect(page.getByText('Tries without an answer: 1 of 3')).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Recent activity' }).getByText('Outcome: Not reachable'),
    ).toBeVisible();

    // The retry is a task on the customer's page.
    await page.getByRole('link', { name: 'Open customer' }).click();
    await expect(page.getByRole('heading', { name: unanswered, level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Tasks' }).getByText(/Call back/)).toBeVisible();
    await page.goto('/calling');

    // 2 is Call back later: the time is asked for, and Enter saves the call.
    await findLead(page, callback);
    await page.keyboard.press('2');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'When should we call back?' })).toBeVisible();
    await expect(dialog.getByLabel('Call back at')).toBeFocused();
    await expectNoAxeViolations(page);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await toast(page, /^Call saved\. Call back /);
    await expect(page.getByText('Next call back:')).toBeVisible();

    // 8 is Qualified: the lead moves to the Qualified stage.
    await findLead(page, qualified);
    await page.keyboard.press('8');
    await toast(page, 'Call saved. The lead moved to Qualified.');
    // A present Lead Converter takes a qualified lead within a moment (handover.spec.ts), so the
    // page shows the lead at Qualified or already says it has moved to a colleague.
    await expect(
      page.getByText(/Farmer Pumps, Qualified/).or(page.getByText(/We couldn't find this lead/)),
    ).toBeVisible();

    // N opens the next lead of the queue.
    await page.keyboard.press('n');
    await expect(page.getByRole('heading', { level: 2, name: qualified })).toHaveCount(0);
  });
});

test.describe('calling as a sales team lead', () => {
  test.use(signedInAs('teamLead'));

  test('sees the team’s queues and opens a caller’s queue', async ({ page }) => {
    await page.goto('/calling?view=team');
    await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();
    const table = page.getByRole('table', { name: 'Team queues' });
    await expect(table.getByRole('rowheader', { name: 'Neha Saini' })).toBeVisible();
    await expectNoAxeViolations(page);
    await table.getByRole('link', { name: "Open Neha Saini's queue" }).click();
    await expect(page.getByRole('heading', { name: "Neha Saini's queue", level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Queue', level: 2 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to my team' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('calling in the snapshot company', () => {
  test.use(signedInAs('snapshotCaller'));

  test('shows the caller’s queue, oldest lead first, and its workspace', async ({ page }) => {
    await page.goto('/calling');
    const queue = page.getByRole('region', { name: 'Queue' });
    for (const lead of SNAPSHOT_LEADS) {
      await expect(queue.getByRole('button', { name: new RegExp(lead.name) })).toBeVisible();
    }
    const first = SNAPSHOT_LEADS[0].name;
    await expect(page.getByRole('heading', { name: first, level: 2 })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'calling', { mask: [page.getByText(/\b20\d\d\b/)] });
  });
});
