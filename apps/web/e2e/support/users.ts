import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The people the journeys act as. The seed (`e2e/setup/seed.ts`, on the host) creates them and
 * writes what the specs need to `e2e/.auth/users.json`; this module only names them, so it runs
 * inside the Linux snapshot container as well.
 */

/** Long enough for the password rules, low-entropy so the secret scan never mistakes it for a key. */
export const E2E_PASSWORD = 'e2e-only-password-e2e-only-password';

/** The projects in `playwright.config.ts`; a single-use link or a fresh person is made per project. */
export const PROJECTS = ['desktop-light', 'desktop-dark', 'phone'] as const;
export type ProjectName = (typeof PROJECTS)[number];

/** A person who signs in once in `auth.setup.ts` and whose session every spec reuses. */
export const SIGNED_IN_ROLES = [
  { key: 'executive', roleKey: 'executive', entityIds: [1, 2, 3, 4], twoFactor: true },
  { key: 'gm', roleKey: 'general_manager', entityIds: [1], twoFactor: true },
  { key: 'accounts', roleKey: 'accounts', entityIds: [1], twoFactor: true },
  { key: 'teleCaller', roleKey: 'tele_caller_cc', entityIds: [1], twoFactor: false },
  { key: 'teamLead', roleKey: 'sales_team_lead', entityIds: [1, 2], twoFactor: false },
  { key: 'storeManager', roleKey: 'store_manager', entityIds: [1], twoFactor: false },
] as const;
export type SignedInRole = (typeof SIGNED_IN_ROLES)[number]['key'];

export function emailFor(key: string): string {
  return `e2e-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}@shakti.test`;
}

/** What the seed hands the specs. */
export interface SeededUsers {
  /** Authenticator secrets (base32) of the enrolled roles, keyed by role key. */
  totpSecrets: Record<string, string>;
  /** Per project: a set-password link for an invited person. */
  setPasswordLinks: Record<ProjectName, string>;
  /** Per project: a person whose role needs an authenticator app that is not set up yet. */
  enrolEmails: Record<ProjectName, string>;
  /** Per project: a person with an authenticator app, for the sign-in code screen. */
  verifyUsers: Record<ProjectName, { email: string; secret: string }>;
  /**
   * Per project: another such person for the profile journey, so two journeys never type the
   * same code for the same person at once and the theme they switch is theirs alone.
   */
  profileUsers: Record<ProjectName, { email: string; secret: string }>;
  /** A lead only company 2 holds, for the company switcher journey. */
  secondCompanyLead: string;
}

export const AUTH_DIR = join(import.meta.dirname, '..', '.auth');

export function storageStatePath(role: SignedInRole): string {
  return join(AUTH_DIR, `${role}.json`);
}

export function seededUsers(): SeededUsers {
  return JSON.parse(readFileSync(join(AUTH_DIR, 'users.json'), 'utf8')) as SeededUsers;
}
