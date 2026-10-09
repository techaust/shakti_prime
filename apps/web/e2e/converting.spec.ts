import type { Page } from '@playwright/test';
import {
  CONVERTING_ITEM,
  CONVERTING_LEADS,
  converterKey,
  type ConvertingLead,
} from './converting-fixtures';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { signInThroughScreens } from './support/sign-in';
import { emailFor } from './support/users';

// The Lead Converter workspace (PRD TEL-03, docs/03-roadmap-appendix/phase1.md §9). The seed gives each project
// a converter of its own, not a handover target, with three rooftop leads at Qualified
// (`e2e/setup/converting.ts`): one with a callback due and no sizing, one with a sent quote that runs
// out within a day, and one with an order held for credit. The journey works the first from the
// keyboard: a call, a sizing and a quote without leaving the screen, and the list of what to do
// next changes with each.

/**
 * Calls may be saved and numbers shown only from 9 AM to 9 PM in India (TRAI). The journey runs
 * whenever CI runs, so outside those hours it checks that the workspace says so instead.
 */
function inCallingHours(at = new Date()): boolean {
  const minutes = (Math.floor(at.getTime() / 60_000) + 330) % 1440;
  // A margin at each end, so the hour does not change in the middle of the journey.
  return minutes >= 9 * 60 + 5 && minutes < 21 * 60 - 10;
}

const HOURS_SENTENCE =
  'Calls can be made only between 9 AM and 9 PM. Try again during calling hours.';

const board = (page: Page) => page.getByRole('region', { name: 'Your leads' });
const next = (page: Page) => page.getByRole('region', { name: 'What to do next' });
const rows = (page: Page) => next(page).getByRole('listitem');
const name = (lead: ConvertingLead) => CONVERTING_LEADS[lead].name;
const card = (page: Page, lead: ConvertingLead) =>
  board(page).getByRole('button', { name: new RegExp(name(lead)) });
const heading = (page: Page, lead: ConvertingLead) =>
  page.getByRole('heading', { name: name(lead), level: 2 });
const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByText(text).first()).toBeVisible();

/** Presses a key of the workspace once the page has hydrated: a key pressed before then does nothing. */
async function press(page: Page, key: string, until: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.locator('body').press(key);
    await until();
  }).toPass({ timeout: 15_000 });
}

