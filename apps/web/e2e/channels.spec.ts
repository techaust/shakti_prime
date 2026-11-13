import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, hydrated, signedInAs, test } from './support/fixtures';
import { insideCallingHours, outsideCallingHours, setServerClock } from './support/clock';

// E1 Channels and dial rules (docs/03-roadmap-appendix/phase2.md §5.2): an Executive records a
// company's numbers on Settings › Companies, and the screen says plainly when a calling number is
// not of its series; the Cold Caller workspace says how a call would go out and every rule it
// would break. The numbers are synthetic DLT ones; company 1's are seeded (seed.ts).

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
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

/** Opens a lead in the Cold Caller workspace through its search. */
async function openInWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/calling');
  await expect(page.getByRole('heading', { name: 'Calling', level: 1 })).toBeVisible();
  const search = await hydrated(page.getByRole('searchbox', { name: /Find a lead/ }));
  await search.fill(name);
  await search.press('Enter');
  const hit = page.getByRole('list', { name: 'Leads found' }).getByRole('button').first();
  await expect(hit).toContainText(name);
  await hit.click();
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

test.describe('company numbers as an Executive', () => {
  test.use(signedInAs('executive'));

  test('sets a sales calls number, says when it is not of its series, and takes it out of use', async ({
    page,
  }, testInfo) => {
    // One project edits the numbers, so two browsers never change the same company at once.
    test.skip(testInfo.project.name !== 'desktop-light', 'the numbers are edited in one project');
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    // Company 4, whose numbers no other journey reads.
    await (await hydrated(page.getByRole('button', { name: 'Numbers of RCREF' }))).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Numbers of RCREF' })).toBeVisible();
    const sales = dialog.getByRole('listitem').filter({ hasText: 'Sales calls number' });
    // A run that stopped half way leaves the number set: take it out of use first.
    const leftOver = sales.getByRole('button', { name: /out of use/ });
    if ((await leftOver.count()) > 0) await leftOver.click();
    await expect(sales.getByText('Not set')).toBeVisible();

    // A number outside the 140 series is kept, and the list says every sales call on it fails.
    await sales.getByRole('button', { name: /^Add the Sales calls number/ }).click();
    await dialog.getByLabel('Number', { exact: true }).fill('080 4711 2233');
    await dialog.getByRole('button', { name: 'Save number' }).click();
    await expect(
      dialog.getByText(
        'This is not a 140-series number, so every sales call on it will be refused. Enter the 140-series number.',
      ),
    ).toBeVisible();
    await expect(sales.getByText('Not checked yet')).toBeVisible();
    await expectNoAxeViolations(page);

    // The 140-series number, checked: the warning goes.
    await sales.getByRole('button', { name: /^Change the Sales calls number/ }).click();
    await dialog.getByLabel('Number', { exact: true }).fill('140 000 0401');
    await dialog.getByLabel('DLT header').fill('RCREF');
    await dialog.getByLabel('I have checked that this number works').check();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save number' }).click();
    await expect(sales.getByText('+91 14000 00401')).toBeVisible();
    await expect(sales.getByText('Checked and working')).toBeVisible();
    await expect(dialog.getByText(/not a 140-series number/)).toHaveCount(0);

    // Out of use: the channel reads Not set again.
    await sales.getByRole('button', { name: /out of use/ }).click();
    await expect(sales.getByText('Not set')).toBeVisible();
  });
});

test.describe('the call plan as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('says a call goes out as a sales call on the 140-series number, and why', async ({
    page,
    context,
  }) => {
    await setServerClock(context, insideCallingHours());
    const lead = await addLead(page, 'Kamla Devi Jat');
    await openInWorkspace(page, lead);
    const plan = page.getByRole('region', { name: 'How this call would go out' });
    await expect(
      plan.getByText('A sales call: the customer has not agreed to service calls.'),
    ).toBeVisible();
    await expect(
      plan.getByText("It goes out on the company's 140-series number +91 14000 00101."),
    ).toBeVisible();
    await expect(plan.getByText('Every calling rule is met.')).toBeVisible();
    // The number was looked up on the do-not-disturb list as the plan was made.
    await expect(plan.getByText(/^Do-not-disturb list checked on /)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('lists every rule a call would break outside calling hours', async ({ page, context }) => {
    await setServerClock(context, outsideCallingHours());
    const lead = await addLead(page, 'Bhanwar Lal Gurjar');
    await openInWorkspace(page, lead);
    const plan = page.getByRole('region', { name: 'How this call would go out' });
    await expect(plan.getByText('This call breaks these rules:')).toBeVisible();
    await expect(
      plan.getByText('It is outside calling hours. Calls can be made from 9 AM to 9 PM.'),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
