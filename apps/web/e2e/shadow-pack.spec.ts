import type { Page } from '@playwright/test';
import { SHADOW_PACK } from './shadow-pack-fixtures';
import {
  expect,
  expectNoAxeViolations,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// The G2 shadow review pack (docs/03-roadmap-appendix/phase2.md §8.1). The Executive opens the
// WhatsApp assistant's and the Co-pilot's reports at one week of June 2025 in company 2, where the
// seed keeps the journey's own customer and the agents' work on it (`setup/shadow-pack.ts`), which
// no other journey reads or writes: the figures per kind, the spending per lead and the hand-offs
// are the seed's alone, whichever journeys ran first, so they are read and pictured whole. Then the
// suggestions to review of that week, and printed, the sheet alone, light in every theme.

/** Opens an agent's report from Admin › Agents, at the journey's week of company 2. */
async function openReport(page: Page, link: 'WhatsApp drafts' | 'Co-pilot report') {
  await page.goto('/admin/agents');
  await showCompany(page, SHADOW_PACK.company.name);
  await page.getByRole('link', { name: link }).click();
  await page.getByLabel('From', { exact: true }).fill(SHADOW_PACK.from);
  await page.getByLabel('To', { exact: true }).fill(SHADOW_PACK.to);
  await page.getByRole('button', { name: 'Show', exact: true }).click();
}

const period = `${SHADOW_PACK.company.name}, ${SHADOW_PACK.from} to ${SHADOW_PACK.to}`;

test.describe('the suggestions to review, as an Executive', () => {
  test.use(signedInAs('executive'));

  test('shows the WhatsApp assistant’s figures, and its drafted replies to review printed light', async ({
    page,
  }) => {
    await openReport(page, 'WhatsApp drafts');
    const kinds = page.getByRole('region', { name: 'Suggestions by kind' });
    // Two replies in Shadow (judged by reading them), one refused; the facts and the callback a
    // person bore out after them.
    await expect(kinds).toContainText('2 recorded in shadow, 0 waiting, 0 approved, 0 rejected');
    await expect(kinds).toContainText(
      '0 agreed, 0 approved after an edit, 0 differed, 2 not known yet',
    );
    await expect(kinds).toContainText('A reply recorded in shadow is judged by reading it');
    await expect(kinds).toContainText('1 refused by the checks');
    await expect(
      kinds.getByText('1 agreed, 0 approved after an edit, 0 differed, 0 not known yet'),
    ).toHaveCount(2);
    const spend = page.getByRole('region', { name: 'Spending per lead' });
    await expect(spend).toContainText('₹14.00 a lead, over 1 lead');
    await expect(spend).toContainText('₹14.00 on 5 runs');
    const handoffs = page.getByRole('region', { name: 'Chats handed to the team' });
    await expect(handoffs).toContainText('Handed over by the assistant');
    await expect(handoffs).toContainText('A question only the team can answer: 1');
    await expectNoAxeViolations(page);
    await snap(page, 'concierge-kinds', { element: kinds });
    await snap(page, 'concierge-spend', { element: spend });
    await snap(page, 'concierge-handoffs', { element: handoffs });

    await page.getByRole('link', { name: 'Suggestions to review' }).click();
    await expect(
      page.getByRole('heading', {
        name: "The WhatsApp assistant's suggestions to review",
        level: 1,
      }),
    ).toBeVisible();
    const sheet = page.getByTestId('shadow-review');
    await expect(sheet.getByRole('heading', { name: period })).toBeVisible();
    await expect(sheet.getByText('2 of 2 drafted replies in this period')).toBeVisible();
    const items = sheet
      .getByRole('list', { name: 'Suggestions, oldest first' })
      .getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText(SHADOW_PACK.asked);
    await expect(items.nth(0)).toContainText(SHADOW_PACK.drafts[0]);
    await expect(items.nth(0)).toContainText(SHADOW_PACK.sent);
    await expect(items.nth(1)).toContainText(SHADOW_PACK.drafts[1]);
    await expect(items.nth(1)).toContainText('Nothing yet');
    for (const item of [items.nth(0), items.nth(1)]) {
      await expect(item).toContainText('Recorded in shadow');
      await expect(item).toContainText('Compared with the team');
      await expect(item).toContainText('Not known yet');
    }
    await expectNoAxeViolations(page);
    await snap(page, 'concierge-review', { element: sheet });

    // Printed: the sheet alone, light whatever the theme, without its buttons or the menu.
    await page.emulateMedia({ media: 'print' });
    const printed = page.locator('.print-sheet');
    await expect
      .poll(() => printed.evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe('rgb(255, 255, 255)');
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
    await expect(items.nth(0)).toBeVisible();
    await snap(page, 'concierge-review-print', { element: sheet });
    await page.emulateMedia({ media: null });
  });

  test('shows the Co-pilot’s figures and its suggestions to review', async ({ page }) => {
    await openReport(page, 'Co-pilot report');
    const kinds = page.getByRole('region', { name: 'Suggestions by kind' });
    // Follow-ups: one in Shadow nobody set (not known yet), one a person approved (agreed); a
    // template a person rejected (differed).
    await expect(kinds).toContainText('1 recorded in shadow, 0 waiting, 1 approved, 0 rejected');
    await expect(kinds).toContainText(
      '1 agreed, 0 approved after an edit, 0 differed, 1 not known yet',
    );
    await expect(kinds).toContainText('0 recorded in shadow, 0 waiting, 0 approved, 1 rejected');
    await expect(kinds).toContainText(
      '0 agreed, 0 approved after an edit, 1 differed, 0 not known yet',
    );
    const spend = page.getByRole('region', { name: 'Spending per lead' });
    await expect(spend).toContainText('₹3.00 a lead, over 1 lead');
    await expect(spend).toContainText('₹3.00 on 3 runs');
    await expect(spend).toContainText('The Co-pilot hands nothing over');
    await expectNoAxeViolations(page);
    await snap(page, 'copilot-kinds', { element: kinds });
    await snap(page, 'copilot-spend', { element: spend });

    await page.getByRole('link', { name: 'Suggestions to review' }).click();
    await expect(
      page.getByRole('heading', { name: "The Co-pilot's suggestions to review", level: 1 }),
    ).toBeVisible();
    const sheet = page.getByTestId('shadow-review');
    await expect(sheet.getByRole('heading', { name: period })).toBeVisible();
    await expect(sheet.getByText('3 of 3 suggestions in this period')).toBeVisible();
    await expect(sheet.getByText('The checks refused nothing in this period.')).toBeVisible();
    const items = sheet
      .getByRole('list', { name: 'Suggestions, oldest first' })
      .getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('Task: Ask about the borewell depth');
    await expect(items.nth(0)).toContainText('Not known yet');
    await expect(items.nth(1)).toContainText('Quote ready (Follow-up message)');
    await expect(items.nth(1)).toContainText('Rejected');
    await expect(items.nth(1)).toContainText('Differed');
    await expect(items.nth(2)).toContainText('Task: Send the pump brochure');
    await expect(items.nth(2)).toContainText('Approved');
    await expectNoAxeViolations(page);
    await snap(page, 'copilot-review', { element: sheet });
  });
});
