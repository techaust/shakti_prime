import type {
  CommissionBasis,
  ContrastPreference,
  DispositionNextAction,
  ImportJobSort,
  ImportJobState,
  ImportKind,
  LeadSort,
  OpportunityLostReason,
  OpportunityNurtureReason,
  OpportunityState,
  PriceSort,
  SavedViewScreen,
  ScoreFactor,
  Segment,
  SessionRevokeReason,
  StageExitField,
  SystemSizeUnit,
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
export const LEAD_SORT_COLUMNS = [
  'updated',
  'score',
] as const satisfies readonly LeadSort['column'][];
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

/** What the queue does after a call outcome, in the order the settings page offers them. */
export const DISPOSITION_NEXT_ACTIONS = [
  'callback',
  'retry',
  'qualified',
  'not_interested',
  'wrong_number',
  'nurture',
] as const satisfies readonly DispositionNextAction[];

/** What a lead score rule looks at. */
export const SCORE_FACTORS = [
  'source',
  'segment',
  'district',
  'system_size',
  'age_days',
] as const satisfies readonly ScoreFactor[];

/** The units a system-size rule reads a lead's size in. */
export const SYSTEM_SIZE_UNITS = ['kw', 'hp'] as const satisfies readonly SystemSizeUnit[];

/** Every lead detail a stage's exit rules may name, recorded today or by the sizing panel. */
export const STAGE_EXIT_FIELDS = [
  'site',
  'village',
  'pin',
  'stateCode',
  'source',
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
] as const satisfies readonly StageExitField[];

/** The lead details a stage may require today (`RECORDED_STAGE_EXIT_FIELDS`). */
export const RECORDED_STAGE_EXIT_FIELDS = [
  'site',
  'village',
  'pin',
  'source',
] as const satisfies readonly StageExitField[];

/** The stages every pipeline keeps, which cannot be archived (`PROTECTED_STAGE_KEYS`). */
export const PROTECTED_STAGE_KEYS = ['new', 'qualified', 'quoted'] as const;

/** How a referral commission is worked out. */
export const COMMISSION_BASES = [
  'fixed',
  'percent',
  'per_kw',
  'per_hp',
] as const satisfies readonly CommissionBasis[];

/** The limits the settings forms hold to, as the contracts do. */
export const LOCK_HOURS_MAX = 720;
export const FIRST_CONTACT_SLA_MAX = 10_080;
export const SCORE_POINTS_LIMIT = 50;
