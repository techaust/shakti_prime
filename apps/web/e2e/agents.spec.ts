import { type Page } from '@playwright/test';
import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  projectName,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import {
  EDITED_NOTE,
  INBOX_SUGGESTIONS,
  KILL_SWITCH,
  SNAPSHOT_COMPANY,
  SNAPSHOT_SUGGESTIONS,
} from './support/users';

// The Agent Inbox and Admin › Agents (docs/design/phase1.md §7.1). The seed's stand-in agent
// (setup/stand-in-agent.ts) files suggestions through the real runtime; here a person approves,
// edits or rejects them, and the command runs as that person.

const INBOX = 'Suggestions waiting for a decision';
const AGENTS = 'Agents and their settings';

/** The card of one suggestion, by the note it carries. */
function suggestion(page: Page, note: string) {
  return page.getByRole('listitem').filter({ hasText: note });
}

/** How many tasks with this note the customer's page lists. */
async function tasksWithNote(page: Page, note: string): Promise<number> {
  await page.getByRole('heading', { name: 'Tasks' }).first().waitFor();
  return page.getByText(` · ${note}`, { exact: false }).count();
}

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('approving a suggestion with the keyboard adds the follow-up as the caller', async ({
    page,
  }) => {
    const note = INBOX_SUGGESTIONS[projectName()].approve;
    await page.goto('/inbox');
    await expect(page.getByRole('heading', { name: 'Agent Inbox', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Agent Inbox, \d+ waiting$/ })).toBeVisible();
    const card = suggestion(page, note);
    await expect(card.getByText('Caller Co-pilot suggests')).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Add a follow-up task' })).toBeVisible();

    // The customer's page before: how many tasks carry the note.
    const customer = card.getByRole('link', { name: 'Open customer' });
    const href = await customer.getAttribute('href');
    if (href === null) throw new Error('the suggestion links to its customer');
    const account = await page.context().newPage();
    await account.goto(href);
    const before = await tasksWithNote(account, note);

    // Keyboard first: focus the card, A approves.
    await card.focus();
    await page.keyboard.press('a');
    await expect(page.getByText('Approved. The suggestion has been carried out.')).toBeVisible();
    await expect(card).toHaveCount(0);

    // The task is the caller's own, made by the approval.
    await account.reload();
    await expect.poll(() => tasksWithNote(account, note)).toBe(before + 1);
    await expect(
      account.getByText(note).first().locator('..').getByText('For Neha Saini'),
    ).toBeVisible();
    await account.close();
  });

  test('editing a suggestion changes it before it runs', async ({ page }) => {
    const note = INBOX_SUGGESTIONS[projectName()].edit;
    await page.goto('/inbox');
    const card = suggestion(page, note);
    await card.getByRole('button', { name: 'Edit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change before approving' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByLabel('Note on the task').fill(EDITED_NOTE);
    await dialog.getByRole('button', { name: 'Approve with changes' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Approved. The suggestion has been carried out.')).toBeVisible();
    await expect(card).toHaveCount(0);
  });
});

test.describe('as the snapshot caller', () => {
  test.use(signedInAs('snapshotCaller'));

  // The snapshot company holds two suggestions the seed files afresh and no journey decides, so
  // the screenshot shows the same cards every run; times are masked.
  test('the inbox lists the suggestions with what they would do', async ({ page }) => {
    await page.goto('/inbox');
    const list = page.getByRole('list', { name: INBOX });
    for (const s of SNAPSHOT_SUGGESTIONS) {
      await expect(list.getByText(s.title)).toBeVisible();
    }
    await expect(
      page.getByText(
        'Keys: J and K move between suggestions, A approves, E opens Edit, R rejects.',
      ),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'agent-inbox');
  });
});

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('the agents screen shows each agent with its switch, autonomy and limit', async ({
    page,
  }) => {
    await page.goto('/admin/agents');
    await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);
    const grid = dataGrid(page, AGENTS);
    await expect(grid.getByText('Caller Co-pilot')).toBeVisible();
    await expect(
      page.getByText('The AI service is not connected yet, so agents make no calls.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What Caller Co-pilot may do' })).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'admin-agents');
  });

  test('a stopped agent’s suggestion cannot be approved until it may run again', async ({
    page,
  }) => {
    // The switch reaches every project's run, so one project alone works it.
    test.skip(projectName() !== KILL_SWITCH.project, 'one project works the kill switch');
    await page.goto('/admin/agents');
    await showCompany(page, KILL_SWITCH.company.name);
    const grid = dataGrid(page, AGENTS);
    await grid.getByRole('button', { name: 'Stop Caller Co-pilot' }).click();
    await expect(page.getByText('Caller Co-pilot is stopped.')).toBeVisible();
    await expect(grid.getByRole('button', { name: 'Let Caller Co-pilot run' })).toBeVisible();

    try {
      await page.goto('/inbox');
      const card = suggestion(page, KILL_SWITCH.title);
      await card.getByRole('button', { name: 'Approve' }).click();
      await expect(
        page.getByText('This agent is stopped, so its suggestions cannot be approved now.', {
          exact: false,
        }),
      ).toBeVisible();
      await expect(card).toHaveCount(1);
    } finally {
      await page.goto('/admin/agents');
      await showCompany(page, KILL_SWITCH.company.name);
      await dataGrid(page, AGENTS).getByRole('button', { name: 'Let Caller Co-pilot run' }).click();
      await expect(page.getByText('Caller Co-pilot may run again.')).toBeVisible();
    }

    // Running again, the same suggestion goes through, as the Executive.
    await page.goto('/inbox');
    const card = suggestion(page, KILL_SWITCH.title);
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved. The suggestion has been carried out.')).toBeVisible();
    await expect(card).toHaveCount(0);
  });
});

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('a GM sees the switches but not the autonomy or the limits', async ({ page }) => {
    await page.goto('/admin/agents');
    await expect(page.getByRole('heading', { name: 'Agents', level: 1 })).toBeVisible();
    await expect(
      page.getByText('Only an Executive changes autonomy and spending limits.'),
    ).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Autonomy of / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Stop Caller Co-pilot' })).toBeVisible();
  });
});

test.describe('as an accountant', () => {
  test.use(signedInAs('accounts'));

  test('the agents screen is not one the role may open', async ({ page }) => {
    await page.goto('/admin/agents');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
  });
});
