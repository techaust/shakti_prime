import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { storageStatePath, type ProjectName, type SignedInRole } from './users';

export { expect };
export { expectNoAxeViolations } from './axe';
export { snap } from './snap';

export const test = base;

/** The running project (desktop light, desktop dark, phone), for the per-project people of the seed. */
export function projectName(): ProjectName {
  return base.info().project.name as ProjectName;
}

/** `test.use(signedInAs('teleCaller'))`: the specs of a describe block act as that role. */
export function signedInAs(role: SignedInRole): { storageState: string } {
  return { storageState: storageStatePath(role) };
}

/** A fresh visitor with no session, for the public screens. */
export const signedOut = { storageState: { cookies: [], origins: [] } };

/**
 * A data grid by its caption: the table on wider screens, the list of cards on a phone
 * (packages/ui/src/data-grid.tsx), whichever the project shows.
 */
export function dataGrid(page: Page, caption: string): Locator {
  return page
    .getByRole('table', { name: caption })
    .or(page.getByRole('list', { name: caption }))
    .filter({ visible: true });
}
