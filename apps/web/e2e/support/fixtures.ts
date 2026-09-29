import { test as base, expect } from '@playwright/test';
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
