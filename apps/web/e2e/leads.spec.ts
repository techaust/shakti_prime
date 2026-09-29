import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

/** A mobile number no earlier run used, typed the way a caller types it. */
function freshMobile(): string {
  const digits = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

const ROLES = [
  { role: 'teleCaller', title: 'a tele-caller', lead: 'Kavita Saini' },
  { role: 'teamLead', title: 'a sales team lead', lead: 'Pooja Gurjar' },
] as const;

for (const { role, title, lead } of ROLES) {
  test.describe(`leads as ${title}`, () => {
    test.use(signedInAs(role));

    test('opens the leads list', async ({ page }) => {
      await page.goto('/leads');
      await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
      const grid = dataGrid(page, 'Leads');
      await expect(grid.getByText(lead).first()).toBeVisible();
      await expectNoAxeViolations(page);
      // The rows grow with every run (the journeys add leads), so the grid is masked and only
      // the first screen is compared: the page grows with the rows.
      await snap(page, `leads-list-${role}`, { mask: [grid], fullPage: false });
    });

    test('opens the leads board', async ({ page }) => {
      await page.goto('/leads');
      await page.getByRole('link', { name: 'Board' }).click();
      await expect(page).toHaveURL(/\/leads\/board/);
      await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
      await expectNoAxeViolations(page);
      await snap(page, `leads-board-${role}`, {
        mask: [page.getByRole('region', { name: 'Lead stages' })],
        fullPage: false,
      });
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
