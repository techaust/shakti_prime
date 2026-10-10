import {
  dataGrid,
  expect,
  expectNoAxeViolations,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { solidPng } from './support/png';

test.describe('the logo and letterhead of a company', () => {
  test.use(signedInAs('executive'));

  test('an Executive uploads a logo and a letterhead, which become the current ones once checked', async ({
    page,
  }) => {
    await page.goto('/settings/companies');
    await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
    // The page's title streams in after its content; axe needs it (document-title).
    await expect(page).toHaveTitle(/^Companies · /);
    await dataGrid(page, 'Companies')
      .getByRole('button', { name: 'Logo and letterhead' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Logo and letterhead of/ })).toBeVisible();
    await expectNoAxeViolations(page);

    const inputs = dialog.locator('input[type="file"]');
    const saved = dialog.getByText('Saved. Documents from this company print it from now on.');
    await inputs.nth(0).setInputFiles({
      name: 'Shakti Supreme logo.png',
      mimeType: 'image/png',
      buffer: solidPng(),
    });
    // The checks run in the app itself on this machine (no queue), then the uploader says so.
    await expect(saved).toHaveCount(1, { timeout: 45_000 });
    await inputs.nth(1).setInputFiles({
      name: 'Shakti Supreme letterhead.png',
      mimeType: 'image/png',
      buffer: solidPng(),
    });
    await expect(saved).toHaveCount(2, { timeout: 45_000 });
    await expect(dialog.getByText('Current file: Shakti Supreme logo.png')).toBeVisible();
    await expect(dialog.getByText('Current file: Shakti Supreme letterhead.png')).toBeVisible();
    await expectNoAxeViolations(page);
    // Both files are this journey's own, so the dialog looks the same on every run.
    await snap(page, 'branding-dialog');
  });

  test('a PDF on the logo field is refused before anything is sent', async ({ page }) => {
    await page.goto('/settings/companies');
    await dataGrid(page, 'Companies')
      .getByRole('button', { name: 'Logo and letterhead' })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    const uploads: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PUT' || request.url().includes('/files/')) {
        uploads.push(request.url());
      }
    });
    await dialog
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'Logo.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n%%EOF\n'),
      });
    await expect(
      dialog.getByText('This kind of file cannot be used here. Choose a JPEG, PNG or WebP file.'),
    ).toBeVisible();
    expect(uploads).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
