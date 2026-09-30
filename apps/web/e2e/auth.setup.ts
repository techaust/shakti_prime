import { expect, test as setup } from './support/fixtures';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signInThroughScreens } from './support/sign-in';
import { emailFor, seededUsers, SIGNED_IN_ROLES, storageStatePath } from './support/users';

// The journeys judge the production build in `.next`. A server left running from an older build,
// or a dev server on the same port, would answer instead (a local run reuses a server that
// answers), so the run stops unless the server serves this build's own manifest.
setup('the server runs this build', async ({ request }) => {
  const buildIdFile = join(import.meta.dirname, '..', '.next', 'BUILD_ID');
  expect(existsSync(buildIdFile), 'no production build: run `pnpm build` first').toBe(true);
  const buildId = readFileSync(buildIdFile, 'utf8').trim();
  const manifest = await request.get(`/_next/static/${buildId}/_buildManifest.js`);
  expect(
    manifest.status(),
    'the server on this port is not running the current build: stop it, then run `pnpm build`',
  ).toBe(200);
});

// Signs each role in once through the real screens and saves the session for the specs
// (`signedInAs(role)` in support/fixtures.ts). The people come from `e2e:seed`.
for (const role of SIGNED_IN_ROLES) {
  setup(`sign in as ${role.key}`, async ({ page }) => {
    const secret = role.twoFactor ? seededUsers().totpSecrets[role.key] : undefined;
    await signInThroughScreens(page, emailFor(role.key), secret);
    await page.context().storageState({ path: storageStatePath(role.key) });
  });
}
