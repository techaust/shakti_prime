import type { Page } from '@playwright/test';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { callingHours, setClocks } from './support/clock';

// T3 Click-to-dial (docs/03-roadmap-appendix/phase2.md §6.3, PRD TEL-01 and TEL-04) on the
// simulated provider the journeys' app uses when no Exotel account is set (nothing rings): the
// tele-caller adds their own phone on the profile, calls a lead of company 1 (whose calling
// numbers are seeded, seed.ts) from the Cold Caller workspace with C, watches the call ring, go on
// the line and end on the call bar, and saves its outcome; outside calling hours the bar lists the
// broken rule and nothing is placed.
//
// Each test that dials first moves both clocks, the server's and the browser's, onto the run's line
// for its side of the calling hours (11 AM in India inside them, 10 PM outside them, at the run's
// start) on every run, whatever the wall clock says (e2e/support/clock.ts): the moved path is the
// one every run takes, so a run before 9:20 AM and one at noon take the same steps, and each test
// and retry starts after the calls the earlier ones placed (slice-integration §10).

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

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

/** Opens a lead in the Cold Caller workspace through its search; the workspace has the keyboard. */
async function openInWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/calling');
  await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();
  const search = await hydrated(page.getByRole('searchbox', { name: /Find a lead/ }));
  await search.fill(name);
  await search.press('Enter');
  const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
  await expect(hit).toContainText(name);
  await hit.focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name, level: 2 });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

/** Opens another lead from the workspace's own search, keeping the page (and its call bar). */
async function switchTo(page: Page, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: /Find a lead/ });
  await search.fill(name);
  await search.press('Enter');
  const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
  await expect(hit).toContainText(name);
  await hit.focus();
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { name, level: 2 });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
}

/** The tele-caller's own phone for calls, set on the profile (the same number each run). */
async function ownPhone(page: Page): Promise<void> {
  await page.goto('/settings/profile');
  const section = page.locator('#dial-phone');
  await expect(section.getByRole('heading', { name: 'Your phone for calls' })).toBeVisible();
  const field = await hydrated(section.getByLabel('Your phone number'));
  await field.fill('98000 00191');
  await expectNoAxeViolations(page);
  await section.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Your phone for calls is saved.')).toBeVisible({ timeout: 30_000 });
  await expect(field).toHaveValue('+91 98000 00191');
}

