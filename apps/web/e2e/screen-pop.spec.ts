import type { APIRequestContext, Page } from '@playwright/test';
import {
  POP_CUSTOMERS,
  POP_DIAL_PHONES,
  POP_IVR,
  passthruNumber,
  popCallerKey,
} from './screen-pop-fixtures';
import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { signInThroughScreens } from './support/sign-in';
import { emailFor } from './support/users';

// T4 Screen-pop (docs/03-roadmap-appendix/phase2.md §7.4, PRD TEL-05). Each project's tele-caller
// of company 1 (screen-pop-fixtures.ts) waits on a page; a customer then calls company 1's incoming
// calls number and the IVR rings her own phone. The call comes through the journeys' simulated
// Passthru call (`/api/v1/calls/simulated-incoming`, answered only by this machine's local run),
// down the very route and handler a real call takes, and her page takes it on its 3-second poll:
// a known number opens the customer's page, a number two customers share lists them, and a new
// number opens the New lead form with the number filled in. Each wait from the call to the pop is
// written to the run's report (`pop-ms`).

/** The poll's own wait (3 seconds at most) and the call's way through the server, with room. */
const POP_WITHIN_MS = 6_000;

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** The caller's page, polling: the shell's screen-pop has asked the ringing route once. */
async function waiting(page: Page): Promise<void> {
  const asked = page.waitForResponse((r) => r.url().includes('/api/v1/calls/ringing'));
  await page.goto('/home');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect((await asked).status()).toBe(204);
  // A customer calls at any moment of the 3-second poll, so the wait the report notes is a fair
  // one rather than always the longest.
  await page.waitForTimeout(Math.floor(Math.random() * 3_000));
}

/**
 * A customer's call from `from` to company 1's incoming calls number, ringing the project's caller,
 * and her page's card once it shows. The wait from the call to the poll's answer carrying it is
 * noted in the report (`pop-ms`), timed by the answer itself rather than by a check that polls.
 */
async function callAndPop(page: Page, request: APIRequestContext, from: string) {
  const arrived = page.waitForResponse(
    (r) => r.url().includes('/api/v1/calls/ringing') && r.status() === 200,
    { timeout: POP_WITHIN_MS },
  );
  const rangAt = Date.now();
  const answer = await request.get('/api/v1/calls/simulated-incoming', {
    params: {
      Direction: 'incoming',
      CallSid: `e2epop${String(Date.now())}${String(Math.floor(Math.random() * 1e6))}`,
      CallFrom: passthruNumber(from),
      CallTo: POP_IVR.national,
      DialWhomNumber: passthruNumber(POP_DIAL_PHONES[projectName()]),
    },
  });
  expect(answer.status()).toBe(200);
  await arrived;
  test.info().annotations.push({ type: 'pop-ms', description: String(Date.now() - rangAt) });
  const card = page.getByRole('region', { name: 'Incoming call' });
  await expect(card).toBeVisible();
  return card;
}

test.describe('the screen-pop as a tele-caller', () => {
  // One caller per project, rung at one phone: her calls come one after another, never two at once.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await signInThroughScreens(page, emailFor(popCallerKey(projectName())));
  });

  test('a known number opens the customer’s page while it rings', async ({ page, request }) => {
    const { one } = POP_CUSTOMERS[projectName()];
    await waiting(page);
    const card = await callAndPop(page, request, one.phone);
    await expect(card.getByRole('alert')).toHaveText(`${one.name} is calling. Their page is open.`);
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+\?company=1$/);
    await expect(page.getByRole('heading', { name: one.name, level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
    // The card alone: the page behind it grows with the journeys' runs.
    await snap(page, 'screen-pop-customer', { element: card });
    await (await hydrated(card.getByRole('button', { name: 'Close the incoming call' }))).click();
    await expect(card).toHaveCount(0);
  });

  test('a number several customers share lists them, and one opens', async ({ page, request }) => {
    const { shared } = POP_CUSTOMERS[projectName()];
    await waiting(page);
    const card = await callAndPop(page, request, shared.phone);
    await expect(card.getByRole('alert')).toHaveText(
      '2 customers share this number. Open the one who is calling.',
    );
    const list = card.getByRole('list', { name: 'Customers with this number' });
    await expect(list.getByRole('link')).toHaveText([...shared.names]);
    // Nothing opens by itself: the page is still the caller's own.
    await expect(page).toHaveURL(/\/home$/);
    await expectNoAxeViolations(page);
    await snap(page, 'screen-pop-several', { element: card });
    await list.getByRole('link', { name: shared.names[1] }).click();
    await expect(page.getByRole('heading', { name: shared.names[1], level: 1 })).toBeVisible();
  });

  test('a new number opens the New lead form with the number filled in', async ({
    page,
    request,
  }) => {
    const number = freshMobile();
    await waiting(page);
    const card = await callAndPop(page, request, number);
    await expect(card.getByRole('alert')).toHaveText(
      `A new number ending ${number.slice(-4)} is calling. The new lead form is open with the number filled in.`,
    );
    await expect(page).toHaveURL(/\/leads\/new\?company=1$/);
    await expect(page.getByLabel('Mobile number')).toHaveValue(number);
    // The whole number shows only in the form's own box, never on the card.
    await expect(card).not.toContainText(number.replace(' ', ''));
    await expectNoAxeViolations(page);
    // The number's last four digits change with every run.
    await snap(page, 'screen-pop-new-lead', { element: card, mask: [card.getByRole('alert')] });
  });
});

test.describe('the screen-pop for someone who places no calls', () => {
  test.use(signedInAs('accounts'));

  test('is never set up, so no page of theirs asks', async ({ page }) => {
    let asked = false;
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/calls/ringing')) asked = true;
    });
    await page.goto('/home');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Longer than one poll: a caller's page would have asked by now.
    await page.waitForTimeout(3_500);
    expect(asked).toBe(false);
  });
});
