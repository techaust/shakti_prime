import { wordDocument } from './support/docx';
import {
  expect,
  expectNoAxeViolations,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { SNAPSHOT_VAULT } from './support/users';

// The Knowledge Vault (docs/design/phase1.md §8.4, PRD AI-01). The journeys' app runs with the
// fake AI transport (`AI_TRANSPORT=fake`, playwright.config.ts): a Word file is read by the app's
// own Word reader, its passages are embedded by the stand-in, which puts texts that share words
// close together, and the search finds them. Every text is synthetic.

const WORD = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('uploads a Word file, sees it read for search, and finds it', async ({ page }) => {
    // A word of this run's own, so the search finds this run's file and no earlier one.
    const word = `drip${projectName().replace(/[^a-z]/g, '')}${Date.now().toString(36)}`;
    const title = `Irrigation notes ${word}`;
    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    await page.getByRole('button', { name: 'Add a file' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Add a file to the Knowledge Vault' }),
    ).toBeVisible();
    await dialog.getByLabel('Title').fill(title);
    // For one company, so the snapshot company's screen never lists it.
    await dialog.getByLabel('For').selectOption({ label: 'Shakti Supreme' });
    await expect(dialog.getByLabel('Who can find it')).toHaveValue('staff_ai_ok');
    await expectNoAxeViolations(page);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: 'Irrigation notes.docx',
      mimeType: WORD,
      buffer: wordDocument([
        'Irrigation notes',
        `Run the ${word} line for twenty minutes at sunrise.`,
        'Flush the filters once a month.',
      ]),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(dialog.getByText('Uploaded and checked. Add it to the vault.')).toBeVisible({
      timeout: 45_000,
    });
    await dialog.getByRole('button', { name: 'Add to the vault' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Added. The file is being read for search.')).toBeVisible();

    // The app reads it at once on this machine; the list is read again until it is ready.
    const card = page.getByRole('listitem').filter({ hasText: title });
    await expect(card.getByText('Ready to search')).toBeVisible({ timeout: 45_000 });
    await expect(card.getByText('Shakti Supreme')).toBeVisible();
    await expect(card.getByText('All staff')).toBeVisible();

    await page.getByLabel('What do you want to know?').fill(`when to run the ${word} line`);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const hit = page.getByRole('listitem').filter({ hasText: `From ${title}` });
    await expect(hit).toBeVisible();
    await expect(hit.getByText(`Run the ${word} line for twenty minutes at sunrise.`)).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('as a tele-caller of the snapshot company', () => {
  test.use(signedInAs('snapshotCaller'));

  test('searches the staff knowledge and cannot change the vault', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByRole('heading', { name: 'Knowledge', level: 1 })).toBeVisible();
    const card = page.getByRole('listitem').filter({ hasText: SNAPSHOT_VAULT.title });
    await expect(card.getByText('Ready to search')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add a file' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Archive' })).toHaveCount(0);

    await page.getByLabel('What do you want to know?').fill(SNAPSHOT_VAULT.question);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const hit = page.getByRole('listitem').filter({ hasText: `From ${SNAPSHOT_VAULT.title}` });
    await expect(hit.first()).toBeVisible();
    await expect(
      hit.first().getByText('Clean the solar panels every two weeks', { exact: false }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'knowledge');
  });
});
