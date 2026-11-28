import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from '@playwright/test';
import { newId } from '@shakti/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  POP_CUSTOMERS,
  POP_DIAL_PHONES,
  POP_IVR,
  passthruNumber,
  popCallerKey,
} from '../../e2e/screen-pop-fixtures';
import { INSIDE_CALLING_HOURS_MINUTE, shiftToIstMinute } from '../../e2e/support/clock';
import { standInForTurnstile } from '../../e2e/support/turnstile';
import { E2E_PASSWORD, emailFor } from '../../e2e/support/users';
import { dialLeadPhone } from '../../scripts/measures/safety';
import { percentiles, shareWithin, type Percentiles } from '../../scripts/measures/stats';
import { TEST_WEBHOOK_ENV } from '../../src/webhooks/signed-deliveries';

/**
 * The two measures a person sees in the browser (docs/03-roadmap-appendix/phase2.md §8.1), in
 * headless Chromium against the measuring server, signed in through the real screens as the
 * journeys' seeded people (`pnpm --filter web e2e:seed` first):
 * - the dial: from the Dial key (`C`) in the Cold Caller workspace to the call bar showing the call
 *   accepted ("Ringing", or a later state when the simulated provider moved on first), on T3's
 *   simulated provider (no Exotel account is set, nothing rings); PRD TEL-01's 2 seconds;
 * - the screen-pop: from Exotel's Passthru call (the real route, `/webhooks/exotel/incoming/<secret>`)
 *   to the caller's page holding the call (the ringing route's answer carrying it), with the call
 *   placed at a random moment of the 3-second poll; PRD TEL-05's 2 seconds. The transport is the
 *   one the server runs: the poll locally; Realtime on a server with `SCREEN_POP_TRANSPORT=realtime`
 *   and its project's keys, seen here as the page's socket to the project.
 */

export const DIAL_TARGET_MS = 2_000;
export const POP_TARGET_MS = 2_000;
/** The journeys' clock cookie (`e2e/support/clock.ts`): honoured only by a local production run. */
const TEST_CLOCK_COOKIE = 'bos-test-clock';
const STEP_TIMEOUT_MS = 30_000;

export interface Person {
  email: string;
  password: string;
}

async function newContext(browser: Browser, baseUrl: string): Promise<BrowserContext> {
  const context = await browser.newContext({
    baseURL: baseUrl,
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    viewport: { width: 1280, height: 800 },
    // Its own address, so the sign-in caps count this run alone (as playwright.config.ts does).
    extraHTTPHeaders: { 'x-forwarded-for': `10.250.${String(Math.floor(Math.random() * 250))}.7` },
  });
  context.setDefaultTimeout(STEP_TIMEOUT_MS);
  await standInForTurnstile(context);
  return context;
}

/** Signs in through the screens (no second check: both people are tele-callers). */
async function signIn(page: Page, person: Person): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(person.email);
  await page.getByLabel('Password', { exact: true }).fill(person.password);
  await page.waitForFunction(() => {
    const field = document.querySelector<HTMLInputElement>('input[name="cf-turnstile-response"]');
    return field !== null && field.value !== '';
  });
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/home');
}

/** A mobile number no earlier round used, typed as a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** A new lead of company 1 with this phone, through the New lead form, as the journey adds one. */
async function addLead(page: Page, phone: string): Promise<string> {
  const name = `Measure Dial ${String(Date.now()).slice(-6)}`;
  await page.goto('/leads/new');
  await page.getByLabel('Customer name').fill(name);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel('Line of business').selectOption({ label: 'Farmer Pumps' });
  await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
  await page.getByRole('button', { name: 'Save lead' }).click();
  await page.getByText(`Lead saved for ${name}.`).waitFor();
  return name;
}

/** The lead open in the Cold Caller workspace, which then has the keyboard. */
async function openInWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/calling');
  const search = page.getByRole('searchbox', { name: /Find a lead/ });
  await search.waitFor();
  // The search answers only once the page has hydrated: type again until it does.
  const hits = page.getByRole('list', { name: 'Leads found' }).getByRole('button');
  for (let tries = 0; tries < 20; tries += 1) {
    await search.fill(name);
    await search.press('Enter');
    try {
      await hits.first().waitFor({ timeout: 2_000 });
      break;
    } catch {
      // Not hydrated yet.
    }
  }
  await hits.first().focus();
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name, level: 2 }).waitFor();
}

export interface DialMiss {
  round: number;
  /** The step that did not finish within its 30 seconds. */
  step: string;
  /** What the call bar showed then, for the cause. */
  bar?: string;
}

export interface DialResult {
  rounds: number;
  /** From the key to the call bar showing the call accepted; a missed round counts 30,000 ms. */
  accepted: Percentiles;
  /** From the key to the dial action's answer. */
  action: Percentiles;
  within2s: number;
  misses: DialMiss[];
  actionUnread: number;
}

