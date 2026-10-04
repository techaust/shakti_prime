import type {
  PipeMaterial,
  PumpType,
  Segment,
  SubsidyScheme,
  SupplySource,
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
  readonly sizing: SizingDefaults;
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
  credit: {
    /** Design §11 q3: dealer exposure counts confirmed orders not yet paid. */
    exposureCountsConfirmedOrders: true,
  },
  dispatch: {
    /** BLUEPRINT §8.4: consignment value in paise above which a dispatch needs an e-way bill (₹50,000). */
    ewayBillThresholdPaise: 5_000_000n,
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
