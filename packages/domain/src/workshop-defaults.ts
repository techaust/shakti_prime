import {
  WORKSHOP_DISPOSITIONS,
  type DispositionNextAction,
  type Segment,
  type SupplySource,
} from '@shakti/contracts';

export interface WorkshopDefaults {
  readonly tax: {
    readonly placeOfSupplyOrder: readonly SupplySource[];
    readonly roundDocumentToRupee: boolean;
    readonly compositeSegments: readonly Segment[];
  };
  readonly opportunity: {
    readonly handoverLockHours: number;
    readonly reopenWindowDays: number;
  };
  readonly quote: { readonly validityDays: number };
  readonly credit: { readonly exposureCountsConfirmedOrders: boolean };
  readonly dispatch: { readonly ewayBillThresholdPaise: bigint };
  readonly crm: {
    readonly dispositions: readonly {
      readonly key: number;
      readonly code: string;
      readonly label: string;
      readonly nextAction: DispositionNextAction;
    }[];
    readonly scoreBase: number;
    readonly scoreRules: readonly [];
    readonly firstContactSlaMinutes: number | null;
  };
}

/**
 * Every default the tax engine and the state machines use in place of an answer the discovery
 * workshop has not yet given (docs/design/backend-weeks-3-5.md §11, BLUEPRINT §19). The workshop
 * changes a value here and nowhere else; the state-machine documents list these values, so
 * regenerate them (`pnpm --filter @shakti/domain machines:docs`) after a change.
 *
 * Each entry names where the default comes from. Values that are settled by the blueprint (the
 * 15-day quote validity, the ₹50,000 e-way bill threshold) live here too because the blueprint
 * calls them configurable.
 */
export const WORKSHOP_DEFAULTS: WorkshopDefaults = {
  tax: {
    /** Design §11 q1 (CA): site state, else the state in the account's GSTIN, else the entity's. */
    placeOfSupplyOrder: ['site', 'account_gstin', 'entity'],
    /** Design §11 q1 (CA): the document total rounds to the whole rupee, the difference in `round_off`. */
    roundDocumentToRupee: true,
    /** Design §6: composite supply applies to works-contract lines in these segments only. */
    compositeSegments: ['residential_rooftop', 'commercial_epc'],
  },
  opportunity: {
    /** Design §11 q2: how long an assignment locks the owner (per pipeline later). */
    handoverLockHours: 48,
    /** Design §7.2: a lost opportunity may be reopened within this many days. */
    reopenWindowDays: 30,
  },
  quote: {
    /** BLUEPRINT §8.3: calendar days of validity, ending at the end of the day in IST. */
    validityDays: 15,
  },
  credit: {
    /** Design §11 q3: dealer exposure counts confirmed orders not yet paid. */
    exposureCountsConfirmedOrders: true,
  },
  dispatch: {
    /** BLUEPRINT §8.4: consignment value in paise above which a dispatch needs an e-way bill (₹50,000). */
    ewayBillThresholdPaise: 5_000_000n,
  },
  crm: {
    /**
     * Design §11, workshop CALL-1: the pack's example call outcomes for the whole group, each with
     * the queue's next step. The list lives in `@shakti/contracts` so the database seed writes the
     * same one; Executives change it on the pipelines settings page.
     */
    dispositions: WORKSHOP_DISPOSITIONS,
    /** Design §11, workshop CRM-3: the score every lead starts from before any rule applies. */
    scoreBase: 50,
    /** Design §11, workshop CRM-3: no score rules, so every lead starts level. */
    scoreRules: [],
    /** Design §6.6: no first-contact time limit on any pipeline until the sales head sets one. */
    firstContactSlaMinutes: null,
  },
};
