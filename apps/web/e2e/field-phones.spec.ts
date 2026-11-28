import {
  expect,
  expectNoAxeViolations,
  projectName,
  showCompany,
  signedInAs,
  snap,
  test,
} from './support/fixtures';
import { FIELD_PHONES, SNAPSHOT_COMPANY } from './support/users';

// F1 (docs/03-roadmap-appendix/phase4.md §6.4): Admin › Team members › Phones. An Executive signs a
// lost phone out of the field app; the phone's next call to the BOS is refused (mobile-auth.test.ts).

test.describe('as an Executive', () => {
  test.use(signedInAs('executive'));

  test('sees a person’s phones', async ({ page }) => {
    await page.goto('/admin/users');
    await showCompany(page, SNAPSHOT_COMPANY.name);
    await page.getByRole('button', { name: 'Actions for Geeta Kumari' }).click();
    await page.getByRole('menuitem', { name: 'Phones' }).click();
    const sheet = page.getByRole('dialog', { name: 'Phones of Geeta Kumari' });
    await expect(sheet.getByText(FIELD_PHONES.snapshot.model)).toBeVisible();
    await expect(sheet.getByText('Signed in', { exact: true })).toBeVisible();
    await expect(sheet.getByText('App version 1.0.0')).toBeVisible();
    await expectNoAxeViolations(page, { include: '[role="dialog"]' });
    await snap(page, 'team-member-phones');
  });

  test('signs a lost phone out', async ({ page }) => {
    const owner = FIELD_PHONES.owners[projectName()].name;
    await page.goto('/admin/users');
    await page.getByRole('button', { name: `Actions for ${owner}` }).click();
    await page.getByRole('menuitem', { name: 'Phones' }).click();
    const sheet = page.getByRole('dialog', { name: `Phones of ${owner}` });
    await expect(sheet.getByText(FIELD_PHONES.ownerModel)).toBeVisible();
    await sheet.getByRole('button', { name: `Sign out ${FIELD_PHONES.ownerModel}` }).click();
    await expect(
      page.getByText(
        'That phone is signed out. The app asks for the email and password the next time it is opened.',
      ),
    ).toBeVisible();
    await expect(sheet.getByText('Signed out from the website')).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: `Sign out ${FIELD_PHONES.ownerModel}` }),
    ).toHaveCount(0);
  });
});
