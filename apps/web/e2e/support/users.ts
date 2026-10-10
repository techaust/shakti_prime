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
  // A Lead Converter in company 1, present and taking every language and business line: the
  // handover journeys give qualified leads to her (handover.spec.ts).
  {
    key: 'converter',
    name: 'Kishan Verma',
    roleKey: 'tele_caller_lc',
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
  // The snapshot company's own team, for the screenshots of the home pages, Targets and the
  // notification centre (SNAPSHOT_TEAM): synthetic people in a company only the seed writes to, so
  // the figures they show are the seed's alone.
  {
    key: 'snapshotLead',
    name: 'Snapshot Team Lead',
    roleKey: 'sales_team_lead',
    entityIds: [3],
    twoFactor: false,
  },
  {
    key: 'snapshotTracker',
    name: 'Snapshot Tracked Caller',
    roleKey: 'tele_caller_cc',
    entityIds: [3],
    twoFactor: false,
  },
  {
    key: 'snapshotManager',
    name: 'Snapshot General Manager',
    roleKey: 'general_manager',
    entityIds: [3],
    twoFactor: true,
  },
  {
    key: 'snapshotExecutive',
    name: 'Snapshot Executive',
    roleKey: 'executive',
    entityIds: [3],
    twoFactor: true,
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

/**
 * The team of the snapshot company that the home pages' and Targets' screenshots show: the lead and
 * the tracked caller are its two people (users.ts, `snapshotLead` and `snapshotTracker`). The seed
 * sets the caller's daily call target and logs her calls on the quote lead below, relative to the
 * Indian day of each run. The target is a value for these journeys alone, never a client target.
 */
export const SNAPSHOT_TEAM = {
  name: 'Snapshot calling team',
  dailyCallTarget: 25,
  callsToday: 2,
} as const;

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
 * The Knowledge Vault file the seed adds once to the snapshot company and indexes through the fake
 * transport, as a Word document of staff knowledge (knowledge.spec.ts).
 */
export const SNAPSHOT_VAULT = {
  title: 'Solar pump care',
  paragraphs: [
    'Solar pump care',
    'Clean the solar panels every two weeks with plain water and a soft cloth.',
    'Before the monsoon, check that the cable joints at the borewell are dry and tight.',
  ],
  question: 'how often to clean the panels',
} as const;

/**
 * The stand-in agent's suggestions (setup/stand-in-agent.ts). Per project, three for the
 * tele-caller on her lead in company 1: one needing approval that she approves as it is, one she
 * edits first, and one under Suggest that she dismisses; the seed files them afresh on every run.
 */
export const INBOX_SUGGESTIONS: Record<
  ProjectName,
  { approve: string; edit: string; dismiss: string }
> = {
  'desktop-light': {
    approve: 'Call back about the borewell depth',
    edit: 'Ask for the latest electricity bill',
    dismiss: 'Check the pump warranty card',
  },
  'desktop-dark': {
    approve: 'Call back about the pump size',
    edit: 'Ask for a photo of the borewell',
    dismiss: 'Check the panel mounting plan',
  },
  phone: {
    approve: 'Call back about the solar panel count',
    edit: 'Ask about the field size',
    dismiss: 'Check the meter reading',
  },
};

/** The note the edit journey gives a suggestion before approving it. */
export const EDITED_NOTE = 'Ask again before noon';

/**
 * The snapshot caller's two suggestions in the snapshot company, filed afresh each run with fixed
 * due times and never decided by a journey, so the inbox's screenshot shows the same cards.
 */
export const SNAPSHOT_SUGGESTIONS = [
  { title: 'Call back about the pump quote', dueAt: '2031-01-15T05:00:00.000Z' },
  { title: 'Confirm the site visit date', dueAt: '2031-01-16T06:30:00.000Z' },
] as const;

/**
 * Where the kill switch journey works, in one project only, since the switch reaches every
 * project's run: a suggestion for the company's inbox, which the Executive cannot approve while
 * the Caller Co-pilot is stopped there.
 */
export const KILL_SWITCH = {
  company: { entityId: 2, name: 'Shakti Motor Pumps' },
  title: 'Send the borewell survey checklist',
  project: 'desktop-light',
} as const;

/**
 * The referral partner the seed makes once in company 1 and gives a code: the walk-in journey
 * credits a customer to it, and Settings › Pipelines lists it. No journey changes its code.
 */
export const REFERRAL_PARTNER = {
  name: 'Kisan Seva Kendra Chomu',
  phone: '98765 40031',
  code: 'KSK2026',
} as const;

/** Where the quote journeys price, make and send their quotes (`e2e/quotes.spec.ts`). */
export const QUOTE_JOURNEY_COMPANY = { entityId: 2, name: 'Shakti Motor Pumps' } as const;

/** The price tier the seed makes for the quote journeys, with its own price lists. */
export const QUOTE_TIER = 'Journey prices';

/** The sized lead the seed quotes once in the snapshot company, for the quote screenshots. */
export const SNAPSHOT_QUOTE_LEAD = { name: 'Mohan Lal Saini', phone: '98765 40051' } as const;

/** Per project: a sized lead in the journeys' company whose customer has no tier yet. */
export const QUOTE_JOURNEY_LEADS: Record<ProjectName, { name: string; phone: string }> = {
  'desktop-light': { name: 'Hemraj Kumawat', phone: '98765 40052' },
  'desktop-dark': { name: 'Sushila Bairwa', phone: '98765 40053' },
  phone: { name: 'Mangilal Jat', phone: '98765 40054' },
};

/** What the quote journeys need of the seed's quote fixtures. */
export interface QuoteJourneySeed {
  snapshotLeadId: string;
  snapshotQuoteId: string;
  snapshotQuoteNo: string;
  journeyLeads: Record<ProjectName, { accountId: string; name: string }>;
}

/** Per project: the fresh lead of the journeys' company whose quote is accepted and confirmed. */
export const ORDER_JOURNEY_LEADS: Record<ProjectName, string> = {
  'desktop-light': 'Bhagwan Sahay Meena',
  'desktop-dark': 'Kailash Chand Yadav',
  phone: 'Rameshwar Prasad Gurjar',
};

/** Per project: a dealer of the journeys' company with a small limit, so its orders are held. */
export const HELD_DEALERS: Record<ProjectName, string> = {
  'desktop-light': 'Jaipur Solar Traders',
  'desktop-dark': 'Dausa Pump House',
  phone: 'Tonk Krishi Sewa',
};

/** Per project: a dealer of company 1 whose terms and outstanding Accounts enter. */
export const CREDIT_DEALERS: Record<ProjectName, string> = {
  'desktop-light': 'Chomu Agro Agencies',
  'desktop-dark': 'Sikar Solar Point',
  phone: 'Ajmer Pump Centre',
};

/** The dealer the seed keeps in the snapshot company, with one draft order, for the screenshots. */
export const SNAPSHOT_DEALER = 'Shekhawati Solar Distributors';

/** What the order journeys need of the seed's order fixtures. */
export interface OrderJourneySeed {
  acceptLeads: Record<ProjectName, { leadId: string; accountId: string; name: string }>;
  heldDealers: Record<ProjectName, { accountId: string; name: string }>;
  creditDealers: Record<ProjectName, { accountId: string; name: string }>;
  snapshotDealerId: string;
  snapshotOrderId: string;
  snapshotOrderNo: string;
}

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
  /** The quote journeys' fixtures. */
  quotes: QuoteJourneySeed;
  /** The order journeys' fixtures. */
  orders: OrderJourneySeed;
}

export const AUTH_DIR = join(import.meta.dirname, '..', '.auth');

export function storageStatePath(role: SignedInRole): string {
  return join(AUTH_DIR, `${role}.json`);
}

export function seededUsers(): SeededUsers {
  return JSON.parse(readFileSync(join(AUTH_DIR, 'users.json'), 'utf8')) as SeededUsers;
}
