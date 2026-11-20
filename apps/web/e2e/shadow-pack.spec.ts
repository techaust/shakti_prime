import type { Locator } from '@playwright/test';
import { CONCIERGE_JOURNEY } from './concierge-fixtures';
import {
  expect,
  expectNoAxeViolations,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SNAPSHOT_COMPANY, SNAPSHOT_SUGGESTIONS, WHATSAPP } from './support/users';

// The G2 shadow review pack (docs/03-roadmap-appendix/phase2.md §8.1). The Executive reads the
// new figures on the WhatsApp assistant's report and opens its suggestions to review: in the
// snapshot company the concierge seed keeps one draft recorded in Shadow (`setup/concierge.ts`), so
// its page holds that draft alone and is pictured; printed, the sheet is all there is, light in
// every theme. The Co-pilot's page is opened from its report the same way: in the snapshot company
// it holds the seed's two follow-ups waiting for the snapshot caller (SNAPSHOT_SUGGESTIONS, filed
// afresh each run with fixed due times and never decided by a journey), which it pictures.

/** The spending's figures, which other journeys' runs in the company move. */
const spendFigures = (spend: Locator) => spend.locator('p').filter({ hasText: '₹' });

test.describe('the suggestions to review, as an Executive', () => {
  test.use(signedInAs('executive'));

  test('shows the WhatsApp assistant’s figures, and its suggestions to review printed light', async ({
    page,
  }) => {
    await page.goto('/admin/agents');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await page.getByRole('link', { name: 'WhatsApp drafts' }).click();
    const kinds = page.getByRole('region', { name: 'Suggestions by kind' });
    await expect(kinds).toContainText('1 recorded in shadow, 0 waiting, 0 approved, 0 rejected');
    await expect(kinds).toContainText(
      '0 agreed, 0 approved after an edit, 0 differed, 1 not known yet',
    );
    await expect(kinds).toContainText('A reply recorded in shadow is judged by reading it');
    const spend = page.getByRole('region', { name: 'Spending per lead' });
    await expect(spend).toContainText('never the cost of an item');
    const handoffs = page.getByRole('region', { name: 'Chats handed to the team' });
    await expect(handoffs).toBeVisible();
    await expectNoAxeViolations(page);
    // Other journeys' messages in the company make runs that stop (no spending limit) and hand
    // their chats to the team: the spending's lines and the hand-offs' lists are masked.
    await snap(page, 'concierge-kinds', { element: kinds });
    await snap(page, 'concierge-spend', { element: spend, mask: [spendFigures(spend)] });
    await snap(page, 'concierge-handoffs', {
      element: handoffs,
      mask: [handoffs.locator('ul, p')],
    });

    await page.getByRole('link', { name: 'Suggestions to review' }).click();
    await expect(
      page.getByRole('heading', {
        name: "The WhatsApp assistant's suggestions to review",
        level: 1,
      }),
    ).toBeVisible();
    const sheet = page.getByTestId('shadow-review');
    await expect(sheet.getByText('1 of 1 drafted reply in this period')).toBeVisible();
    const item = sheet
      .getByRole('list', { name: 'Suggestions, oldest first' })
      .getByRole('listitem')
      .filter({ hasText: CONCIERGE_JOURNEY.shadowDraft });
    await expect(item).toContainText(WHATSAPP.snapshot.message);
    await expect(item).toContainText('Nothing yet');
    await expect(item).toContainText('Recorded in shadow');
    await expect(item).toContainText('Not known yet');
    await expectNoAxeViolations(page);
    // The period ends today: its dates are masked.
    const period = sheet.locator('#review-period');
    await snap(page, 'concierge-review', { element: sheet, mask: [period] });

    // Printed: the sheet alone, light whatever the theme, without its buttons or the menu.
    await page.emulateMedia({ media: 'print' });
    const printed = page.locator('.print-sheet');
    await expect
      .poll(() => printed.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 255, 255)');
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(item).toBeVisible();
    await snap(page, 'concierge-review-print', { element: sheet, mask: [period] });
    await page.emulateMedia({ media: null });
  });

  test('opens the Co-pilot’s suggestions to review from its report', async ({ page }) => {
    await page.goto('/admin/agents');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await page.getByRole('link', { name: 'Co-pilot report' }).click();
    const spend = page.getByRole('region', { name: 'Spending per lead' });
    await expect(spend).toContainText('The Co-pilot hands nothing over');
    const kinds = page.getByRole('region', { name: 'Suggestions by kind' });
    await expect(kinds).toContainText('Send a WhatsApp follow-up');
    // The seed's two follow-ups wait for the snapshot caller.
    await expect(kinds).toContainText('0 recorded in shadow, 2 waiting, 0 approved, 0 rejected');
    await expectNoAxeViolations(page);
    await snap(page, 'copilot-kinds', { element: kinds });
    await snap(page, 'copilot-spend', { element: spend, mask: [spendFigures(spend)] });
    await page.getByRole('link', { name: 'Suggestions to review' }).click();
    await expect(
      page.getByRole('heading', { name: "The Co-pilot's suggestions to review", level: 1 }),
    ).toBeVisible();
    const sheet = page.getByTestId('shadow-review');
    await expect(sheet.getByText('The checks refused nothing in this period.')).toBeVisible();
    const list = sheet.getByRole('list', { name: 'Suggestions, oldest first' });
    for (const suggestion of SNAPSHOT_SUGGESTIONS) {
      const item = list.getByRole('listitem').filter({ hasText: suggestion.title }).first();
      await expect(item).toContainText('Add a follow-up task');
      await expect(item).toContainText('Nothing yet');
      await expect(item).toContainText('Waiting');
    }
    await expectNoAxeViolations(page);
    await snap(page, 'copilot-review', { element: sheet, mask: [sheet.locator('#review-period')] });
  });
});
