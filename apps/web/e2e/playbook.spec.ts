import { SNAPSHOT_VAULT, SNAPSHOT_PLAYBOOK } from './support/users';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// The Playbook (docs/03-roadmap-appendix/phase2.md §5.4, PRD AI-01). The journeys' app runs with
// the fake AI transport (`AI_TRANSPORT=fake`): the conflict check embeds rules with the stand-in,
// which puts rules that share words close together, and the stand-in model answers nothing, so a
// close pair is left for a person to decide. Every rule is synthetic and for one company, so the
// snapshot company's screen lists only the seed's rules.

/** Words of this run's own, so a rule meets no earlier run's. */
function words(): string {
  const run = `${projectName().replace(/[^a-z]/g, '')}${Date.now().toString(36)}`;
  return `visit${run} borewell${run}`;
}

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('drafts a rule, approves it, settles a clash with a second, and retires the first', async ({
    page,
  }) => {
    // Two drafts, each checked in the app after it is saved, then the decisions.
    test.setTimeout(150_000);
    const shared = words();
    await page.goto('/knowledge/playbook');
    await expect(page.getByRole('heading', { name: 'Playbook', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    // The first rule: nothing approved is near it, so once checked it can be approved.
    await page.getByRole('button', { name: 'New rule' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Short name').fill(`Pump ${shared} visits`);
    await dialog
      .getByLabel('The rule')
      .fill(`Book the ${shared} visit within two days of the call.`);
    await dialog.getByLabel('Who it is for').selectOption('staff');
    await dialog.getByLabel('For', { exact: true }).selectOption({ label: 'Shakti Supreme' });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Rule saved.', { exact: false })).toBeVisible();
    const review = page.getByRole('region', { name: `Pump ${shared} visits`, exact: true });
    await expect(review.getByText('It does not clash with any approved rule.')).toBeVisible({
      timeout: 45_000,
    });
    await review.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Rule approved.', { exact: false })).toBeVisible();

    // The second rule says nearly the same: the check puts the first beside it, and the stand-in
    // model cannot tell, so approval waits for the Executive's decision.
    await page.getByRole('button', { name: 'New rule' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Short name').fill(`Pump ${shared} visits again`);
    await dialog
      .getByLabel('The rule')
      .fill(`Book the ${shared} visit within three days of the call.`);
    await dialog.getByLabel('Who it is for').selectOption('staff');
    await dialog.getByLabel('For', { exact: true }).selectOption({ label: 'Shakti Supreme' });
    await dialog.getByRole('button', { name: 'Save' }).click();
    const second = page.getByRole('region', { name: `Pump ${shared} visits again`, exact: true });
    await expect(
      second.getByText("We couldn't tell whether these clash. Read both and decide."),
    ).toBeVisible({ timeout: 45_000 });
    await expect(
      second.getByText(`Book the ${shared} visit within two days of the call.`),
    ).toBeVisible();
    await expect(second.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expectNoAxeViolations(page);
    await second.getByRole('button', { name: 'Not a clash' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Why').fill('The second rule is for the busy season.');
    await dialog.getByRole('button', { name: 'Not a clash' }).click();
    await expect(page.getByText('Clash settled.')).toBeVisible();
    await expect(second.getByText('Settled: Not a clash', { exact: false })).toBeVisible();
    // A approves the rule under review.
    await page.keyboard.press('a');
    await expect(page.getByText('Rule approved.', { exact: false })).toBeVisible();

    // The first rule is retired with its reason.
    await page
      .getByRole('listitem')
      .filter({ has: page.getByText(`Pump ${shared} visits`, { exact: true }) })
      .getByRole('button')
      .click();
    const first = page.getByRole('region', { name: `Pump ${shared} visits`, exact: true });
    await first.getByRole('button', { name: 'Retire' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Why').fill('Replaced by the busy season rule.');
    await dialog.getByRole('button', { name: 'Retire' }).click();
    await expect(page.getByText('Rule retired.')).toBeVisible();
    await expect(
      first.getByText('Replaced by the busy season rule.', { exact: false }),
    ).toBeVisible();
  });

  test('drafts from a vault file, which gives no rule while the model answers nothing', async ({
    page,
  }) => {
    await page.goto('/knowledge/playbook');
    await page.getByRole('button', { name: 'Draft from a file' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Draft rules from a file' })).toBeVisible();
    await dialog.getByLabel('File').selectOption({ label: SNAPSHOT_VAULT.title });
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Draft rules' }).click();
    await expect(dialog).toBeHidden({ timeout: 45_000 });
    await expect(page.getByText('The file states no rule we could draft.')).toBeVisible();
  });
});

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('drafts a rule but cannot approve it', async ({ page }) => {
    test.setTimeout(90_000);
    const shared = words();
    await page.goto('/knowledge/playbook');
    await page.getByRole('button', { name: 'New rule' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Short name').fill(`Manager ${shared} rule`);
    await dialog.getByLabel('The rule').fill(`Call back ${shared} customers before noon.`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    const review = page.getByRole('region', { name: `Manager ${shared} rule`, exact: true });
    await expect(review.getByText('It does not clash with any approved rule.')).toBeVisible({
      timeout: 45_000,
    });
    await expect(review.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('does not see the Playbook', async ({ page }) => {
    await page.goto('/knowledge/playbook');
    await expect(page.getByRole('heading', { name: 'Playbook', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Playbook' })).toHaveCount(0);
  });
});

test.describe('as the snapshot company’s Executive', () => {
  test.use(signedInAs('snapshotExecutive'));

  test('reviews a draft beside the approved rule it overlaps', async ({ page }) => {
    await page.goto('/knowledge/playbook');
    const review = page.getByRole('region', { name: SNAPSHOT_PLAYBOOK.draft.title, exact: true });
    await expect(review.getByText(SNAPSHOT_PLAYBOOK.reason)).toBeVisible();
    await expect(review.getByText(SNAPSHOT_PLAYBOOK.approved.text)).toBeVisible();
    await expect(review.getByRole('button', { name: 'Approve' })).toBeDisabled();
    // J and K move through the list (pressed again until the page has taken its keys).
    const approvedReview = page.getByRole('region', {
      name: SNAPSHOT_PLAYBOOK.approved.title,
      exact: true,
    });
    await expect(async () => {
      await page.keyboard.press('j');
      await expect(approvedReview).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await page.keyboard.press('k');
    await expect(review).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'playbook');
  });
});