test.describe('converting as a Lead Converter', () => {
  test('works a lead from the keyboard: a call, a sizing and a quote, and the list follows', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await signInThroughScreens(page, emailFor(converterKey(projectName())));
    await page.goto('/converting');
    await expect(page.getByRole('heading', { name: 'Converting', level: 1 })).toBeVisible();

    // The board holds the three leads, all at Qualified.
    await expect(board(page).getByRole('heading', { name: /^Qualified/, level: 3 })).toBeVisible();
    for (const lead of ['work', 'expiring', 'held'] as const) {
      await expect(card(page, lead)).toBeVisible();
    }

    // The list the rules make: each lead and why, the most urgent first.
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).nth(0)).toContainText(`${name('work')}Call back due`);
    await expect(rows(page).nth(1)).toContainText(`${name('expiring')}Quote runs out`);
    await expect(rows(page).nth(2)).toContainText(`${name('held')}Order held for credit since`);
    await expect(rows(page).nth(3)).toContainText(`${name('work')}Sizing needed before a quote`);
    await expectNoAxeViolations(page);

    // J takes the keyboard to a lead of the board and Enter opens it.
    await press(page, 'j', async () => {
      await expect(board(page).locator('button:focus')).toHaveCount(1, { timeout: 1_000 });
    });
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { level: 2, name: /Dhanna Ram|Hari Singh|Bhanwari Devi/ }),
    ).toBeFocused();

    // ? shows the keys.
    await press(page, '?', async () => {
      await expect(page.getByText('Log a call', { exact: true })).toBeVisible({ timeout: 1_000 });
    });
    await page.keyboard.press('?');
    await expect(page.getByText('Log a call', { exact: true })).toBeHidden();

    // / finds the lead by name, as on the calling screen.
    const search = page.getByRole('searchbox', { name: /Find a lead/ });
    await press(page, '/', async () => {
      await expect(search).toBeFocused({ timeout: 1_000 });
    });
    await page.keyboard.type(name('work'));
    await page.keyboard.press('Enter');
    const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
    await expect(hit).toContainText(name('work'));
    await hit.focus();
    await page.keyboard.press('Enter');
    await expect(heading(page, 'work')).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Calls', selected: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'converting-board', {
      mask: [page.getByRole('region', { name: 'Recent activity' })],
    });

    // The sizing: S opens it on the rooftop tab; the figures are typed and Enter saves.
    await press(page, 's', async () => {
      await expect(page.getByLabel('Units used a month (kWh)')).toBeVisible({ timeout: 1_000 });
    });
    await expect(page.getByRole('tab', { name: 'Sizing', selected: true })).toBeVisible();
    await expect(page.getByLabel('Units used a month (kWh)')).toBeFocused({ timeout: 10_000 });
    await page.getByLabel('Units used a month (kWh)').fill('300');
    await page.getByLabel('Shade-free roof area (m²)').fill('40');
    await page.getByLabel('Sanctioned load (kW)').fill('5');
    await page.keyboard.press('Enter');
    await toast(page, 'Sizing saved.');
    // The list follows: the sizing is no longer asked for, and the card and summary show the size.
    await expect(rows(page).filter({ hasText: 'Sizing needed before a quote' })).toHaveCount(0);
    await expect(card(page, 'work')).toContainText('kWp');

    // The quote: Q opens the builder of the lead in place; nothing leaves the screen.
    await press(page, 'q', async () => {
      await expect(page.getByLabel('Item or kit')).toBeVisible({ timeout: 1_000 });
    });
    await expect(page.getByRole('tab', { name: 'Quote', selected: true })).toBeVisible();
    await page.getByLabel('Item or kit').selectOption({ label: CONVERTING_ITEM.option });
    await page.getByLabel('Quantity').fill('5');
    await page.getByRole('button', { name: 'Work out the quote' }).click();
    const preview = page.getByRole('region', { name: 'The quote as it will be made' });
    // Five modules at ₹12,000 with 12% GST: ₹60,000 and ₹7,200 of tax.
    await expect(preview.getByText('₹67,200.00').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await page.getByRole('button', { name: 'Make the quote' }).click();
    const made = page.getByRole('status').filter({ hasText: /^Quote .+ is made\./ });
    await expect(made).toBeVisible({ timeout: 60_000 });
    await expect(made.getByRole('link', { name: 'Open quote' })).toBeVisible();
    await expect(page).toHaveURL(/\/converting$/);
    await expect(card(page, 'work')).toContainText('Not sent yet');
    // A quote with days left is not about to run out: the list is the three rows left, the call
    // back of this lead among them, whatever the hour.
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).filter({ hasText: name('work') })).toHaveCount(1);
    await expectNoAxeViolations(page);
    await snap(page, 'converting-quote', {
      mask: [page.getByRole('region', { name: 'Recent activity' })],
    });

    // The call, last, since the hour of the day decides what it does: D shows the number and C sets
    // the callback, with the time asked for in a dialog.
    if (inCallingHours()) {
      await page.keyboard.press('d');
      await expect(page.getByText('Number to dial')).toBeVisible();
      await page.keyboard.press('c');
      const dialog = page.getByRole('dialog');
      await expect(
        dialog.getByRole('heading', { name: 'When should we call back?' }),
      ).toBeVisible();
      await expect(dialog.getByLabel('Call back at')).toBeFocused();
      await expectNoAxeViolations(page, { include: '[role="dialog"]' });
      await page.keyboard.press('Enter');
      await expect(dialog).toBeHidden();
      await toast(page, /^Call saved\. Call back /);
      // The callback that was due is done and the new one is for tomorrow, so its row is gone.
      await expect(rows(page).filter({ hasText: 'Call back due' })).toHaveCount(0);
      await expect(rows(page)).toHaveCount(2);
    } else {
      // Outside 9 AM to 9 PM the number stays hidden and no call can be saved.
      await page.keyboard.press('d');
      await expect(page.getByText(HOURS_SENTENCE)).toBeVisible();
    }

    // N opens the first row of the list; each row opens its lead at the part it is about.
    const first = inCallingHours() ? 'expiring' : 'work';
    await press(page, 'n', async () => {
      await expect(heading(page, first)).toBeFocused({ timeout: 1_000 });
    });
    if (first === 'expiring') {
      await expect(page.getByRole('tab', { name: 'Quote', selected: true })).toBeVisible();
    }
    await rows(page).filter({ hasText: 'Order held for credit since' }).getByRole('button').click();
    await expect(heading(page, 'held')).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Order', selected: true })).toBeVisible();
    await expect(page.getByText(/The credit check is holding order /)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open order' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('converting as a tele-caller who makes no quotes', () => {
  test.use(signedInAs('teleCaller'));

  test('has no Converting screen', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('link', { name: 'Converting' })).toHaveCount(0);
    await page.goto('/converting');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
  });
});

test.describe('converting as a Sales Team Lead', () => {
  test.use(signedInAs('teamLead'));

  test('opens the leads of a person of the team', async ({ page }) => {
    await page.goto('/converting?view=team');
    await expect(page.getByRole('heading', { name: 'Converting', level: 1 })).toBeVisible();
    const list = page.getByRole('list', { name: 'People of your team' });
    await expect(list.getByText('Kishan Verma')).toBeVisible();
    await expectNoAxeViolations(page);
    await list.getByRole('link', { name: "Open Kishan Verma's leads" }).click();
    await expect(
      page.getByRole('heading', { name: "Kishan Verma's leads", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Your leads' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to my team' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
