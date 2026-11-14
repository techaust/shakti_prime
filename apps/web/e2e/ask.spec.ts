import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';

// Ask the Business (docs/03-roadmap-appendix/phase2.md §6.5, PRD AI-02). The journeys' app runs
// with the fake AI transport (`AI_TRANSPORT=fake`), which plays Ask's stand-in recording: the
// model asks for the open leads by stage and answers with the first stage that has any, citing it.
// The lookup, the grounding filter, the stored conversation and the screen are all real.

/** An answer in the open conversation: a cited stage, or the plain sentence when none is open. */
const ANSWERED = /open leads|None of the leads you can see is open right now\./;

test.describe('as a General Manager', () => {
  test.use(signedInAs('gm'));

  test('asks a question, sees the answer with its sources, follows it up, and deletes the conversation', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/ask');
    await expect(page.getByRole('heading', { name: 'Ask the Business', level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);

    const question = `How many open leads are in each stage, ${projectName()} ${Date.now().toString(36)}?`;
    const box = await hydrated(page.getByLabel('Your question'));
    await box.fill(question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const open = page.getByRole('region', { name: question });
    await expect(open.getByRole('article').first()).toContainText(ANSWERED, { timeout: 45_000 });
    // The citation is a numbered link to its record, never the raw mark.
    await expect(open).not.toContainText('[ref:');
    await expect(open).not.toContainText('[unsourced]');
    const sources = open.getByRole('region', { name: 'Where this comes from' });
    if ((await sources.count()) > 0) {
      await expect(sources.getByText('Pipeline stage')).toBeVisible();
    }
    await expectNoAxeViolations(page);

    // The conversation is in the list, and a follow-up stays in it.
    const listed = page.getByRole('navigation', { name: 'Your conversations' });
    await expect(listed.getByRole('button', { name: question })).toBeVisible();
    await expect(page.getByText('Ask a follow-up question in this conversation.')).toBeVisible();
    await box.fill('And again?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(open.getByRole('article')).toHaveCount(2, { timeout: 45_000 });

    // Deleting asks first, then removes it from the list.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.getByText('Conversation deleted.')).toBeVisible();
    await expect(listed.getByRole('button', { name: question })).toHaveCount(0);
  });
});

test.describe('as a tele-caller', () => {
  test.use(signedInAs('teleCaller'));

  test('does not see Ask the Business', async ({ page }) => {
    await page.goto('/ask');
    await expect(page.getByRole('heading', { name: 'Ask the Business', level: 1 })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Ask the Business' })).toHaveCount(0);
  });
});

test.describe('as the snapshot company’s Executive', () => {
  test.use(signedInAs('snapshotExecutive'));

  test('reads an answer with its figures and sources', async ({ page }) => {
    test.setTimeout(90_000);
    await page.goto('/ask');
    const box = await hydrated(page.getByLabel('Your question'));
    const question = 'How many open leads are in each stage?';
    await box.fill(question);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    const open = page.getByRole('region', { name: question });
    await expect(open.getByRole('article')).toContainText(ANSWERED, { timeout: 45_000 });
    await expectNoAxeViolations(page);
    // The list grows with every project's run of this journey, so only the answer is compared.
    await snap(page, 'ask', {
      mask: [page.getByRole('navigation', { name: 'Your conversations' })],
    });
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete for good' }).click();
    await expect(page.getByText('Conversation deleted.')).toBeVisible();
  });
});
