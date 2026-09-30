import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SEND_AGAIN_COMPANY, SNAPSHOT_COMPANY } from './support/users';

const WAITING = 'Updates waiting to go out, by kind';
const HELD = 'Updates held back after ten tries, newest first';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  // The snapshot company holds one fixed update held back (setup/seed.ts) and nothing else, so
  // the screenshot shows the same rows every run; the last round and the check are masked.
  test('integration health shows the counts, the held-back updates and the delivery speed', async ({
    page,
  }) => {
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Integration health', level: 1 })).toBeVisible();
    await showCompany(page, SNAPSHOT_COMPANY.name);

    const waiting = dataGrid(page, WAITING);
    await expect(waiting.getByText('Person reactivated')).toBeVisible();
    const held = dataGrid(page, HELD);
    await expect(held.getByText('The step that handles it failed.')).toBeVisible();
    await expect(held.getByRole('button', { name: 'Send again' })).toBeVisible();

    // Locally and in CI no queue is configured, so the check's worker runs in the app itself.
    await page.getByRole('button', { name: 'Check delivery speed' }).click();
    await expect(page.getByRole('status').filter({ hasText: /^Arrived in / })).toBeVisible();

    await expectNoAxeViolations(page);
    await snap(page, 'integration-health');
  });

  test('Send again puts a held-back update back in the queue', async ({ page }) => {
    await page.goto('/admin/integrations');
    await showCompany(page, SEND_AGAIN_COMPANY.name);
    const held = dataGrid(page, HELD);
    const sendAgain = held.getByRole('button', { name: 'Send again' });
    await expect(sendAgain.first()).toBeVisible();
    // The button keeps its visible words as its name and says which update it sends.
    await expect(sendAgain.first()).toHaveAccessibleDescription(/^.+, held back at \d/);
    const before = await sendAgain.count();
    await sendAgain.first().click();
    await expect(page.getByText('The update goes out again within a minute.')).toBeVisible();
    await expect(sendAgain).toHaveCount(before - 1);
  });
});

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('Integration health is not a screen the role may open', async ({ page }) => {
    await page.goto('/admin/integrations');
    await expect(
      page
        .getByRole('heading', { name: 'We couldn’t find this screen' })
        .or(page.getByRole('heading', { name: "We couldn't find this screen" })),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Integration health' })).toHaveCount(0);
  });
});
