import {
  WORKSHOP_DISPOSITIONS,
  type AccountType,
  type DispositionNextAction,
  type DocType,
  type PriceTierCode,
  type PipeMaterial,
  type PumpType,
  type Segment,
  type SubsidyScheme,
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
  readonly numbering: {
    /** The document's code inside its number: `Q` in `ASH/Q/2026-27/0001`. */
    readonly docCodes: Readonly<Record<DocType, string>>;
    /** Between the company's code, the document's code, the year and the serial. */
    readonly separator: string;
    /** The serial is padded with zeros to this many digits. */
    readonly serialDigits: number;
  };
  readonly pricing: {
    /**
     * The tier each kind of customer is priced from when the customer has none of its own. Empty:
     * no map is set, so a quote takes the tier an Executive gives the customer.
     */
    readonly tierByAccountType: Readonly<Partial<Record<AccountType, PriceTierCode>>>;
    /** How a kit is priced on a quote: its own fixed price on the price list. */
    readonly kitPricing: 'fixed';
  };
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
  readonly calling: CallingDefaults;
  readonly sizing: SizingDefaults;
}

/** The cold calling rules (docs/design/phase1.md §7.2, §11; workshop CALL-3 and CALL-5). */
export interface CallingDefaults {
  /**
   * Unanswered attempts in all before a lead moves to nurture, and the day of each, counted from
   * the day of the first attempt (0 is that day). One entry per attempt.
   */
  readonly attemptDays: readonly number[];
  /** The days after a lead enters nurture on which a nurture call falls due. */
  readonly nurtureCallDays: readonly number[];
}

