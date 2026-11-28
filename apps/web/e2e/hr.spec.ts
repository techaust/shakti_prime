import type { Browser, Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  rowOf,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { HR_JOURNEY, seededUsers, storageStatePath, type SignedInRole } from './support/users';

// HR1's screens (docs/03-roadmap-appendix/phase5.md §5, PRD HR-01 and HR-02). The seed puts the
// tele-caller on company 1's staff, reporting to the team lead, with a leave type of each project's
// own and her balance of it topped up (`e2e/setup/hr.ts`): she asks for a day of leave, her team
// lead approves it and her balance falls by that day. HR sets a holiday for RCREF, a company no
// leave journey asks in, and takes it off again. The snapshot company's Executive reads the staff
// the seed alone writes there. Each run's notes and names carry a word of their own, so a row is
// found by its own text on a database earlier runs used.

/** `YYYY-MM-DD` as people type it, DD-MM-YYYY. */
function dmy(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d ?? ''}-${m ?? ''}-${y ?? ''}`;
}

/** The day `n` days after `iso`. */
function plusDays(iso: string, n: number): string {
  const day = new Date(`${iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + n);
  return day.toISOString().slice(0, 10);
}

/** "8 days", "1 day": a number of days as the HR screens write it. */
function daysText(n: number): string {
  return `${String(n)} ${n === 1 ? 'day' : 'days'}`;
}

/** Another person's page in the same browser, signed in as that role. */
async function asRole(browser: Browser, role: SignedInRole): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStatePath(role) });
  return context.newPage();
}

/** The tele-caller's balance of one leave type, as her Leave screen lists it. */
async function balanceOf(page: Page, type: string): Promise<number> {
  const line = page
    .getByRole('list', { name: 'Your balance' })
    .getByRole('listitem')
    .filter({ hasText: `${type}:` });
  const text = (await line.textContent()) ?? '';
  const days = /:\s*(-?[\d.]+) days?$/.exec(text.trim());
  if (!days?.[1]) throw new Error(`no balance in "${text}"`);
  return Number(days[1]);
}

