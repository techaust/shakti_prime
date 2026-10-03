import type {
  AccountType,
  ActivityType,
  ConsentChannel,
  ConsentPurpose,
  ConsentSource,
  CustomerLanguage,
  CustomerSort,
  ContrastPreference,
  FilePurpose,
  FileRejectReason,
  FileSanitising,
  FileScanVerdictInput,
  FileStatus,
  UploadContentType,
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
  SiteType,
  TaskKind,
  TaskState,
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

export const ACCOUNT_TYPES = [
  'household',
  'farm',
  'business',
  'dealer',
  'referral_partner',
] as const satisfies readonly AccountType[];

export const SITE_TYPES = ['borewell', 'rooftop', 'factory'] as const satisfies readonly SiteType[];

export const CUSTOMER_LANGUAGES = ['hinglish', 'en'] as const satisfies readonly CustomerLanguage[];

export const CONSENT_CHANNELS = [
  'whatsapp',
  'call',
  'sms',
  'email',
] as const satisfies readonly ConsentChannel[];

export const CONSENT_PURPOSES = [
  'service',
  'promotional',
] as const satisfies readonly ConsentPurpose[];

export const CONSENT_SOURCES = [
  'web_form',
  'whatsapp_opt_in',
  'walk_in_form',
  'verbal',
  'import',
] as const satisfies readonly ConsentSource[];

/** What a task asks for, in the order the Add task dialog offers them. */
export const TASK_KINDS = [
  'callback',
  'follow_up',
  'nurture',
  'review',
] as const satisfies readonly TaskKind[];

export const TASK_STATES = ['open', 'done', 'cancelled'] as const satisfies readonly TaskState[];

/** What a customer timeline row records. */
export const ACTIVITY_TYPES = [
  'lead_created',
  'stage_moved',
  'assigned',
  'nurtured',
  'reopened',
  'won',
  'lost',
  'task_created',
  'task_done',
  'task_rescheduled',
  'task_cancelled',
  'note',
  'customer_updated',
  'site_updated',
  'consent_recorded',
  'consent_withdrawn',
  'tagged',
  'untagged',
] as const satisfies readonly ActivityType[];

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
  'customers',
] as const satisfies readonly SavedViewScreen[];

/** The columns each list sorts on the server (the contracts' `*_SORT_COLUMNS`). */
export const LEAD_SORT_COLUMNS = ['updated'] as const satisfies readonly LeadSort['column'][];
export const CUSTOMER_SORT_COLUMNS = ['name'] as const satisfies readonly CustomerSort['column'][];
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

/** A customers search looks for a name, contact or village from three characters. */
export const CUSTOMER_SEARCH_MIN_CHARS = 3;
/** `files.status`. */
export const FILE_STATUSES = [
  'pending',
  'scanning',
  'scanned',
  'not_scanned',
  'masked',
  'ready',
  'rejected',
] as const satisfies readonly FileStatus[];

/** What a stored file is for. */
export const FILE_PURPOSES = [
  'job_photo',
  'survey_photo',
  'qc_photo',
  'receipt',
  'signature',
  'selfie',
  'customer_document',
  'import',
  'quote_pdf',
  'signed_quote',
  'entity_logo',
  'letterhead',
  'knowledge',
  'consent_evidence',
] as const satisfies readonly FilePurpose[];

/** The types an upload may be, each with its short name under `files.types`. */
export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const satisfies readonly UploadContentType[];

/** Why the checks refused a file; each has a sentence under `errors`. */
export const FILE_REJECT_REASONS = [
  'file_infected',
  'file_scan_failed',
  'file_not_scanned',
  'file_unreadable',
  'file_image_too_large',
  'file_pdf_active_content',
  'file_mask_failed',
] as const satisfies readonly FileRejectReason[];

/** What the malware scan said, and what the checks did to the bytes. */
export const FILE_SCAN_VERDICTS = [
  'no_threats_found',
  'not_scanned',
] as const satisfies readonly FileScanVerdictInput[];
export const FILE_SANITISING = [
  're_encoded',
  'pdf_checked',
  'masked',
] as const satisfies readonly FileSanitising[];