/** The engineering constants the sizing calculators use (docs/design/phase1.md §6.7, §11). */
export interface SizingDefaults {
  readonly hazenWilliamsC: Readonly<Record<PipeMaterial, number>>;
  readonly fittingsLossFraction: number;
  readonly efficiency: Readonly<
    Record<PumpType, { readonly pump: number; readonly motor: number }>
  >;
  readonly solarArrayOversize: number;
  readonly moduleWp: number;
  readonly peakSunHours: number;
  readonly performanceRatio: number;
  readonly roofAreaPerKwSqm: number;
  readonly motorMarginFraction: number;
  readonly standardHp: readonly number[];
  readonly dutyFlowTolerance: number;
  readonly dutyFlowOvershootFactor: number;
  readonly surfaceMaxSuctionLiftM: number;
  readonly maxPipeVelocityMps: number;
  readonly sanctionedLoadRatio: number;
  readonly dcrSchemes: readonly SubsidyScheme[];
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
  /**
   * Workshop SALE-1 (Accounts, Owner): the format of every document number, per company, document
   * and financial year with no gaps (ADR 0006). This is the pack's first example,
   * `ASH/Q/2026-27/0001`, which numbering has used since Phase 0; Accounts confirm or change it
   * here, in one place (docs/phase0/exit-gate-actions.md). A series keeps the prefix it started
   * its year with.
   */
  numbering: {
    docCodes: {
      quote: 'Q',
      sales_order: 'SO',
      proforma: 'PI',
      challan: 'DC',
      purchase_order: 'PO',
    },
    separator: '/',
    serialDigits: 4,
  },
  pricing: {
    /**
     * Workshop PRICE-1 (Owner, Sales head): which tier each kind of customer is priced from. The
     * pack proposes no map, so none is set: a quote is priced from the tier an Executive gives the
     * customer on Account 360 (`crm.account.tier.set`), and a customer with none cannot be quoted
     * until they have one (the owner's decision of 05-10-2026).
     */
    tierByAccountType: {},
    /**
     * Workshop PRICE-3 (Owner): a kit is sold as one line at its own fixed price on each price list
     * (Price lists › Kits), as the pack describes today; the sum of its parts' prices is not used.
     */
    kitPricing: 'fixed',
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
  /**
   * The owner's defaults of 05-10-2026 for the sales head to confirm (docs/DECISIONS.md, workshop
   * CALL-3 and CALL-5). Every retry and nurture call falls due at the start of that day's calling
   * hours (`nextCallingWindowStart`).
   */
  calling: {
    /** CALL-3: three attempts in all, on the day of the first call, the next day and day 3. */
    attemptDays: [0, 1, 2],
    /** CALL-5: nurture calls on day 7, 30 and 90 after the lead enters nurture, then none. */
    nurtureCallDays: [7, 30, 90],
  },
  /**
   * Engineering constants in place of the engineering head's figures (design §6.7, §11). Each is
   * a common textbook or trade value, not a client fact, until the engineering head confirms it
   * (docs/phase0/exit-gate-actions.md). A sizing stores the constants it used with its result.
   */
  sizing: {
    /** Hazen-Williams C: textbook values for new HDPE (140) and galvanised iron (120) pipe. */
    hazenWilliamsC: { hdpe: 140, gi: 120 },
    /** Bends, valves and joints as a share of the pipe's friction loss: the common 10% allowance. */
    fittingsLossFraction: 0.1,
    /** Pump and motor efficiencies: typical values for small agricultural pump sets. */
    efficiency: {
      submersible: { pump: 0.55, motor: 0.78 },
      surface: { pump: 0.6, motor: 0.82 },
    },
    /**
     * Solar pump array size as a multiple of the motor's rated output (its standard HP in kW, the
     * motor output, not its electrical input): the common 1.3 allowance for heat, dust and low
     * sun. For the engineering head to confirm both the basis and the figure.
     */
    solarArrayOversize: 1.3,
    /** Module watt-peak: a common rating of the DCR modules on sale. */
    moduleWp: 540,
    /** Peak sun hours a day for Rajasthan: the commonly used annual average. */
    peakSunHours: 5.5,
    /** Share of rated output that reaches the meter: the common 0.75 for small rooftop systems. */
    performanceRatio: 0.75,
    /** Shade-free roof area per kWp of modules: the commonly quoted 10 m². */
    roofAreaPerKwSqm: 10,
    /**
     * Margin over the shaft power before the standard rating is chosen, so the motor never runs at
     * its limit (0.1 = 10% more): the common design allowance. For the engineering head to confirm.
     */
    motorMarginFraction: 0.1,
    /** Motor ratings on sale, in HP: the common Indian ratings from 0.5 to 30 HP. */
    standardHp: [0.5, 1, 1.5, 2, 3, 5, 7.5, 10, 12.5, 15, 20, 25, 30],
    /**
     * How far below the needed flow a chosen pump's duty flow may fall: 10%, a common allowance
     * for the spread of pump curves. For the engineering head to confirm.
     */
    dutyFlowTolerance: 0.1,
    /**
     * How many times the needed flow a chosen pump may deliver before it is too large for the site
     * (1.5 = half as much again): a common limit before a pump runs far from its best point. For
     * the engineering head to confirm.
     */
    dutyFlowOvershootFactor: 1.5,
    /**
     * The deepest water, at rest plus the drawdown, a surface pump can draw up: 7 m, the common
     * practical limit below the 10 m air pressure allows. For the engineering head to confirm.
     */
    surfaceMaxSuctionLiftM: 7,
    /**
     * Water velocity in the delivery pipe above which a wider pipe is advised: 2 m/s, the common
     * design limit for pumping mains. Advice only; it never puts a sizing out of bounds. For the
     * engineering head to confirm.
     */
    maxPipeVelocityMps: 2,
    /**
     * The DC module size allowed per kW of sanctioned load: 1.0, so a rooftop system's kWp may
     * equal the sanctioned load and not exceed it, the strict reading. For the engineering head
     * to confirm against the distribution company's rule.
     */
    sanctionedLoadRatio: 1,
    /** Schemes whose subsidy requires DCR modules: PM Surya Ghar and PM-KUSUM. */
    dcrSchemes: ['pm_surya_ghar', 'pm_kusum'],
  },
};
