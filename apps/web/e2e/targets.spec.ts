import { expect, expectNoAxeViolations, signedInAs, snap, test } from './support/fixtures';
import { SNAPSHOT_TEAM } from './support/users';

// Targets and the home pages (docs/03-roadmap-appendix/phase1.md §9, PRD TEL-06 and RPT-01). The
// tele-caller and the team lead share the seed's calling team in company 1, and the seed logs two
// calls for the tele-caller today (calling is possible only from 9 AM to 9 PM, so a journey
// cannot; the seed logs them for today and tomorrow of the Indian calendar, so a run that crosses
// midnight finds them too). The figure of 40 is a value for these journeys alone, never a client
// target. The pages whose figures other journeys change are compared as pictures only for the
// snapshot company's own team, at the end of this file.

const DAILY_TARGET = '40';

test.describe('a team lead sets a caller’s target and the caller sees the progress', () => {
  test.describe.configure({ mode: 'serial' });

  test.describe('as the team lead', () => {
    test.use(signedInAs('teamLead'));

    test('sets the daily call target of the tele-caller', async ({ page }) => {
      await page.goto('/targets');
      await expect(page.getByRole('heading', { name: 'Targets', level: 1 })).toBeVisible();
      const form = page.getByRole('region', { name: 'Set a target' });
      await expect(form).toBeVisible();
      await expectNoAxeViolations(page);

      // Nothing is asked of a figure the client has not given: an empty target is refused.
      await form.getByLabel('For', { exact: true }).selectOption({ label: 'Neha Saini' });
      await form.getByRole('button', { name: 'Save target' }).click();
      await expect(form.getByText('Enter a number with at most two decimals')).toBeVisible();

      await form.getByLabel('What to count').selectOption({ label: 'Calls' });
      await form.getByLabel('Every', { exact: true }).selectOption({ label: 'Day' });
      await form.getByLabel('Target', { exact: true }).fill(DAILY_TARGET);
      await form.getByRole('button', { name: 'Save target' }).click();
      await expect(page.getByText('The target is saved.')).toBeVisible();

      const now = page.getByRole('table', { name: 'Targets in force today' });
      await expect(now.getByRole('row', { name: /Neha Saini.*Calls.*Day.*40/ })).toBeVisible();
      const history = page.getByRole('table', { name: 'Targets set, newest first' });
      await expect(
        history.getByRole('row', { name: /Neha Saini.*Calls.*Day.*40/ }).first(),
      ).toBeVisible();
      await expectNoAxeViolations(page);
      // The saved notice gone, and the starting date (today's) masked, so the picture holds every day.
      await expect(page.getByText('The target is saved.')).toBeHidden();
      // Targets is compared as a picture for the snapshot company's own team, below.
    });

    test('sees the team on the home page: its targets, the leaderboard and the queues', async ({
      page,
    }) => {
      await page.goto('/home');
      await expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Your team', level: 2, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText('No target is set for the team. Set one on the Targets page.'),
      ).toBeVisible();
      const board = page.getByRole('table', { name: /^Callers of your team with their Calls/ });
      const row = board.getByRole('row', { name: /Neha Saini/ });
      await expect(row).toBeVisible();
      await expect(row).toContainText('of 40');
      await expect(
        page.getByRole('heading', { name: 'Queues of your team', level: 2 }),
      ).toBeVisible();
      await expect(page.getByRole('table', { name: 'Team queues' })).toBeVisible();
      await expectNoAxeViolations(page);
      await snap(page, 'home-team-lead', {
        mask: [page.getByRole('table'), page.locator('main dl'), page.locator('time')],
      });

      // The week and the month are one click away.
      await page.getByRole('link', { name: 'This week' }).click();
      await expect(page).toHaveURL(/period=week/);
      await expect(
        page.getByRole('table', { name: /^Callers of your team with their Calls for This week/ }),
      ).toBeVisible();
    });
  });

  test.describe('as the tele-caller', () => {
    test.use(signedInAs('teleCaller'));

    test('sees the target with the progress of the calls logged today', async ({ page }) => {
      await page.goto('/home');
      await expect(page.getByRole('heading', { name: 'Your calls', level: 2 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Your targets', level: 2 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Today', level: 3 })).toBeVisible();
      const meter = page.getByRole('progressbar', { name: /^Calls: \d+ of 40$/ });
      await expect(meter).toBeVisible();
      // The two calls the seed logged today, and any a calling journey saved; the bar stops at full
      // once the day's calls pass the target, as they do on a database several runs have used.
      // The label and the bar are read together, since a calling journey may save a call between.
      const read = () =>
        meter.evaluate((el) => ({
          label: el.getAttribute('aria-label') ?? '',
          now: el.getAttribute('aria-valuenow') ?? '',
        }));
      const { label } = await read();
      expect(Number(/: (\d+) of/.exec(label)?.[1] ?? '-1')).toBeGreaterThanOrEqual(2);
      await expect
        .poll(async () => {
          const { label: seen, now } = await read();
          const done = Number(/: (\d+) of/.exec(seen)?.[1] ?? '-1');
          return now === String(Math.min(100, Math.round((done / 40) * 100)));
        })
        .toBe(true);
      await expect(
        page.getByText('Your team lead sets your targets', { exact: false }),
      ).toHaveCount(0);
      await expectNoAxeViolations(page);
      await snap(page, 'home-caller-with-target', {
        // The count of calls includes any a calling journey saved, so it is masked with the bar.
        mask: [
          page.locator('main dl'),
          page.getByRole('progressbar'),
          page.locator('time'),
          page.getByText(/ of 40$/),
        ],
      });
    });

    test('has no way into the Targets page', async ({ page }) => {
      await page.goto('/targets');
      await expect(
        page
          .getByRole('heading', { name: 'We couldn’t find this screen' })
          .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
      ).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Targets', level: 1 })).toHaveCount(0);
    });
  });
});

