import { test as setup } from '@playwright/test';
import { signInThroughScreens } from './support/sign-in';
import { emailFor, seededUsers, SIGNED_IN_ROLES, storageStatePath } from './support/users';

// Signs each role in once through the real screens and saves the session for the specs
// (`signedInAs(role)` in support/fixtures.ts). The people come from `e2e:seed`.
for (const role of SIGNED_IN_ROLES) {
  setup(`sign in as ${role.key}`, async ({ page }) => {
    const secret = role.twoFactor ? seededUsers().totpSecrets[role.key] : undefined;
    await signInThroughScreens(page, emailFor(role.key), secret);
    await page.context().storageState({ path: storageStatePath(role.key) });
  });
}