test.describe('click-to-dial as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));
  // One after another: the tele-caller's dials share one person, and a second dial within a
  // minute of one still ringing is refused (`dial_in_progress`), so two at once would collide.
  test.describe.configure({ mode: 'default' });

  test('keeps a lead’s dialled call when another lead’s call is saved (T3 re-check 12)', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await setClocks(context, callingHours('inside'));
    await ownPhone(page);
    const other = await addLead(page, 'Mohan Lal Jangid');
    const dialledLead = await addLead(page, 'Kamla Devi Saini');
    await openInWorkspace(page, dialledLead);
    const bar = page.getByRole('region', { name: 'Call from the screen' });
    await expect(bar.getByRole('button', { name: /^Call/ })).toBeEnabled();
    await page.keyboard.press('c');
    const ended = bar.getByText('The call has ended. Choose its outcome to save it.');
    await expect(ended).toBeVisible({ timeout: 30_000 });

    // Another lead, its call dialled by hand and saved, before this one is saved.
    await switchTo(page, other);
    await expect(ended).toHaveCount(0);
    await page.keyboard.press('d');
    await expect(page.getByText('Number to dial')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByText(/^Call saved\. /).first()).toBeVisible();

    // Back on the dialled lead, its call still waits for its outcome, and saves as itself.
    await switchTo(page, dialledLead);
    await expect(ended).toBeVisible();
    await page.keyboard.press('3');
    await expect(
      page.getByRole('region', { name: 'Recent activity' }).getByText('Outcome: Not reachable'),
    ).toBeVisible();
    await expect(page.getByText('This call is saved already.')).toHaveCount(0);
    await expect(ended).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('refuses a phone that is not a mobile number on the profile', async ({ page }) => {
    await page.goto('/settings/profile');
    const section = page.locator('#dial-phone');
    const field = await hydrated(section.getByLabel('Your phone number'));
    await field.fill('12345');
    await section.getByRole('button', { name: 'Save' }).click();
    await expect(
      section.getByText('Please check the phone number. Enter the 10-digit mobile number.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('calls a lead from the screen with C, saves the call with its time, and its recording plays', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(180_000);
    await setClocks(context, callingHours('inside'));
    await ownPhone(page);
    const lead = await addLead(page, 'Bhagwati Devi Kumawat');
    await openInWorkspace(page, lead);

    const bar = page.getByRole('region', { name: 'Call from the screen' });
    await expect(bar.getByText('Say this first:')).toBeVisible();
    await expect(bar.getByText(/record ho sakti hai/)).toBeVisible();
    await expect(bar.getByRole('button', { name: /^Call/ })).toBeEnabled();
    await expectNoAxeViolations(page);

    await page.keyboard.press('c');
    const status = bar.getByRole('status');
    await expect(status).toContainText(/Ringing|Placing the call|On the line/);
    await expect(status).toContainText('On the line', { timeout: 15_000 });
    await expect(bar.getByRole('button', { name: /^Call/ })).toBeDisabled();
    await expectNoAxeViolations(page);
    await expect(status).toContainText('Call ended', { timeout: 15_000 });
    await expect(status).toContainText('0:03');
    await expect(bar.getByText('The call has ended. Choose its outcome to save it.')).toBeVisible();
    await expectNoAxeViolations(page);
    // The viewport only: the timeline below grows with every call the journeys log on this database,
    // and the queue (masked) grows with every lead they add, so its box is held at one height.
    await page.getByRole('region', { name: 'Queue' }).evaluate((el) => {
      Object.assign((el as HTMLElement).style, { height: '320px', overflow: 'hidden' });
    });
    // The call bar in the middle of the viewport, so each run pictures the same part of the page.
    await bar.evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
    });
    await snap(page, 'call-bar-ended', {
      fullPage: false,
      mask: [
        page.getByRole('region', { name: 'Queue' }),
        page.getByRole('searchbox', { name: /Find a lead/ }),
        page.getByRole('heading', { level: 2, name: lead }),
        page.getByRole('region', { name: 'Recent activity' }),
        page.getByRole('region', { name: 'How this call would go out' }),
        page.getByText(/\b20\d\d\b/),
        page.getByText(/^Phone ending /),
      ],
    });

    // 3 is Not reachable: the call is saved as the provider reported it.
    await page.locator('body').press('3');
    await expect(page.getByText(/^Call saved\. Next try /).first()).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Recent activity' }).getByText('Outcome: Not reachable'),
    ).toBeVisible();

    // The bar starts afresh, and a call dialled by hand next on the same lead saves as its own.
    await expect(bar.getByRole('status')).toHaveCount(0);
    await expect(bar.getByText('The call has ended. Choose its outcome to save it.')).toHaveCount(
      0,
    );
    await expect(bar.getByRole('button', { name: /^Call/ })).toBeEnabled();
    const heading = page.getByRole('heading', { name: lead, level: 2 });
    await heading.focus();
    await page.keyboard.press('d');
    await expect(page.getByText('Number to dial')).toBeVisible();
    await page.keyboard.press('3');
    await expect(page.getByText(/^Call saved\. /).first()).toBeVisible();
    await expect(page.getByText('This call is saved already.')).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Recent activity' }).getByText('Outcome: Not reachable'),
    ).toHaveCount(2);
    const customer = await page.getByRole('link', { name: 'Open customer' }).getAttribute('href');

    // An Executive hears the call's recording on the customer's page (the simulated provider
    // records every call): the address is the store's, which the page's policy lets play.
    const executive = await browser.newContext({
      storageState: signedInAs('executive').storageState,
    });
    try {
      const own = await executive.newPage();
      await own.goto(customer ?? '/customers');
      const play = own.getByRole('button', { name: 'Play recording' }).first();
      await (await hydrated(play)).click();
      const audio = own.getByLabel('Recording of the call').first();
      await expect(audio).toBeVisible();
      await expect
        .poll(() => audio.evaluate((el) => (el as HTMLAudioElement).readyState), {
          timeout: 15_000,
        })
        .toBeGreaterThan(0);
      expect(await audio.evaluate((el) => (el as HTMLAudioElement).error)).toBeNull();
      await expectNoAxeViolations(own);
    } finally {
      await executive.close();
    }
  });

  test('keeps counting a call on a phone whose clock runs hours fast', async ({ page, context }) => {
    test.setTimeout(180_000);
    // The browser's clock five hours ahead of the server's: the bar counts on the server's clock,
    // so it neither counts from the wrong moment nor stops reading the call after "three hours".
    await setClocks(context, callingHours('inside'), { deviceAheadMs: 5 * 3_600_000 });
    await ownPhone(page);
    const lead = await addLead(page, 'Kesar Devi Meena');
    await openInWorkspace(page, lead);
    const bar = page.getByRole('region', { name: 'Call from the screen' });
    await expect(bar.getByRole('button', { name: /^Call/ })).toBeEnabled();
    await page.keyboard.press('c');
    const status = bar.getByRole('status');
    const time = status.getByLabel('Time on the call');
    await expect(status).toContainText(/Ringing|On the line|Call ended/, { timeout: 15_000 });
    // Seconds from the press, never the five hours the phone's clock adds.
    await expect(time).toHaveText(/^0:0\d$/);
    await expect(status).toContainText('Call ended', { timeout: 15_000 });
    await expect(time).toHaveText('0:03');
    await page.locator('body').press('3');
    await expect(page.getByText(/^Call saved\. Next try /).first()).toBeVisible();
    await expect(bar.getByRole('status')).toHaveCount(0);
  });

  test('lists the broken rule and places nothing outside calling hours', async ({
    page,
    context,
  }) => {
    await setClocks(context, callingHours('outside'));
    await ownPhone(page);
    const lead = await addLead(page, 'Suresh Chand Gurjar');
    await openInWorkspace(page, lead);
    const bar = page.getByRole('region', { name: 'Call from the screen' });
    await (await hydrated(bar.getByRole('button', { name: /^Call/ }))).click();
    await expect(bar.getByRole('alert')).toContainText('This call cannot be placed now:');
    await expect(bar.getByRole('alert').getByRole('listitem')).not.toHaveCount(0);
    await expect(
      bar
        .getByRole('alert')
        .getByRole('listitem')
        .filter({ hasText: 'It is outside calling hours. Calls can be made from 9 AM to 9 PM.' }),
    ).toHaveCount(1);
    await expect(bar.getByRole('status')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});
