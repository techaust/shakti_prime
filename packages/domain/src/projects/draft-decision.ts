import {
  ProjectSegmentSchema,
  SubsidySchemeSchema,
  type DraftSkipReason,
  type ProjectFlow,
  type ProjectSegment,
  type SubsidyScheme,
} from '@shakti/contracts';

/** What `app.project_order_facts()` answers about an order. */
export interface OrderFacts {
  orderState: string;
  accountId: string;
  siteId: string | null;
  /** The order's lead's pipeline segment; null for a dealer's order, which has no lead. */
  segment: string | null;
  /** The order's quote's scheme; `none` for an order without a quote. */
  scheme: string;
  entityCode: string;
  /** How many projects the order ever had, cancelled ones included. */
  projects: number;
  liveProjectId: string | null;
}

/** An order is confirmed, for a project, from confirmation on and until it is cancelled. */
export function orderConfirmed(state: string): boolean {
  return state !== 'draft' && state !== 'cancelled';
}

/** The segment if it is one whose sale needs installation, else null (`dealer_wholesale`, none). */
export function installSegment(segment: string | null): ProjectSegment | null {
  const parsed = ProjectSegmentSchema.safeParse(segment);
  return parsed.success ? parsed.data : null;
}

/** The project's scheme, snapshotted from the order's quote. */
export function schemeOf(facts: Pick<OrderFacts, 'scheme'>): SubsidyScheme {
  const parsed = SubsidySchemeSchema.safeParse(facts.scheme);
  return parsed.success ? parsed.data : 'none';
}

/** PM Surya Ghar follows the subsidy flow (J4); every other scheme the standard checklist. */
export function flowOf(scheme: SubsidyScheme): ProjectFlow {
  return scheme === 'pm_surya_ghar' ? 'surya_ghar' : 'standard';
}

export type DraftDecision =
  | { draft: true; segment: ProjectSegment; scheme: SubsidyScheme; flow: ProjectFlow }
  | { draft: false; reason: DraftSkipReason };

/**
 * Whether the platform drafts a project for a confirmed order (docs/03-roadmap-appendix/phase4.md
 * §2, question 1 (a)): a confirmed order of an install segment (`farmer_pumps`,
 * `residential_rooftop` or `commercial_epc`, never `dealer_wholesale`) that names a site, and only
 * once per order: an order that ever had a project, even one since cancelled, gets no draft.
 */
export function draftDecision(facts: OrderFacts | undefined): DraftDecision {
  if (facts === undefined || !orderConfirmed(facts.orderState)) {
    return { draft: false, reason: 'order_not_confirmed' };
  }
  if (facts.projects > 0) return { draft: false, reason: 'already_drafted' };
  const segment = installSegment(facts.segment);
  if (segment === null) return { draft: false, reason: 'not_install_segment' };
  if (facts.siteId === null) return { draft: false, reason: 'no_site' };
  const scheme = schemeOf(facts);
  return { draft: true, segment, scheme, flow: flowOf(scheme) };
}
