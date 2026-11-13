import type { LeadChannel } from '@shakti/contracts';
import type { CallPurpose } from './dial-policy';

/**
 * Why a call is a service call or a promotional one (BLUEPRINT §7.7, docs/03-roadmap-appendix/phase2.md
 * §5.2). A call is `service`, on the 160-series, only when the contact has a recorded service
 * consent for calls and the lead is something the customer asked for: an enquiry they made, a
 * callback they asked for, or an order of theirs. Every other call is `promotional`, on the
 * 140-series. Pure: the dial facts (`app.dial_facts()`) feed it.
 */

/**
 * The lead sources where the customer reached out first: an ad's form, the website, a WhatsApp
 * message, a call to the IVR or a missed call, a visit. A referral, an imported list and a lead a
 * caller typed in are the company reaching out.
 */
export const CUSTOMER_REQUEST_CHANNELS: readonly LeadChannel[] = [
  'meta_ads',
  'google_ads',
  'website',
  'whatsapp',
  'ivr',
  'missed_call',
  'walk_in',
];

/** What the purpose is decided from. */
export interface PurposeFacts {
  /** The channel of the lead's source, or null when it has none. */
  sourceChannel: LeadChannel | null;
  /** An open callback task on the lead: the customer asked to be called back. */
  hasOpenCallback: boolean;
  /** The lead has an order that is not cancelled. */
  hasOrder: boolean;
  /** The contact called holds an unwithdrawn service consent for calls. */
  hasServiceConsent: boolean;
}

/** Why the purpose was chosen, for the screen to say in words. */
export type PurposeReason =
  | 'service_order'
  | 'service_callback'
  | 'service_enquiry'
  | 'promotional_no_consent'
  | 'promotional_not_requested';

export interface PurposeDecision {
  purpose: CallPurpose;
  /** Named `why`, not `reason`: it is not an error reason (errors-catalogue.test.ts). */
  why: PurposeReason;
}

/** The call's purpose and why. An order outranks a callback, which outranks an enquiry. */
export function callPurpose(facts: PurposeFacts): PurposeDecision {
  if (!facts.hasServiceConsent) return { purpose: 'promotional', why: 'promotional_no_consent' };
  if (facts.hasOrder) return { purpose: 'service', why: 'service_order' };
  if (facts.hasOpenCallback) return { purpose: 'service', why: 'service_callback' };
  if (facts.sourceChannel !== null && CUSTOMER_REQUEST_CHANNELS.includes(facts.sourceChannel)) {
    return { purpose: 'service', why: 'service_enquiry' };
  }
  return { purpose: 'promotional', why: 'promotional_not_requested' };
}