test.describe('a caller with no target', () => {
  test.use(signedInAs('snapshotCaller'));

  test('is told in plain words that none is set', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Your targets', level: 2 })).toBeVisible();
    await expect(
      page.getByText(
        'No target is set for you yet. Your team lead sets your targets, and they show here with your progress.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('progressbar')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'home-caller-no-target', {
      mask: [page.locator('main dl'), page.locator('time')],
    });
  });
});

test.describe('the General Manager’s home', () => {
  test.use(signedInAs('gm'));

  test('shows the first-call limits and the pipeline by stage', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'First calls', level: 2 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open leads by stage', level: 2 }),
    ).toBeVisible();
    // No limit is invented: the page shows the figures when a pipeline sets one, else says so.
    await expect(
      page
        .getByText(/^No time limit for the first call is set./)
        .or(page.getByText('Leads still waiting for a first call past the limit')),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // Its picture is the snapshot company's own General Manager's, at the end of this file.
  });

  test('may set the targets of any team and caller of the company', async ({ page }) => {
    await page.goto('/targets');
    await expect(page.getByRole('heading', { name: 'Targets', level: 1 })).toBeVisible();
    const form = page.getByRole('region', { name: 'Set a target' });
    await expect(form.getByLabel('For', { exact: true })).toContainText('Neha Saini');
    await expectNoAxeViolations(page);
  });
});

test.describe('Accounts’ home', () => {
  test.use(signedInAs('accounts'));

  test('shows the dealer credit counts and the way to the dealers', async ({ page }) => {
    await page.goto('/home');
    const heading = page.getByRole('heading', { name: 'Dealer credit', level: 2 });
    await expect(heading).toBeVisible();
    for (const label of [
      'Orders held for credit',
      'Dealers over their limit',
      'Dealers with an overdue invoice',
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('link', { name: 'Open dealer credit' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'home-accounts', { mask: [page.locator('main dl'), page.locator('time')] });
  });
});

test.describe('the Executive’s home', () => {
  test.use(signedInAs('executive'));

  test('shows quotes and orders per company and for the group, and the pipeline, with no margin', async ({
    page,
  }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Quotes and orders', level: 2 })).toBeVisible();
    const table = page.getByRole('table', { name: 'Quotes and orders by company' });
    await expect(table.getByRole('rowheader', { name: 'All companies' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open leads by stage', level: 2 }),
    ).toBeVisible();
    await expect(page.getByText(/margin|profit/i)).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Its picture is the snapshot company's own Executive's, at the end of this file.
  });
});

// The pictures of Targets and of the home pages whose figures other journeys change in company 1
// and 2. The snapshot company has a team of its own (users.ts, SNAPSHOT_TEAM): a team lead, a caller
// with a daily target and calls logged today, a General Manager and an Executive of that company
// alone. Only the seed writes there, so each page shows the same figures on every run; dates and
// times are masked.
test.describe('the snapshot company’s team lead sets targets', () => {
  test.use(signedInAs('snapshotLead'));

  test('Targets shows the caller’s target and the targets set', async ({ page }) => {
    await page.goto('/targets');
    await expect(page.getByRole('heading', { name: 'Targets', level: 1 })).toBeVisible();
    const now = page.getByRole('table', { name: 'Targets in force today' });
    await expect(
      now.getByRole('row', {
        name: new RegExp(
          `Snapshot Tracked Caller.*Calls.*Day.*${String(SNAPSHOT_TEAM.dailyCallTarget)}`,
        ),
      }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // The form's starting day is today's, a date that changes every day.
    await snap(page, 'targets', {
      mask: [page.getByLabel('Starting'), page.getByText(/\b20\d\d\b/), page.locator('time')],
    });
  });
});

test.describe('the snapshot company’s tele-caller with a target', () => {
  test.use(signedInAs('snapshotTracker'));

  test('sees the progress of the calls logged today', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Your targets', level: 2 })).toBeVisible();
    const meter = page.getByRole('progressbar', {
      name: `Calls: ${String(SNAPSHOT_TEAM.callsToday)} of ${String(SNAPSHOT_TEAM.dailyCallTarget)}`,
    });
    await expect(meter).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'home-caller-progress', {
      mask: [page.getByText(/\b20\d\d\b/), page.locator('time')],
    });
  });
});

test.describe('the snapshot company’s General Manager', () => {
  test.use(signedInAs('snapshotManager'));

  test('sees the first-call limits and the pipeline of the company', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'First calls', level: 2 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open leads by stage', level: 2 }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'home-general-manager', {
      mask: [page.getByText(/\b20\d\d\b/), page.locator('time')],
    });
  });
});

test.describe('the snapshot company’s Executive', () => {
  test.use(signedInAs('snapshotExecutive'));

  test('sees the quotes, the orders and the pipeline of the company', async ({ page }) => {
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Quotes and orders', level: 2 })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Quotes and orders by company' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Open leads by stage', level: 2 }),
    ).toBeVisible();
    await expect(page.getByText(/margin|profit/i)).toHaveCount(0);
    await expectNoAxeViolations(page);
    await snap(page, 'home-executive', {
      mask: [page.getByText(/\b20\d\d\b/), page.locator('time')],
    });
  });
});
