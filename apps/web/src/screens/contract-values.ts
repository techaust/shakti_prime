import type {
  ContrastPreference,
  ItemCategory,
  ItemSort,
  ItemUnit,
  KitPriceSort,
  KitSort,
  PriceListState,
  SpecField,
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
  SessionRevokeReason,
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
  'catalogue_items',
  'catalogue_kits',
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

export const ITEM_SORT_COLUMNS = [
  'name',
  'sku',
  'category',
  'hsn',
  'updated',
] as const satisfies readonly ItemSort['column'][];
export const KIT_SORT_COLUMNS = ['name', 'sku', 'updated'] as const satisfies readonly KitSort['column'][];
export const KIT_PRICE_SORT_COLUMNS = [
  'kit',
  'code',
  'price',
  'updated',
] as const satisfies readonly KitPriceSort['column'][];

/** Item categories, in the order the item form offers them. */
export const ITEM_CATEGORIES = [
  'pump',
  'motor',
  'solar_module',
  'controller',
  'structure',
  'cable',
  'pipe',
  'inverter',
  'battery',
  'other',
] as const satisfies readonly ItemCategory[];

/** Units an item is counted in. */
export const ITEM_UNITS = [
  'nos',
  'set',
  'metre',
  'kg',
  'litre',
  'kw',
  'hour',
] as const satisfies readonly ItemUnit[];

/** Where a price list stands today. */
export const PRICE_LIST_STATES = [
  'draft',
  'scheduled',
  'live',
  'ended',
] as const satisfies readonly PriceListState[];

/** The price tiers the group sells at (docs/BLUEPRINT.md §8.3), in the order lists are offered. */
export const PRICE_TIER_CODES = ['retail', 'dealer', 'commercial'] as const;

const HP: SpecField = { key: 'hp', kind: 'number', min: 0.1, max: 1000, decimals: 2 };
const KW: SpecField = { key: 'kw', kind: 'number', min: 0.01, max: 10_000, decimals: 2 };
const PHASE: SpecField = { key: 'phase', kind: 'choice', options: ['single', 'three'] };

/** How the item form asks for each category's specifications (`ITEM_SPEC_FIELDS`). */
export const ITEM_SPEC_FIELDS: Readonly<Record<ItemCategory, readonly SpecField[]>> = {
  pump: [
    HP,
    KW,
    PHASE,
    { key: 'pumpType', kind: 'choice', options: ['surface', 'submersible'] },
    { key: 'outletMm', kind: 'number', min: 1, max: 1000, decimals: 0 },
    { key: 'maxHeadM', kind: 'number', min: 1, max: 2000, decimals: 1 },
  ],
  motor: [HP, KW, PHASE],
  solar_module: [{ key: 'wp', kind: 'number', min: 1, max: 2000, decimals: 0 }],
  controller: [
    KW,
    { key: 'inputMinV', kind: 'number', min: 1, max: 2000, decimals: 0 },
    { key: 'inputMaxV', kind: 'number', min: 1, max: 2000, decimals: 0 },
  ],
  structure: [],
  cable: [],
  pipe: [
    { key: 'nominalSizeMm', kind: 'number', min: 1, max: 2000, decimals: 0 },
    { key: 'material', kind: 'text', maxLength: 40 },
  ],
  inverter: [KW],
  battery: [],
  other: [],
};

/** The fewest characters the palette searches for. */
export const SEARCH_MIN_CHARS = 2;
