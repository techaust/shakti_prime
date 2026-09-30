import type {
  ContrastPreference,
  ImportJobSort,
  ImportJobState,
  ImportKind,
  LeadSort,
  OpportunityLostReason,
  OpportunityNurtureReason,
  OpportunityState,
  PriceSort,
  SavedViewScreen,
  Segment,
  PipeMaterial,
  PumpDrive,
  PumpType,
  SessionRevokeReason,
  SizingKind,
  SizingReason,
  Theme,
  UserSort,
  UserStatus,
} from '@shakti/contracts';

// The contract values that code running in the browser reads, copied here because every module
// of @shakti/contracts loads Zod, about 90 kB (gzip) that a phone would download on every screen
// (BLUEPRINT §11.4). Only types come from the contracts; `contract-values.test.ts` keeps each
// value equal to the contract's own, in the same order. The server keeps using the contracts.

/** Theme preference (DESIGN.md §7), in the order the profile menu offers it. */
export const THEMES = ['system', 'light', 'dark'] as const satisfies readonly Theme[];

export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

/** Contrast preference (DESIGN.md §2.1). */
export const CONTRASTS = ['standard', 'high'] as const satisfies readonly ContrastPreference[];

/** Lifecycle of a staff user. */
export const USER_STATUSES = [
  'invited',
  'active',
  'suspended',
  'offboarded',
] as const satisfies readonly UserStatus[];

/** Why a session stopped being valid. */
export const SESSION_REVOKE_REASONS = [
  'admin',
  'role_changed',
  'suspended',
  'password_changed',
  'totp_enrolled',
  'totp_reset',
  'absolute_expiry',
] as const satisfies readonly SessionRevokeReason[];

/** The shortest password the policy accepts (docs/SECURITY.md §2). */
export const PASSWORD_MIN_LENGTH = 12;

export const OPPORTUNITY_STATES = [
  'open',
  'nurture',
  'won',
  'lost',
] as const satisfies readonly OpportunityState[];

/** Why a lead is lost, in the order the Mark as lost dialog offers them. */
export const OPPORTUNITY_LOST_REASONS = [
  'price_too_high',
  'bought_elsewhere',
  'not_interested',
  'not_reachable',
  'no_budget',
  'not_eligible',
  'duplicate',
  'other',
] as const satisfies readonly OpportunityLostReason[];

/** Why a lead is parked on the nurture cadence, in the order the dialog offers them. */
export const OPPORTUNITY_NURTURE_REASONS = [
  'not_ready_yet',
  'waiting_for_funds',
  'waiting_for_subsidy',
  'waiting_for_season',
  'other',
] as const satisfies readonly OpportunityNurtureReason[];

export const SEGMENTS = [
  'farmer_pumps',
  'residential_rooftop',
  'commercial_epc',
  'dealer_wholesale',
] as const satisfies readonly Segment[];

/** What a sizing is for (docs/design/phase1.md §6.7), in the order the sizing panel's tabs show. */
export const SIZING_KINDS = ['pump', 'rooftop'] as const satisfies readonly SizingKind[];

/** Where the pump sits, what drives it and what the pipe is made of, as the panel offers them. */
export const PUMP_TYPES = ['submersible', 'surface'] as const satisfies readonly PumpType[];
export const PUMP_DRIVES = ['grid', 'solar'] as const satisfies readonly PumpDrive[];
export const PIPE_MATERIALS = ['hdpe', 'gi'] as const satisfies readonly PipeMaterial[];

/** Why a sizing is outside its limits; the panel and the Activity log name each one. */
export const SIZING_REASONS = [
  'curve_too_short',
  'curve_not_monotonic',
  'head_above_curve',
  'head_below_curve',
  'above_largest_standard_hp',
  'no_consumption',
  'roof_too_small',
  'sanctioned_load_too_small',
  'sanctioned_load_exceeded',
  'dcr_modules_required',
  'no_modules',
] as const satisfies readonly SizingReason[];

/**
 * The range each sizing measurement accepts (`PumpSizingInputs`, `RooftopSizingInputs`), so the
 * panel's fields refuse a typing slip before the server does.
 */
export const SIZING_INPUT_LIMITS = {
  staticLevelM: { min: 0, max: 500 },
  drawdownM: { min: 0, max: 200 },
  deliveryHeightM: { min: 0, max: 100 },
  pipeLengthM: { min: 0, max: 3000 },
  pipeInnerDiameterMm: { min: 10, max: 300 },
  flowLph: { min: 0, max: 1_000_000 },
  monthlyUnitsKwh: { min: 0, max: 1_000_000 },
  roofAreaSqm: { min: 0, max: 100_000 },
  sanctionedLoadKw: { min: 0, max: 10_000 },
} as const;

/** The import kinds a job may be created for today. */
export const IMPLEMENTED_IMPORT_KINDS = ['leads'] as const satisfies readonly ImportKind[];

export const IMPORT_JOB_STATES = [
  'uploaded',
  'mapped',
  'previewed',
  'committing',
  'committed',
  'rolled_back',
  'failed',
] as const satisfies readonly ImportJobState[];

/** The grids whose views a person may save. */
export const SAVED_VIEW_SCREENS = [
  'leads',
  'team_members',
  'price_lists',
  'imports',
] as const satisfies readonly SavedViewScreen[];

/** The columns each list sorts on the server (the contracts' `*_SORT_COLUMNS`). */
export const LEAD_SORT_COLUMNS = ['updated'] as const satisfies readonly LeadSort['column'][];
export const USER_SORT_COLUMNS = [
  'name',
  'email',
  'authenticator',
  'lastSignIn',
] as const satisfies readonly UserSort['column'][];
export const PRICE_SORT_COLUMNS = [
  'item',
  'code',
  'category',
  'price',
  'updated',
] as const satisfies readonly PriceSort['column'][];
export const IMPORT_JOB_SORT_COLUMNS = [
  'file',
  'total',
  'valid',
  'committed',
  'startedBy',
  'started',
] as const satisfies readonly ImportJobSort['column'][];

/** The fewest characters the palette searches for. */
export const SEARCH_MIN_CHARS = 2;
