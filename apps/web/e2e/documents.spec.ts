import {
  expect,
  expectNoAxeViolations,
  hydrated,
  projectName,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { solidPng } from './support/png';
import { DOCUMENTS_JOURNEY } from './support/users';

// J3 customer documents (docs/03-roadmap-appendix/phase4.md §6.3): the Project Manager sees a
// customer's bill and identity paper, the identity paper's number only as its last four digits,
// and uploads documents that are checked, masked and filed; the Field Engineer who looks after the
// customer sees the bill and no identity paper; the Executive keeps the requirements.

const { entityId, filed, uploads } = DOCUMENTS_JOURNEY;
const customerPage = (accountId: string) => `/customers/${accountId}?company=${String(entityId)}`;

test.describe('a customer’s documents, for the Project Manager', () => {
  test.use(signedInAs('projectManager'));

  test('shows the requirements, the bill and the identity paper with its last four digits only', async ({
    page,
  }) => {
    await page.goto(customerPage(filed.accountId));
    const section = page.getByRole('region', { name: 'Documents' });
    await expect(section.getByRole('heading', { name: 'Filed documents' })).toBeVisible();
    await expect(section.getByText('Identity or bank paper')).toBeVisible();
    await expect(section.getByText(`Aadhaar number ending ${filed.lastFour}`)).toBeVisible();
    await expect(section.getByRole('button', { name: 'Open the Identity proof' })).toBeVisible();
    // The survey asks for site photos too, which the customer has not given yet.
    await expect(section.getByText('Missing').first()).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'customer-documents', { element: section });

    // The masked copy opens in a new tab through a short-lived address.
    const opened = page.waitForEvent('popup');
    await section.getByRole('button', { name: 'Open the Identity proof' }).click();
    const tab = await opened;
    await expect.poll(() => tab.url()).toContain('customer_document');
    await tab.close();
  });

  test('uploads a bill and an identity paper, each checked, masked and filed', async ({ page }) => {
    // The masking step needs the English OCR model on the server (`OCR_LANG_PATH`); without it
    // every customer document is refused before it is kept, as it must be.
    test.skip(
      (process.env.OCR_LANG_PATH ?? '') === '',
      'the journeys’ server has no masking step here',
    );
    const customer = uploads[projectName()];
    await page.goto(customerPage(customer.accountId));
    const section = page.getByRole('region', { name: 'Documents' });
    for (const [requirement, kind] of [
      ['Electricity bill', 'Electricity bill'],
      ['Identity proof', 'Identity proof'],
    ] as const) {
      await (
        await hydrated(section.getByRole('button', { name: `Upload ${requirement}` }))
      ).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: 'Upload a document' })).toBeVisible();
      await expect(dialog.getByLabel('What it is')).toHaveValue(
        kind === 'Electricity bill' ? 'electricity_bill' : 'identity_proof',
      );
      await expectNoAxeViolations(page);
      await dialog.locator('input[type="file"]').setInputFiles({
        name: `${kind}.png`,
        mimeType: 'image/png',
        buffer: solidPng(400, 240),
      });
      await expect(page.getByText('Document filed.')).toBeVisible({ timeout: 60_000 });
      await expect(dialog).toBeHidden();
    }
    await expect(section.getByRole('button', { name: 'Open the Identity proof' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Open the Electricity bill' })).toBeVisible();
  });
});

test.describe('a customer’s documents, for the Field Engineer who looks after the customer', () => {
  test.use(signedInAs('fieldEngineer'));

  test('shows the bill and no identity paper, nor any of its digits', async ({ page }) => {
    await page.goto(customerPage(filed.accountId));
    const section = page.getByRole('region', { name: 'Documents' });
    await expect(section.getByRole('button', { name: 'Open the Electricity bill' })).toBeVisible();
    await expect(section.getByRole('button', { name: 'Open the Identity proof' })).toHaveCount(0);
    await expect(section.getByText('Identity or bank paper')).toHaveCount(0);
    await expect(page.getByText(filed.lastFour)).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
});

test.describe('Settings › Document requirements, for the Executive', () => {
  test.use(signedInAs('executive'));

  test('lists each step’s requirements and saves one', async ({ page }) => {
    await page.goto('/settings/document-requirements');
    await expect(
      page.getByRole('heading', { name: 'Document requirements', level: 1 }),
    ).toBeVisible();
    // The page's title streams in after its content; axe needs it (document-title).
    await expect(page).toHaveTitle(/^Document requirements · /);
    const survey = page.getByRole('region', { name: 'Survey' });
    await expect(survey.getByText('Electricity bill')).toBeVisible();
    await expectNoAxeViolations(page);
    await snap(page, 'document-requirements');

    await (await hydrated(survey.getByRole('button', { name: 'Edit Property papers' }))).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Property papers' })).toBeVisible();
    await expectNoAxeViolations(page);
    // Saved as it stands, so the seeded requirements are the same on every run.
    await dialog.getByRole('button', { name: 'Save requirement' }).click();
    await expect(page.getByText('Requirement saved.')).toBeVisible();
  });
});