/** A step that did not finish, named for the report. */
class StepMissed extends Error {
  constructor(readonly step: string) {
    super(step);
  }
}

function step<T>(name: string, work: Promise<T>): Promise<T> {
  return work.catch(() => {
    throw new StepMissed(name);
  });
}

/**
 * `rounds` dials, each saved as Not reachable before the next. The lead's phone comes from
 * `dialLeadPhone()`: made up, a new lead each round, only on the server started here, whose
 * provider is simulated; otherwise the phone the owner's people answer (`G2_DIAL_LEAD_PHONE`), one
 * lead for every round, else the run is refused before the browser opens. A round whose step does not finish within 30 seconds is a miss of
 * 30,000 ms with that step named, and the run goes on.
 */
export async function measureDial(options: {
  baseUrl: string;
  rounds: number;
  person?: Person;
  /** The caller's own phone the call rings first, as typed; the journeys' number by default. */
  dialPhone?: string;
  /** The lead's phone; required unless the server was started here. */
  leadPhone?: string;
  /** The server was started here, with no vendor credential (and so the simulated provider). */
  serverStartedHere: boolean;
}): Promise<DialResult> {
  // Refused here, before the browser opens, when no phone may be dialled.
  const phoneFor = () =>
    dialLeadPhone({
      serverStartedHere: options.serverStartedHere,
      leadPhone: options.leadPhone,
      madeUp: freshMobile,
    });
  const firstPhone = phoneFor();
  // A made-up lead each round on the simulated provider; one lead, the given phone, elsewhere (its
  // tries without an answer stop at 3, so such a run takes `--rounds 3`).
  const leadPerRound = (options.leadPhone?.trim() ?? '') === '';
  const person = options.person ?? { email: emailFor('teleCaller'), password: E2E_PASSWORD };
  // A real call lasts as long as the people on it; the simulated one ends in seconds.
  const callMs = options.serverStartedHere ? STEP_TIMEOUT_MS : 600_000;
  const browser = await chromium.launch();
  const accepted: number[] = [];
  const action: number[] = [];
  const misses: DialMiss[] = [];
  /** Rounds whose dial action's answer could not be read (the accepted time still counts). */
  let actionUnread = 0;
  try {
    const context = await newContext(browser, options.baseUrl);
    if (options.serverStartedHere) {
      // The journeys' clock, which only a local production run honours: inside calling hours,
      // moved on every run (never by the wall clock's choice) and once for all its rounds, so it
      // runs forward from round to round.
      const shift = shiftToIstMinute(INSIDE_CALLING_HOURS_MINUTE);
      await context.addCookies([
        { name: TEST_CLOCK_COOKIE, value: String(shift), url: options.baseUrl },
      ]);
    }
    const page = await context.newPage();
    await signIn(page, person);
    // The caller's own phone for calls, which the call rings first.
    await page.goto('/settings/profile');
    const section = page.locator('#dial-phone');
    await section.getByLabel('Your phone number').fill(options.dialPhone ?? '98000 00191');
    await section.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Your phone for calls is saved.').waitFor();
    const oneLead = leadPerRound ? undefined : await addLead(page, firstPhone);

    for (let round = 0; round < options.rounds; round += 1) {
      const bar = page.getByRole('region', { name: 'Call from the screen' });
      try {
        const lead =
          oneLead ??
          (await step('the lead added', addLead(page, round === 0 ? firstPhone : phoneFor())));
        await step('the lead opened in the workspace', openInWorkspace(page, lead));
        const callButton = bar.getByRole('button', { name: /^Call/ });
        await step('the Dial key offered', callButton.waitFor());
        if (!(await callButton.isEnabled())) throw new StepMissed('the Dial key offered');
        // Every server action's answer from the key on, stamped as it arrives; the dial action's is
        // the one that carries the placed call (`kind: 'placed'`), read once the bar has shown it.
        const answers: { at: number; text: Promise<string> }[] = [];
        const onAnswer = (r: Response) => {
          if (r.request().method() !== 'POST') return;
          if (r.request().headers()['next-action'] === undefined) return;
          answers.push({ at: Date.now(), text: r.text().catch(() => '') });
        };
        page.on('response', onAnswer);
        const t0 = Date.now();
        try {
          await page.keyboard.press('c');
          await step(
            'the call bar showing the call accepted',
            bar
              .getByRole('status')
              .filter({ hasText: /Ringing|On the line|Call ended/ })
              .waitFor(),
          );
          accepted.push(Date.now() - t0);
          let found = false;
          for (const answer of answers) {
            if ((await answer.text).includes('"placed"')) {
              action.push(answer.at - t0);
              found = true;
              break;
            }
          }
          if (!found) actionUnread += 1;
        } finally {
          page.off('response', onAnswer);
        }
      } catch (error) {
        if (!(error instanceof StepMissed)) throw error;
        accepted.push(STEP_TIMEOUT_MS);
        const shownThen = await bar.innerText({ timeout: 2_000 }).catch(() => '');
        misses.push({ round, step: error.step, bar: shownThen.replace(/\s+/g, ' ').slice(0, 400) });
        console.error(`round ${String(round + 1)}: ${error.step} did not finish in 30 seconds`);
      }
      // The call ends by itself; its outcome saved, the bar starts afresh for the next round.
      try {
        await bar
          .getByRole('status')
          .filter({ hasText: 'Call ended' })
          .waitFor({ timeout: callMs });
        await page.locator('body').press('3');
        await page
          .getByText(/^Call saved\. /)
          .first()
          .waitFor();
      } catch {
        misses.push({ round, step: 'the call ended and its outcome saved' });
        console.error(`round ${String(round + 1)}: the call's outcome was not saved`);
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return {
    rounds: options.rounds,
    accepted: percentiles(accepted),
    action: percentiles(action),
    within2s: shareWithin(accepted, DIAL_TARGET_MS),
    misses,
    actionUnread,
  };
}

export interface ScreenPopResult {
  rounds: number;
  transport: 'poll' | 'realtime';
  /** From the Passthru call to the ringing route's answer carrying the call. */
  pop: Percentiles;
  /** From the Passthru call to its own answer (the store, before the page asks). */
  passthru: Percentiles;
  within2s: number;
}

export interface PopSetup {
  person: Person;
  /** The secret path segment of the Passthru address. */
  incomingSecret: string;
  /** The company's incoming calls number, and the person's own phone, as Passthru writes them. */
  callTo: string;
  dialWhom: string;
  /** A number several of the person's customers share, so the pop opens no page of its own. */
  callFrom: string;
}

/** The journeys' screen-pop caller of the desktop-light project and the seeded numbers. */
export function journeyPopSetup(): PopSetup {
  const project = 'desktop-light';
  return {
    person: { email: emailFor(popCallerKey(project)), password: E2E_PASSWORD },
    incomingSecret: TEST_WEBHOOK_ENV.EXOTEL_INCOMING_SECRET,
    callTo: POP_IVR.national,
    dialWhom: passthruNumber(POP_DIAL_PHONES[project]),
    callFrom: passthruNumber(POP_CUSTOMERS[project].shared.phone),
  };
}

/** `rounds` calls, each at a random moment of the poll, each card closed before the next. */
export async function measureScreenPop(options: {
  baseUrl: string;
  rounds: number;
  setup: PopSetup;
}): Promise<ScreenPopResult> {
  const { setup } = options;
  const browser = await chromium.launch();
  const pops: number[] = [];
  const passthru: number[] = [];
  // Set from the page's socket events, which the type checker cannot follow.
  const seen = { realtime: false };
  try {
    const context = await newContext(browser, options.baseUrl);
    const page = await context.newPage();
    page.on('websocket', (socket) => {
      if (socket.url().includes('/realtime/')) seen.realtime = true;
    });
    await signIn(page, setup.person);
    const firstAsk = page.waitForResponse((r) => r.url().includes('/api/v1/calls/ringing'));
    await page.goto('/home');
    await firstAsk;
    for (let round = 0; round < options.rounds; round += 1) {
      // A customer calls at any moment of the poll.
      await sleep(Math.floor(Math.random() * 3_000));
      const arrived = page.waitForResponse(
        (r) => r.url().includes('/api/v1/calls/ringing') && r.status() === 200,
        { timeout: 15_000 },
      );
      const query = new URLSearchParams({
        CallSid: `g2pop${newId().replaceAll('-', '')}`,
        CallFrom: setup.callFrom,
        CallTo: setup.callTo,
        Direction: 'incoming',
        CallType: 'call-attempt',
        DialWhomNumber: setup.dialWhom,
      });
      const url = new URL(
        `/api/v1/webhooks/exotel/incoming/${setup.incomingSecret}?${query.toString()}`,
        options.baseUrl,
      );
      const t0 = Date.now();
      const answer = await fetch(url);
      await answer.arrayBuffer();
      passthru.push(Date.now() - t0);
      if (answer.status !== 200) throw new Error(`Passthru answered ${String(answer.status)}`);
      const held = await arrived;
      await held.finished();
      pops.push(Date.now() - t0);
      const card = page.getByRole('region', { name: 'Incoming call' });
      await card.waitFor();
      await card.getByRole('button', { name: 'Close the incoming call' }).click();
      await card.waitFor({ state: 'detached' });
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return {
    rounds: options.rounds,
    transport: seen.realtime ? 'realtime' : 'poll',
    pop: percentiles(pops),
    passthru: percentiles(passthru),
    within2s: shareWithin(pops, POP_TARGET_MS),
  };
}
