import type {
  AccountType,
  ConsentChannel,
  ConsentPurpose,
  Segment,
  SiteType,
} from '@shakti/contracts';

// The walk-in quick form (docs/03-roadmap-appendix/phase1.md §6.6, CRM-01): what the Store Manager types at
// the counter, turned into the `crm.lead.create` input. Pure, so the form and its tests share it.

/**
 * The kind of customer and of site a walk-in's interest implies, so the counter asks neither. A
 * dealer's enquiry has no site of its own, so the form asks no village for it.
 */
export const WALK_IN_KINDS: Record<Segment, { account: AccountType; site: SiteType | undefined }> =
  {
    farmer_pumps: { account: 'farm', site: 'borewell' },
    residential_rooftop: { account: 'household', site: 'rooftop' },
    commercial_epc: { account: 'business', site: 'rooftop' },
    dealer_wholesale: { account: 'dealer', site: undefined },
  };

/** The lead source every walk-in lead carries (`lead_sources.code`). */
export const WALK_IN_SOURCE = 'walk_in';

/** A consent wording the counter shows: its version and what it covers (workshop LAW-1). */
export interface WalkInConsent {
  textVersion: string;
  channel: ConsentChannel;
  purpose: ConsentPurpose;
}

export interface WalkInFields {
  entityId: string;
  pipelineKey: string;
  segment: Segment | undefined;
  name: string;
  phone: string;
  /** The language of the customer's calls; Hinglish unless the counter chooses English. */
  language: string;
  village: string;
  pin: string;
  referralCode: string;
  /**
   * The consent the customer ticked, as its wording records it (channel, purpose and the version
   * of the text shown); undefined when none was given.
   */
  consent: WalkInConsent | undefined;
}

/**
 * The `crm.lead.create` input for a walk-in. Empty parts are left out, so the command decides
 * what is missing and answers with the field it is about. A PIN is sent with its village; a PIN
 * alone is answered by `walkInProblem` before anything is sent.
 */
export function buildWalkInInput(f: WalkInFields): Record<string, unknown> {
  const kinds = f.segment === undefined ? undefined : WALK_IN_KINDS[f.segment];
  const village = f.village.trim();
  const pin = f.pin.trim();
  const code = f.referralCode.trim();
  return {
    entityId: Number(f.entityId),
    pipelineKey: f.pipelineKey,
    contact: { name: f.name, phone: f.phone, preferredLanguage: f.language || 'hinglish' },
    account: { type: kinds?.account ?? '' },
    ...(village === '' || kinds?.site === undefined
      ? {}
      : { site: { type: kinds.site, village, ...(pin === '' ? {} : { pin }) } }),
    sourceCode: WALK_IN_SOURCE,
    ...(code === '' ? {} : { referralCode: code }),
    ...(f.consent === undefined ? {} : { consent: { ...f.consent, source: 'walk_in_form' } }),
  };
}

/**
 * A problem the form answers itself: a PIN typed without the village it belongs to. A PIN alone
 * will find its village once the PIN code master exists (slice P2b, PRD CRM-02); until then the
 * village is asked for.
 */
export function walkInProblem(
  f: Pick<WalkInFields, 'village' | 'pin'>,
): 'villageNeeded' | undefined {
  return f.pin.trim() !== '' && f.village.trim() === '' ? 'villageNeeded' : undefined;
}
