import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SNAPSHOT_COMPANY } from './support/users';
import { TRIAGE_JOURNEY } from './setup/triage-journey';

// The Triage agent in shadow (docs/03-roadmap-appendix/phase1.md §9, A1). The seed made a lead in
// the snapshot company and ran the real agent on it through the fake transport
// (setup/triage.ts): its proposals are recorded in Shadow. Here the report shows them beside what
// people did, nothing of them reaches the Agent Inbox, and Integration health shows the agent's
// spend.

const REPORT = 'Proposals recorded in shadow, newest first';

/** A grid's rows: the table's on wider screens, the cards on a phone. */
const rowsOf = (grid: ReturnType<typeof dataGrid>) =>
  grid.getByRole('row').or(grid.getByRole('listitem'));

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('a new lead’s proposals show on the report and nothing reaches the inbox', async ({
    page,
  }) => {
    await page.goto('/admin/agents');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    // The agents screen offers Shadow, and keeps the pipeline and score in Shadow only.
    await expect(
      page.getByRole('heading', { name: 'What Intake and Triage may do' }),
    ).toBeVisible();
    await expect(
      page.getByText('Shadow only. There is no action for this yet', { exact: false }),
    ).toHaveCount(2);
    await expect(
      page.getByRole('combobox', {
        name: 'Autonomy of Intake and Triage for Choose who takes a new lead',
      }),
    ).toContainText('Shadow');

    await page.getByRole('link', { name: 'Triage proposals' }).click();
    await expect(
      page.getByRole('heading', { name: 'What the Triage agent proposed', level: 1 }),
    ).toBeVisible();
    const grid = dataGrid(page, REPORT);
    const rows = rowsOf(grid).filter({ hasText: TRIAGE_JOURNEY.customer });
    await expect(rows.filter({ hasText: 'Who takes the lead' })).toContainText('Geeta Kumari');
    await expect(rows.filter({ hasText: 'Who takes the lead' })).toContainText('Differed');
    await expect(rows.filter({ hasText: 'Pipeline' })).toContainText('Farmer pumps');
    await expect(rows.filter({ hasText: 'Pipeline' })).toContainText('Agreed');
    await expect(rows.filter({ hasText: 'Score' })).toContainText('+5 points');
    await expect(rows.filter({ hasText: 'Score' })).toContainText(TRIAGE_JOURNEY.scoreNote);
    await expect(page.getByRole('heading', { name: 'How often people agreed' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The period runs to today, so its dates are masked.
    await snap(page, 'triage-proposals', {
      mask: [page.getByLabel('From'), page.getByLabel('To')],
    });

    // A period the report refuses is named under the dates, not sent.
    await page.getByLabel('From').fill('01-01-2026');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    // Too long a period is named under both dates; an end before the start under the end.
    await expect(page.getByText('Choose a period of 92 days or less.')).toHaveCount(2);
    await page.getByLabel('From').fill('01-01-2099');
    await page.getByRole('button', { name: 'Show', exact: true }).click();
    await expect(page.getByText('The end date is before the start date.')).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'To', exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );

    // Nothing of it reached the Agent Inbox.
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Agent Inbox', level: 1 })).toBeVisible();
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: 'Intake and Triage suggests' })
        .filter({ hasText: TRIAGE_JOURNEY.customer }),
    ).toHaveCount(0);
  });

  test('Integration health shows the AI spend per agent and company', async ({ page }) => {
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'AI spend' })).toBeVisible();
    const grid = dataGrid(page, 'AI spend by agent and company');
    await expect(
      rowsOf(grid)
        .filter({ hasText: 'Intake and Triage' })
        .filter({ hasText: SNAPSHOT_COMPANY.name }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('the report opens for the company the GM works in', async ({ page }) => {
    await page.goto('/admin/agents/shadow');
    await expect(
      page.getByRole('heading', { name: 'What the Triage agent proposed', level: 1 }),
    ).toBeVisible();
    // The GM's company has no proposals in the journeys.
    await expect(page.getByRole('heading', { name: 'How often people agreed' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('the report is not there', async ({ page }) => {
    await page.goto('/admin/agents/shadow');
    await expect(page.getByRole('heading', { name: 'What the Triage agent proposed' })).toHaveCount(
      0,
    );
  });
});
