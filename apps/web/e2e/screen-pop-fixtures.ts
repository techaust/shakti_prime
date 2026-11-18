// What the screen-pop journeys (`e2e/screen-pop.spec.ts`) and their seed (`e2e/setup/screen-pop.ts`)
// agree on. No database code here, so the journey runs inside the Linux snapshot container too.
import type { ProjectName } from './support/users';

/** Company 1's incoming calls number, a synthetic one no other journey or suite uses. */
export const POP_IVR = { e164: '+918069000101', national: '08069000101' } as const;

/** The tele-caller of company 1 each project signs in as (one per project: a call rings one person). */
export const POP_CALLER_NAME = 'Lalita Kanwar';

/** The key of a project's caller: `emailFor(popCallerKey(project))` is the email they sign in with. */
export function popCallerKey(project: ProjectName): string {
  return `screen-pop-${project}`;
}

/** Each project's caller's own phone for calls, which the incoming calls number rings. */
export const POP_DIAL_PHONES: Record<ProjectName, string> = {
  'desktop-light': '+919800000281',
  'desktop-dark': '+919800000282',
  phone: '+919800000283',
};

interface PopCustomers {
  /** The one customer of company 1 with this number, the caller's own. */
  one: { name: string; phone: string };
  /** Two customers of the caller's sharing one number; the second also has a number of its own. */
  shared: { names: readonly [string, string]; phone: string; ownPhone: string };
}

/** Each project's customers, made once and kept (the screens read the same on every run). */
export const POP_CUSTOMERS: Record<ProjectName, PopCustomers> = {
  'desktop-light': {
    one: { name: 'Girdhari Lal Saini', phone: '98765 40071' },
    shared: {
      names: ['Kamla Devi Jat', 'Mangilal Jat'],
      phone: '98765 40081',
      ownPhone: '98765 40091',
    },
  },
  'desktop-dark': {
    one: { name: 'Ramprasad Gurjar', phone: '98765 40072' },
    shared: {
      names: ['Santosh Kumari Meena', 'Bhagirath Meena'],
      phone: '98765 40082',
      ownPhone: '98765 40092',
    },
  },
  phone: {
    one: { name: 'Prabhu Dayal Yadav', phone: '98765 40073' },
    shared: {
      names: ['Sushila Devi Kumawat', 'Ganesh Kumawat'],
      phone: '98765 40083',
      ownPhone: '98765 40093',
    },
  },
};

/** A number as Exotel's Passthru applet writes it: the national form with its leading 0. */
export function passthruNumber(typed: string): string {
  const digits = typed.replace(/\D/g, '');
  return `0${digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits}`;
}
