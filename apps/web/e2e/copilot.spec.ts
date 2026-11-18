import type { Page } from '@playwright/test';
import { COPILOT_JOURNEY, COPILOT_LEADS } from './copilot-fixtures';
import { CONVERTING_LEADS, converterKey } from './converting-fixtures';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { signInThroughScreens } from './support/sign-in';
import { emailFor } from './support/users';

// A2 Caller Co-pilot (docs/03-roadmap-appendix/phase2.md §7.3, PRD TEL-03 and AI-04): the
// tele-caller opens the project's seeded lead in the Cold Caller workspace (`e2e/setup/copilot.ts`)
// and reads the Co-pilot's brief and the summary of her last call, whose suggested outcome is
// marked among the outcomes and not saved; A approves the first suggestion and R rejects the next,
// and a new brief is asked for. The Lead Converter sees the same panel on Converting. The
// Executive reads the Co-pilot report: the summaries written in Shadow, beside what was saved.

const panel = (page: Page) => page.getByRole('region', { name: 'Co-pilot' });

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

test.describe('the Caller Co-pilot as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));
  // The journey decides on its seeded suggestions once, so a retry can only fail.
  test.describe.configure({ retries: 0 });

  test('shows the brief and the call summary, marks the outcome, and A and R decide', async ({
    page,
  }) => {
    await openInWorkspace(page, COPILOT_LEADS[projectName()]);
    const copilot = panel(page);
    await expect(copilot.getByText(COPILOT_JOURNEY.brief)).toBeVisible();
    await expect(copilot.getByText(COPILOT_JOURNEY.summary)).toBeVisible();
    // Heard on the call, in the summary and in the suggestion to record it.
    await expect(copilot.getByText('Pump depth (feet)')).toHaveCount(2);
    await expect(
      copilot.getByText(/^Suggested outcome: .+\. It is marked in the outcomes/),
    ).toBeVisible();

    // The suggested outcome is marked among the outcomes, and nothing is saved.
    const marked = page.getByText(
      'The highlighted outcome is the one the Co-pilot suggests. You choose.',
    );
    await expect(marked).toBeVisible();
    const noteId = await marked.getAttribute('id');
    if (noteId === null) throw new Error('the note has an id');
    await expect(
      page
        .getByRole('region', { name: 'How did the call go?' })
        .locator(`[aria-describedby="${noteId}"]`),
    ).toHaveCount(1);
    await expect(page.getByText(/Tries without an answer/)).toHaveCount(0);

    const suggestions = copilot.getByRole('listitem');
    await expect(suggestions).toHaveCount(2);
    await expect(copilot.getByText('Add a follow-up task')).toBeVisible();
    await expect(copilot.getByText(COPILOT_JOURNEY.followUp)).toBeVisible();
    await expect(copilot.getByText('Record what was heard on a call')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'copilot-panel', { mask: [page.getByText(/^Phone ending /)] });

    // A approves the first suggestion (the follow-up), R rejects the next (the facts).
    await page.locator('body').press('a');
    await expect(page.getByText('Approved. The suggestion has been carried out.')).toBeVisible();
    await expect(suggestions).toHaveCount(1);
    await expect(copilot.getByText(COPILOT_JOURNEY.followUp)).toHaveCount(0);
    await page.locator('body').press('r');
    await expect(page.getByText('Rejected. Nothing was changed.')).toBeVisible();
    await expect(copilot.getByText('No suggestions are waiting.')).toBeVisible();

    // The brief is two hours old, so a new one may be asked for, once.
    const ask = copilot.getByRole('button', { name: 'Ask for a brief' });
    await expect(ask).toBeEnabled();
    await ask.click();
    await expect(page.getByText('The Co-pilot is writing a brief.', { exact: true })).toBeVisible();
    await expect(ask).toBeDisabled();
    await expectNoAxeViolations(page);
  });
});

test.describe('the Caller Co-pilot as a Lead Converter', () => {
  test('shows its panel beside the calls of a lead on Converting', async ({ page }) => {
    await signInThroughScreens(page, emailFor(converterKey(projectName())));
    await page.goto('/converting');
    const name = CONVERTING_LEADS.held.name;
    await page
      .getByRole('region', { name: 'Your leads' })
      .getByRole('button', { name: new RegExp(name) })
      .click();
    await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    const copilot = panel(page);
    await expect(copilot.getByRole('heading', { name: 'Before you call' })).toBeVisible();
    await expect(copilot.getByText('No summary of a recorded call yet.')).toBeVisible();
    await expect(copilot.getByText('No suggestions are waiting.')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the Co-pilot report as an Executive', () => {
  test.use(signedInAs('executive'));

  test('shows the summaries callers did not see, beside what they saved', async ({ page }) => {
    await page.goto('/admin/agents');
    await showCompany(page, 'Shakti Supreme');
    await page.getByRole('link', { name: 'Co-pilot report' }).click();
    await expect(
      page.getByRole('heading', { name: 'What the Co-pilot suggested', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How often callers agreed' })).toBeVisible();
    // The seed's summaries written under Needs approval were seen by the callers: left out.
    await expect(
      page.getByText(
        /summar(y|ies) whose suggestions (the caller|callers) saw (is|are) not counted/,
      ),
    ).toBeVisible();
    const grid = dataGrid(page, 'Call summaries, newest first');
    // The seed's summary in Shadow of this project's lead (the newest, should a database hold an
    // earlier run's too).
    const row = grid
      .getByRole('row')
      .or(grid.getByRole('listitem'))
      .filter({ hasText: COPILOT_LEADS[projectName()] })
      .filter({ hasText: 'Pump depth (feet): 150' })
      .first();
    await expect(row).toContainText('Not saved yet');
    await expect(row).toContainText('Not known yet');
    await expectNoAxeViolations(page);
    // The period runs to today and the summaries are days old, so the dates are masked.
    await snap(page, 'copilot-report', {
      mask: [
        page.getByLabel('From', { exact: true }),
        page.getByLabel('To', { exact: true }),
        page.locator('main time'),
      ],
    });
  });
});
