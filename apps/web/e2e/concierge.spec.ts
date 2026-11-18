import type { Page } from '@playwright/test';
import {
  CONCIERGE_CUSTOMERS,
  CONCIERGE_JOURNEY,
  type ConciergeDecision,
} from './concierge-fixtures';
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
import { SNAPSHOT_COMPANY, SNAPSHOT_LEADS, WHATSAPP } from './support/users';

// The WhatsApp Concierge (docs/03-roadmap-appendix/phase2.md §7.2, PRD AI-05 and AI-06). The seed
// gives the tele-caller, per project, three customers in company 1 whose chats the assistant
// answers, each with the assistant's reply waiting under Needs approval; the tele-caller sends one
// as written (S), edits one (E) and discards one (D), and nothing reaches the customer before. The
// Executive reads the shadow report, where the snapshot company's one draft, recorded in Shadow,
// stands beside what the team sent.

/** Opens the chat of this project's customer for `decision`, and its draft. */
async function openDraft(page: Page, decision: ConciergeDecision) {
  const name = CONCIERGE_CUSTOMERS[projectName()][decision];
  await page.goto('/messages');
  const list = page.getByRole('region', { name: 'Chats waiting for a reply' });
  const row = await hydrated(list.getByRole('button', { name: new RegExp(name) }).first());
  await row.click();
  const chat = page.getByRole('region', { name: 'WhatsApp' });
  await expect(chat.getByText(CONCIERGE_JOURNEY.message).last()).toBeVisible();
  const draft = chat.getByRole('region', { name: 'Reply drafted by the assistant' });
  await expect(draft.getByText(CONCIERGE_JOURNEY.draft)).toBeVisible();
  return { chat, draft };
}

test.describe('the assistant’s drafts, as the tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('sends a draft as written with S', async ({ page }) => {
    const { chat, draft } = await openDraft(page, 'send');
    await expect(chat.getByText('The assistant drafts replies', { exact: true })).toBeVisible();
    await expect(draft.getByRole('button', { name: 'Send' })).toHaveAttribute(
      'aria-keyshortcuts',
      'S',
    );
    await expectNoAxeViolations(page);
    // The draft alone: its time is masked.
    await snap(page, 'concierge-draft', {
      element: draft,
      mask: [draft.getByText(/^Drafted /)],
    });
    await draft.getByRole('button', { name: 'Send' }).focus();
    await page.keyboard.press('s');
    await expect(page.getByText('Your message is on its way.')).toBeVisible();
    await expect(draft).toHaveCount(0);
    await expect(
      chat.getByRole('list', { name: 'Messages in this chat' }).getByText(CONCIERGE_JOURNEY.draft),
    ).toBeVisible();
  });

  test('edits a draft with E and sends their own words', async ({ page }) => {
    const { chat, draft } = await openDraft(page, 'edit');
    await draft.getByRole('button', { name: 'Edit' }).focus();
    await page.keyboard.press('e');
    const words = draft.getByLabel('Your reply');
    await expect(words).toHaveValue(CONCIERGE_JOURNEY.draft);
    await expectNoAxeViolations(page);
    await words.fill(CONCIERGE_JOURNEY.edited);
    await draft.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Your message is on its way.')).toBeVisible();
    await expect(
      chat.getByRole('list', { name: 'Messages in this chat' }).getByText(CONCIERGE_JOURNEY.edited),
    ).toBeVisible();
    await expect(chat.getByText(CONCIERGE_JOURNEY.draft)).toHaveCount(0);
  });

  test('discards a draft with D, and nothing is sent', async ({ page }) => {
    const { chat, draft } = await openDraft(page, 'discard');
    await draft.getByRole('button', { name: 'Discard' }).focus();
    await page.keyboard.press('d');
    await expect(page.getByText('The draft was set aside.', { exact: false })).toBeVisible();
    await expect(draft).toHaveCount(0);
    await expect(chat.getByText(CONCIERGE_JOURNEY.draft)).toHaveCount(0);
    // The chat still waits for the team, whose reply box stays open.
    await expect(chat.getByLabel('Reply')).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('the WhatsApp assistant report, as an Executive', () => {
  test.use(signedInAs('executive'));

  test('lists each draft beside what the team sent', async ({ page }) => {
    await page.goto('/admin/agents');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await page.getByRole('link', { name: 'WhatsApp drafts' }).click();
    await expect(
      page.getByRole('heading', { name: 'What the WhatsApp assistant drafted', level: 1 }),
    ).toBeVisible();
    const summary = page.getByRole('region', { name: 'Its drafts' });
    await expect(summary.getByText('1 draft', { exact: true })).toBeVisible();
    const grid = dataGrid(page, 'Drafts, newest first');
    const row = grid
      .getByRole('row')
      .or(grid.getByRole('listitem'))
      .filter({ hasText: SNAPSHOT_LEADS[1].name })
      .first();
    await expect(row).toContainText(WHATSAPP.snapshot.message);
    await expect(row).toContainText(CONCIERGE_JOURNEY.shadowDraft);
    await expect(row).toContainText('Nothing sent yet');
    await expect(row).toContainText('Recorded in shadow');
    await expectNoAxeViolations(page);
    // The seed's one draft alone, refreshed on every run: its time is masked.
    await snap(page, 'concierge-report', { element: grid, mask: [grid.locator('time')] });
  });
});
