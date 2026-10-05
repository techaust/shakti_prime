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
  {
    key: 'executive',
    name: 'Arvind Mehta',
    roleKey: 'executive',
    entityIds: [1, 2, 3, 4],
    twoFactor: true,
  },
  { key: 'gm', name: 'Sanjay Rathi', roleKey: 'general_manager', entityIds: [1], twoFactor: true },
  { key: 'accounts', name: 'Pooja Agarwal', roleKey: 'accounts', entityIds: [1], twoFactor: true },
  {
    key: 'teleCaller',
    name: 'Neha Saini',
    roleKey: 'tele_caller_cc',
    entityIds: [1],
    twoFactor: false,
  },
  {
    key: 'teamLead',
    name: 'Rakesh Choudhary',
    roleKey: 'sales_team_lead',
    entityIds: [1, 2],
    twoFactor: false,
  },
  {
    key: 'storeManager',
    name: 'Mahesh Kumawat',
    roleKey: 'store_manager',
    entityIds: [1],
    twoFactor: false,
  },
  // The one person in the snapshot company besides the Executive (below).
  {
    key: 'snapshotCaller',
    name: 'Geeta Kumari',
    roleKey: 'tele_caller_cc',
    entityIds: [3],
    twoFactor: false,
  },
] as const;
export type SignedInRole = (typeof SIGNED_IN_ROLES)[number]['key'];

/**
 * The company kept for screenshots of lists: only the seed writes there, never a journey, so the
 * leads list and board, the team, the Activity log and the imports show the same rows every run
 * and only times are masked. A security suite run on the same database may add rows there; CI
 * gives the journeys a fresh one.
 */
export const SNAPSHOT_COMPANY = { entityId: 3, name: 'Agro Solar Hub' } as const;

/** The leads the seed keeps in the snapshot company, all the snapshot caller's. */
export const SNAPSHOT_LEADS = [
  { name: 'Bhanwar Lal Jat', phone: '98765 40011' },
  { name: 'Kamla Devi', phone: '98765 40012' },
  { name: 'Rajendra Singh Rathore', phone: '98765 40013' },
] as const;

/**
 * The update held back in the snapshot company (Integration health), made once with a fixed id
 * and never sent again by a journey, so the page's screenshot shows the same row every run.
 */
export const SNAPSHOT_HELD_BACK_ID = '0199e2e0-0000-7000-8000-00000000d001';

/**
 * Where the Send again journey works: each seed run holds back one update per project there, and
 * each project sends one of them again, so the company always has one to send.
 */
export const SEND_AGAIN_COMPANY = { entityId: 4, name: 'RCREF' } as const;

/** The spreadsheet the seed imports once into the snapshot company. */
export const SNAPSHOT_IMPORT_FILE = 'agro-solar-hub-leads.csv';

/**
 * The referral partner the seed makes once in company 1 and gives a code: the walk-in journey
 * credits a customer to it, and Settings › Pipelines lists it. No journey changes its code.
 */
export const REFERRAL_PARTNER = {
  name: 'Kisan Seva Kendra Chomu',
  phone: '98765 40031',
  code: 'KSK2026',
} as const;

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
