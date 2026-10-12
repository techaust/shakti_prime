import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SNAPSHOT_LEADS } from './support/users';

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const ROLES = [
  { role: 'teleCaller', title: 'a tele-caller' },
  { role: 'teamLead', title: 'a sales team lead' },
] as const;

for (const { role, title } of ROLES) {
  test.describe(`leads as ${title}`, () => {
    test.use(signedInAs(role));

    test('opens the leads list', async ({ page }) => {
      await page.goto('/leads');
      await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
      // The journeys add leads on every run, so the seeded one may be past the first page; the
      // snapshot company's list below checks named rows.
      await expect(dataGrid(page, 'Leads')).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('opens the leads board', async ({ page }) => {
      await page.goto('/leads');
      await page.getByRole('link', { name: 'Board' }).click();
      await expect(page).toHaveURL(/\/leads\/board/);
      await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('adds a lead', async ({ page }) => {
      await page.goto('/leads/new');
      await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
      await snap(page, `leads-new-${role}`);
      const name = `Mohan Lal ${String(Date.now()).slice(-5)}`;
      await page.getByLabel('Customer name').fill(name);
      await page.getByLabel('Mobile number').fill(freshMobile());
      // A person in more than one company chooses it first; its lines of business follow.
      const company = page.getByLabel('Company', { exact: true });
      if (await company.isVisible()) await company.selectOption({ label: 'Shakti Supreme' });
      await page.getByLabel('Line of business').selectOption({ index: 1 });
      await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
      await page.getByRole('button', { name: 'Save lead' }).click();
      await expect(page.getByText(`Lead saved for ${name}.`)).toBeVisible();
    });
  });
}

test.describe('a mobile number the server refuses', () => {
  test.use(signedInAs('teleCaller'));

  test('is read out under the field, and focus moves to it (WEB-2)', async ({ page }) => {
    await page.goto('/leads/new');
    await expect(page.getByRole('heading', { name: 'Add a lead', level: 1 })).toBeVisible();
    await page.getByLabel('Customer name').fill(`Mohan Lal ${String(Date.now()).slice(-5)}`);
    // Too short for a mobile number: the form sends it as typed and the server refuses it.
    await page.getByLabel('Mobile number').fill('12345');
    const company = page.getByLabel('Company', { exact: true });
    if (await company.isVisible()) await company.selectOption({ label: 'Shakti Supreme' });
    await page.getByLabel('Line of business').selectOption({ index: 1 });
    await page.getByLabel('Type of customer').selectOption({ label: 'Farm' });
    const save = page.getByRole('button', { name: 'Save lead' });
    await save.click();
    const mobile = page.getByLabel('Mobile number');
    await expect(mobile).toBeFocused();
    await expect(mobile).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    await expectNoAxeViolations(page);
    // A further try with the same mistake is read out and focused again.
    await save.focus();
    await save.click();
    await expect(mobile).toBeFocused();
  });
});

// The screenshots of the list and the board: the snapshot caller's leads, which only the seed
// writes (users.ts), so every run shows the same rows and only times are masked.
test.describe('the leads of the snapshot company', () => {
  test.use(signedInAs('snapshotCaller'));

  test('the list shows every lead with its details', async ({ page }) => {
    await page.goto('/leads');
    const grid = dataGrid(page, 'Leads');
    for (const lead of SNAPSHOT_LEADS)
      await expect(grid.getByText(lead.name).first()).toBeVisible();
    await snap(page, 'leads-list');
  });

  test('the board shows every lead at its stage', async ({ page }) => {
    await page.goto('/leads/board?pipeline=farmer_pumps');
    for (const lead of SNAPSHOT_LEADS) {
      await expect(page.getByText(lead.name).first()).toBeVisible();
    }
    await expectNoAxeViolations(page);
    await snap(page, 'leads-board');
  });
});