test.describe('as a tele-caller and her team lead, leave', () => {
  test.use(signedInAs('teleCaller'));

  test('she asks for a day of leave, her team lead approves it and her balance falls by that day', async ({
    page,
    browser,
  }, testInfo) => {
    const project = projectName();
    const type = HR_JOURNEY.leaveTypes[project];
    // A day after any this project asked for before; a retry moves on a day, past the first try's.
    const day = plusDays(seededUsers().hr.leaveDays[project], testInfo.retry);
    const note = `Family visit, walk ${String(Date.now()).slice(-8)}`;
    const span = `${dmy(day)} to ${dmy(day)}`;

    await page.goto('/hr/leave');
    await expect(page.getByRole('heading', { name: 'Leave', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask for leave', level: 2 })).toBeVisible();
    const before = await balanceOf(page, type);
    await expectNoAxeViolations(page);

    await (
      await hydrated(page.getByLabel('Leave type', { exact: true }))
    ).selectOption({
      label: type,
    });
    await page.getByLabel('First day').fill(dmy(day));
    await page.getByLabel('Last day').fill(dmy(day));
    await page.getByLabel('Note', { exact: true }).fill(note);
    await page.getByRole('button', { name: 'Ask for leave' }).click();
    await expect(page.getByText('Leave asked for: 1 working day.')).toBeVisible();
    const mine = dataGrid(page, 'Your leave, newest first');
    await expect(rowOf(mine, span)).toContainText('Waiting');
    await expect(rowOf(mine, span)).toContainText(type);
    await expectNoAxeViolations(page);

    // Her team lead finds it waiting for him, with her balance, and approves it.
    const lead = await asRole(browser, 'teamLead');
    await lead.goto('/hr/leave');
    await expect(lead.getByRole('heading', { name: 'Leave', level: 1 })).toBeVisible();
    const waiting = dataGrid(lead, 'Leave waiting for a decision, oldest first');
    const request = rowOf(waiting, note);
    await expect(request).toContainText(type);
    await expect(request).toContainText(daysText(before));
    await expectNoAxeViolations(lead);
    await (
      await hydrated(
        request.getByRole('button', { name: `Approve ${HR_JOURNEY.asker.name}'s leave` }),
      )
    ).click();
    const dialog = lead.getByRole('dialog', { name: `Approve ${HR_JOURNEY.asker.name}'s leave` });
    await expect(dialog).toContainText(
      `${type}, ${span}: 1 day. Their balance now: ${daysText(before)}.`,
    );
    // The dates and the balance change with every run.
    await snap(lead, 'leave-approve-dialog', {
      element: dialog,
      mask: [dialog.getByText(/Their balance now/)],
    });
    await expectNoAxeViolations(lead);
    await dialog.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(
      lead.getByText('Leave approved. The days are taken off the balance.'),
    ).toBeVisible();
    await expect(rowOf(waiting, note)).toHaveCount(0);
    await lead.context().close();

    // Back with her: approved, and the day is off her balance.
    await page.reload();
    await expect(rowOf(mine, span)).toContainText('Approved');
    await expect.poll(() => balanceOf(page, type)).toBe(before - 1);

    // Her own page lists the same balance and the movement that took the day.
    await page.getByRole('link', { name: 'Your details' }).click();
    await expect(
      page.getByRole('heading', { name: HR_JOURNEY.asker.name, level: 1 }),
    ).toBeVisible();
    await expect(dataGrid(page, 'Days of each leave type')).toContainText(type);
    await expect(rowOf(dataGrid(page, 'Days of each leave type'), type)).toContainText(
      daysText(before - 1),
    );
    await expect(page.getByText(HR_JOURNEY.lead.name).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as HR, holidays', () => {
  test.use(signedInAs('hrAdmin'));

  test('sets a holiday for one company, sees it in its year and takes it off again', async ({
    page,
  }) => {
    const project = projectName();
    const year = new Date().getFullYear() + 1;
    const iso = `${String(year)}-${HR_JOURNEY.holiday.days[project]}`;
    const name = `Journey holiday ${String(Date.now()).slice(-8)}`;

    await page.goto('/hr/holidays');
    await expect(page.getByRole('heading', { name: 'Holidays', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await (await hydrated(page.getByRole('button', { name: 'Add a holiday' }))).click();
    const dialog = page.getByRole('dialog', { name: 'Add a holiday' });
    await expect(dialog).toBeVisible();
    await snap(page, 'holiday-add-dialog', { element: dialog });
    await dialog.getByLabel('For').selectOption({ label: HR_JOURNEY.holiday.company });
    await dialog.getByLabel('Date', { exact: true }).fill(dmy(iso));
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Holiday saved.')).toBeVisible();

    const list = dataGrid(page, `Holidays in ${String(year)}`);
    const row = rowOf(list, name);
    await expect(row).toContainText(HR_JOURNEY.holiday.company);
    await expect(row).toContainText(dmy(iso));
    await expectNoAxeViolations(page);

    // Taken off again, so the day is free for the next run.
    await row.getByRole('button', { name: `Remove the holiday on ${dmy(iso)}` }).click();
    await expect(page.getByText('Holiday removed.')).toBeVisible();
    await expect(rowOf(list, name)).toHaveCount(0);
  });
});

test.describe('as the snapshot company’s Executive, the staff list', () => {
  test.use(signedInAs('snapshotExecutive'));

  test('lists the staff by name with their manager and office, and opens a person’s page', async ({
    page,
  }) => {
    const { helper, lead } = HR_JOURNEY.snapshot;
    await page.goto('/hr/people');
    await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
    // Only the seed's staff of the snapshot company carry this word in their names.
    await (await hydrated(page.getByLabel('Search by name'))).fill('Snapshot');
    const list = dataGrid(page, 'Staff');
    const row = rowOf(list, helper.name);
    await expect(row).toContainText(lead.name);
    await expect(row).toContainText(helper.office);
    await expect(list.getByRole('link')).toHaveCount(3);
    await expectNoAxeViolations(page);
    await snap(page, 'hr-people');

    await row.getByRole('link', { name: helper.name }).click();
    await expect(page.getByRole('heading', { name: helper.name, level: 1 })).toBeVisible();
    await expect(page.getByText(lead.name).first()).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
