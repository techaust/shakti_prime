import type {
  // H1 stock ledger
  BinKind,
  EditableBinKind,
  SerialState,
  StockAdjustment,
  StockReason,
  WarehouseKind,
  AccountType,
  ActivityType,
  AgentActionState,
  AgentAutonomy,
  AgentFilterReason,
  AgentRoleKey,
  AgentRunOutcome,
  AgentSettingSource,
  CommissionAccrualState,
  CopilotFact,
  CopilotNoteKind,
  CopilotOutcomeAgreement,
  CopilotTemplateOccasion,
  CommissionBasis,
  ConsentChannel,
  DialPurpose,
  ProviderCallStatus,
  InboundCallSeries,
  ConsentPurpose,
  ConsentSource,
  CustomerLanguage,
  CustomerSort,
  EntityChannelKind,
  MessagingRefusal,
  QuoteSendChannel,
  WhatsAppHandoffReason,
  WhatsAppMessageDirection,
  WhatsAppMessageKind,
  WhatsAppMessageStatus,
  WhatsAppTemplateCategory,
  WhatsAppMilestone,
  WhatsAppTemplatePurpose,
  WhatsAppTemplateStatus,
  WhatsAppThreadHandler,
  IngestAssignee,
  IngestFieldTarget,
  IngestChannel,
  IngestSourceProvider,
  LeadQualificationFact,
  DispositionNextAction,
  DuplicateKind,
  DuplicateReason,
  DuplicateSignal,
  DuplicateState,
  FilePurpose,
  FileRejectReason,
  FileSanitising,
  KnowledgeFileState,
  KnowledgeSensitivity,
  KnowledgeSourceType,
  FileScanVerdictInput,
  FileStatus,
  ImportJobSort,
  ImportJobState,
  ImportKind,
  ItemCategory,
  ItemSort,
  ItemUnit,
  KitPriceSort,
  KitSort,
  LeadSort,
  TriageProposalKind,
  OpportunityLostReason,
  OpportunityNurtureReason,
  OpportunityState,
  PdfDocumentType,
  PermissionKey,
  PipeMaterial,
  PriceListState,
  PriceSort,
  PumpDrive,
  PumpType,
  QuoteAcceptedVia,
  QuoteState,
  SalesOrderState,
  TargetMetric,
  TargetPeriod,
  TargetScope,
  WebhookProvider,
  SavedViewScreen,
  Scope,
  ScoreFactor,
  Segment,
  SessionRevokeReason,
  SiteType,
  SizingAdvisory,
  SizingKind,
  SizingReason,
  StageExitField,
  SubsidyScheme,
  SystemSizeUnit,
  TaskKind,
  TaskState,
  UploadContentType,
  UserSort,
  UserStatus,
  VoiceSessionMode,
  // U2 purchase orders
  GoodsReceiptState,
  PurchaseOrderSentVia,
  PurchaseOrderState,
} from '@shakti/contracts';

// The contract values that code running in the browser reads, copied here because every module
// of @shakti/contracts loads Zod, about 90 kB (gzip) that a phone would download on every screen
// (BLUEPRINT §11.4). Only types come from the contracts; `contract-values.test.ts` keeps each
// value equal to the contract's own, in the same order. The server keeps using the contracts.

// The theme, contrast and password values live in a module of their own, which the app shell and
// the profile page load on every staff screen without the rest of this list (BLUEPRINT §11.4).
export { CONTRASTS, isTheme, PASSWORD_MIN_LENGTH, THEMES } from './theme-values';

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
  'not_reachable',
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

/** Why a call is made (`CALL_PURPOSES`): selling, or about something the customer asked for. */
export const CALL_PURPOSE_VALUES = [
  'promotional',
  'service',
] as const satisfies readonly DialPurpose[];

/** What a Caller Co-pilot note is (`COPILOT_NOTE_KINDS`): a brief, or a call's summary. */
export const COPILOT_NOTE_KIND_VALUES = [
  'brief',
  'call_summary',
] as const satisfies readonly CopilotNoteKind[];

/** The qualification facts the Caller Co-pilot hears in a call (`COPILOT_FACTS`), in order. */
export const COPILOT_FACT_VALUES = [
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
] as const satisfies readonly CopilotFact[];

/** How a call summary's outcome compares with the logged call (`COPILOT_OUTCOME_AGREEMENTS`). */
export const COPILOT_OUTCOME_AGREEMENT_VALUES = [
  'agree',
  'disagree',
  'pending',
  'none',
] as const satisfies readonly CopilotOutcomeAgreement[];

/** Why the Caller Co-pilot proposes a WhatsApp template (`COPILOT_TEMPLATE_OCCASIONS`). */
export const TEMPLATE_OCCASION_VALUES = [
  'nurture',
  'quote_expiry',
] as const satisfies readonly CopilotTemplateOccasion[];

/** Where a click-to-dial call stands (`PROVIDER_CALL_STATUSES`), first to last. */
export const PROVIDER_CALL_STATUS_VALUES = [
  'dialling',
  'ringing',
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'failed',
  'canceled',
] as const satisfies readonly ProviderCallStatus[];

/** The lines a customer calls a company on (`INBOUND_CALL_SERIES`): the IVR and the missed-call number. */
export const INBOUND_CALL_SERIES_VALUES = [
  'ivr',
  'missed_call',
] as const satisfies readonly InboundCallSeries[];

/** The modes of a Talk to Shakti session (`VOICE_SESSION_MODES`). */
export const VOICE_SESSION_MODE_VALUES = [
  'teach',
  'ask',
] as const satisfies readonly VoiceSessionMode[];

/** A company's channels (`ENTITY_CHANNEL_KINDS`), in the order Settings › Companies lists them. */
export const ENTITY_CHANNEL_KINDS = [
  'whatsapp',
  'call_promo_140',
  'call_service_160',
  'ivr',
  'missed_call',
] as const satisfies readonly EntityChannelKind[];

/** Why the messaging worker did not send a WhatsApp message (`MESSAGING_REFUSALS`). */
export const MESSAGING_REFUSALS = [
  'opted_out',
  'window_closed',
  'template_not_approved',
  'tier_budget_reached',
  'output_filter',
] as const satisfies readonly MessagingRefusal[];

/** WhatsApp (docs/03-roadmap-appendix/phase2.md §6.1): who answers a thread. */
export const WHATSAPP_THREAD_HANDLERS = [
  'assistant',
  'people',
] as const satisfies readonly WhatsAppThreadHandler[];

/** Why a WhatsApp thread went to people. */
export const WHATSAPP_HANDOFF_REASONS = [
  'keyword',
  'request',
  'filter_refusals',
  'complaint',
  'no_assistant',
  'question',
] as const satisfies readonly WhatsAppHandoffReason[];

export const WHATSAPP_MESSAGE_DIRECTIONS = [
  'inbound',
  'outbound',
] as const satisfies readonly WhatsAppMessageDirection[];

export const WHATSAPP_MESSAGE_KINDS = [
  'text',
  'template',
  'media',
  'button',
  'system',
] as const satisfies readonly WhatsAppMessageKind[];

export const WHATSAPP_MESSAGE_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'refused',
] as const satisfies readonly WhatsAppMessageStatus[];

export const WHATSAPP_TEMPLATE_CATEGORIES = [
  'utility',
  'marketing',
  'authentication',
] as const satisfies readonly WhatsAppTemplateCategory[];

export const WHATSAPP_TEMPLATE_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
] as const satisfies readonly WhatsAppTemplateStatus[];

export const WHATSAPP_TEMPLATE_PURPOSES = [
  'welcome',
  'opt_out_confirmation',
  'acceptance_code',
  'quote_expired',
] as const satisfies readonly WhatsAppTemplatePurpose[];

/** The customer milestones a company's WhatsApp number tells (`WHATSAPP_MILESTONES`). */
export const WHATSAPP_MILESTONES = [
  'quote_sent',
  'order_confirmed',
  'dispatched',
  'visit_booked',
  'visit_reminder',
  'installed',
  'payment_due',
  'handover_kit',
] as const satisfies readonly WhatsAppMilestone[];

/**
 * The milestones Settings maps in this phase, with the count of values each template takes
 * (`WHATSAPP_LIVE_MILESTONES`, `WHATSAPP_MILESTONE_VALUES`).
 */
export const WHATSAPP_LIVE_MILESTONE_VALUES = {
  quote_sent: 3,
  order_confirmed: 2,
} as const satisfies Partial<Record<WhatsAppMilestone, number>>;

/** How a quote is sent (`QUOTE_SEND_CHANNELS`). */
export const QUOTE_SEND_CHANNELS = [
  'recorded',
  'whatsapp',
] as const satisfies readonly QuoteSendChannel[];
/** The channels a lead may arrive by from an integration (`INGEST_CHANNELS`). */
export const INGEST_CHANNELS = [
  'meta_ads',
  'google_ads',
  'website',
  'whatsapp',
  'ivr',
  'missed_call',
] as const satisfies readonly IngestChannel[];

/** What a lead from an integration did (`INGEST_OUTCOMES`). */
export const INGEST_OUTCOMES = ['created', 'attached'] as const;

/** Who a lead from an integration went to (`INGEST_ASSIGNEES`). */
export const INGEST_ASSIGNEES = [
  'caller',
  'team_lead',
  'customer_owner',
  'lead_owner',
  'unassigned',
] as const satisfies readonly IngestAssignee[];

/** The kinds of connected lead source (`INGEST_SOURCE_PROVIDERS`). */
export const INGEST_SOURCE_PROVIDERS = [
  'meta_leadgen',
  'google_leadform',
  'website',
] as const satisfies readonly IngestSourceProvider[];

/** What a form's question may fill on a lead (`INGEST_FIELD_TARGETS`). */
export const INGEST_FIELD_TARGETS = [
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'pin',
  'village',
  'message',
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
  'discomConsumerNo',
] as const satisfies readonly IngestFieldTarget[];

/** The qualification facts, in the order the card shows them (`LEAD_QUALIFICATION_FACTS`). */
export const LEAD_QUALIFICATION_FACTS = [
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
  'discomConsumerNo',
] as const satisfies readonly LeadQualificationFact[];

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

/** The agents (docs/07-security.md §3.3), in the order the agents screen lists them. */
export const AGENT_ROLES = [
  'agent:triage',
  'agent:concierge',
  'agent:copilot',
  'agent:sizing',
  'agent:orchestrator',
  'agent:chief',
] as const satisfies readonly AgentRoleKey[];

/** How far an agent may go with one action type (BLUEPRINT §9.3). */
export const AGENT_AUTONOMY_LEVELS = [
  'shadow',
  'suggest',
  'needs_approval',
  'automatic',
] as const satisfies readonly AgentAutonomy[];

/** What became of an action an agent proposed or took. */
export const AGENT_ACTION_STATE_VALUES = [
  'proposed',
  'shadowed',
  'executed',
  'approved',
  'rejected',
  'dismissed',
] as const satisfies readonly AgentActionState[];

/** Where a setting that applies comes from, as the agents screen names it. */
export const AGENT_SETTING_SOURCE_VALUES = [
  'action_company',
  'action_group',
  'agent_company',
  'agent_group',
  'default',
] as const satisfies readonly AgentSettingSource[];

/** How an agent run ended. */
export const AGENT_RUN_OUTCOME_VALUES = [
  'proposed',
  'shadowed',
  'acted',
  'nothing_to_do',
  'filtered',
  'switched_off',
  'cap_reached',
  'unavailable',
  'failed',
] as const satisfies readonly AgentRunOutcome[];

/** Why the Triage agent's output filter refused a proposal, each named under `agents.filterReason`. */
export const AGENT_FILTER_REASON_VALUES = [
  'unreadable_answer',
  'unknown_pipeline',
  'score_out_of_bounds',
  'unknown_candidate',
  'unknown_person',
  'text_has_phone',
  'text_has_identity_number',
  'text_has_instruction',
  'text_too_long',
  'fact_out_of_bounds',
  'task_outside_hours',
  'template_not_allowed',
  'unknown_outcome',
  'reply_too_long',
  'link_not_allowed',
  'fact_not_grounded',
  'text_has_promise',
  'unknown_directive',
  'reply_not_fixed_form',
  'callback_outside_hours',
] as const satisfies readonly AgentFilterReason[];

/** The kinds of proposal the Triage agent makes, each named under `agents.shadow.kinds`. */
export const TRIAGE_PROPOSAL_KIND_VALUES = [
  'pipeline',
  'score',
  'duplicate',
  'assignee',
] as const satisfies readonly TriageProposalKind[];

/** The longest period the shadow report covers, in days (`SHADOW_REPORT_MAX_DAYS`). */
export const SHADOW_REPORT_MAX_DAYS_VALUE = 92;

/** A Knowledge Vault file's status, each named under `knowledge.state`. */
export const KNOWLEDGE_FILE_STATE_VALUES = [
  'waiting',
  'indexed',
  'failed',
  'unavailable',
  'archived',
] as const satisfies readonly KnowledgeFileState[];

/** Who may find a vault file, each named under `knowledge.sensitivity`. */
export const KNOWLEDGE_SENSITIVITY_VALUES = [
  'staff_ai_ok',
  'management',
  'exec_only',
] as const satisfies readonly KnowledgeSensitivity[];

/** What a vault file is, each named under `knowledge.source`. */
export const KNOWLEDGE_SOURCE_VALUES = [
  'pdf',
  'photo',
  'word',
  'excel',
  'audio',
] as const satisfies readonly KnowledgeSourceType[];

/** An agent's role key without its `agent:` prefix: the key of its name under `agents.names`. */
export function agentNameKey(agent: (typeof AGENT_ROLES)[number]): AgentNameKey {
  return agent.slice('agent:'.length) as AgentNameKey;
}

export type AgentNameKey = 'triage' | 'concierge' | 'copilot' | 'sizing' | 'orchestrator' | 'chief';

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
  'sizing_recorded',
  'enquiry_repeated',
  'customers_merged',
  'customer_unmerged',
  'leads_merged',
  'call_logged',
] as const satisfies readonly ActivityType[];

/** Duplicate cards (CRM-03): what a pair is, the facts behind it and where it stands. */
export const DUPLICATE_KINDS = ['customer', 'lead'] as const satisfies readonly DuplicateKind[];
export const DUPLICATE_REASONS = [
  'phone',
  'name_village',
] as const satisfies readonly DuplicateReason[];
export const DUPLICATE_SIGNALS = [
  'same_phone',
  'same_name',
  'same_village',
  'same_customer',
] as const satisfies readonly DuplicateSignal[];
export const DUPLICATE_STATES = [
  'open',
  'merged',
  'dismissed',
] as const satisfies readonly DuplicateState[];

export const SEGMENTS = [
  'farmer_pumps',
  'residential_rooftop',
  'commercial_epc',
  'dealer_wholesale',
] as const satisfies readonly Segment[];

/** What a sizing is for (docs/03-roadmap-appendix/phase1.md §6.7), in the order the sizing panel's tabs show. */
export const SIZING_KINDS = ['pump', 'rooftop'] as const satisfies readonly SizingKind[];

/** Where a quote stands, as the quote screens show it (docs/03-roadmap-appendix/phase1.md §7.3). */
export const QUOTE_STATES = [
  'draft',
  'sent',
  'accepted',
  'expired',
  'superseded',
  'withdrawn',
] as const satisfies readonly QuoteState[];

/** Where a sales order stands (docs/03-roadmap-appendix/phase1.md §8.3). */
export const SALES_ORDER_STATES = [
  'draft',
  'confirmed',
  'partially_dispatched',
  'dispatched',
  'invoiced',
  'closed',
  'cancelled',
] as const satisfies readonly SalesOrderState[];

/** Whose a target is, what it counts and how long its period is (design §9, TEL-06). */
export const TARGET_SCOPES = ['caller', 'team'] as const satisfies readonly TargetScope[];
export const TARGET_METRICS = [
  'calls',
  'qualified',
  'orders',
  'kw',
] as const satisfies readonly TargetMetric[];
export const TARGET_PERIODS = ['day', 'week', 'month'] as const satisfies readonly TargetPeriod[];

/** How a customer accepted a quote (SAL-05). */
export const QUOTE_ACCEPTED_VIA = [
  'whatsapp_reply',
  'whatsapp_otp',
  'signed_upload',
] as const satisfies readonly QuoteAcceptedVia[];

/** Where a referral partner's commission on an order stands (CRM-09). */
export const COMMISSION_ACCRUAL_STATES = [
  'accrued',
  'cancelled',
] as const satisfies readonly CommissionAccrualState[];

/** The subsidy schemes a quote may be sold under, as the builder offers them. */
export const SUBSIDY_SCHEMES = [
  'none',
  'pm_surya_ghar',
  'pm_kusum',
] as const satisfies readonly SubsidyScheme[];

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
  'suction_lift_exceeded',
  'duty_flow_short',
  'duty_flow_excess',
  'pump_power_short',
  'above_largest_standard_hp',
  'no_consumption',
  'roof_too_small',
  'sanctioned_load_too_small',
  'sanctioned_load_exceeded',
  'dcr_modules_required',
  'no_modules',
] as const satisfies readonly SizingReason[];

/** Advice on a sizing that never sets its bounds; the panel names each one. */
export const SIZING_ADVISORIES = [
  'pipe_velocity_high',
] as const satisfies readonly SizingAdvisory[];

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
export const IMPLEMENTED_IMPORT_KINDS = [
  'leads',
  'accounts',
  'pin_codes',
  // U1 vendors.
  'vendors',
  // H1 stock ledger
  'opening_stock',
  // C5: the catalogue's items.
  'items',
] as const satisfies readonly ImportKind[];

/** The most sites later rows of one customer add to it from one file (`MORE_SITES_MAX`). */
export const MORE_SITES_MAX = 100;

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
  'customers',
] as const satisfies readonly SavedViewScreen[];

/** The columns each list sorts on the server (the contracts' `*_SORT_COLUMNS`). */
export const LEAD_SORT_COLUMNS = [
  'updated',
  'score',
] as const satisfies readonly LeadSort['column'][];
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

export const ITEM_SORT_COLUMNS = [
  'name',
  'sku',
  'category',
  'hsn',
  'updated',
] as const satisfies readonly ItemSort['column'][];
export const KIT_SORT_COLUMNS = [
  'name',
  'sku',
  'updated',
] as const satisfies readonly KitSort['column'][];
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

/** The price tiers the group sells at (docs/01-blueprint.md §8.3), in the order lists are offered. */
export const PRICE_TIER_CODES = ['retail', 'dealer', 'commercial'] as const;

/** The fewest characters the palette searches for. */
export const SEARCH_MIN_CHARS = 2;

/** The largest quantity one quote line takes (`QUOTE_MAX_QTY`). */
export const QUOTE_MAX_QTY = 100_000;

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
  'pumpDepthFt',
  'requiredHp',
  'monthlyBillRupees',
  'roofAreaSqFt',
  'sanctionedLoadKw',
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
/** A customers search looks for a name, contact or village from three characters. */
export const CUSTOMER_SEARCH_MIN_CHARS = 3;
/** Scopes from narrowest to widest (`SCOPES`). */
export const SCOPE_VALUES = ['own', 'team', 'entity', 'all'] as const satisfies readonly Scope[];

/** The two cost permissions (`COST_PERMISSIONS`): the role editor warns on each. */
export const COST_PERMISSION_KEYS = [
  'finance.cost.read',
  'procurement.rate.read',
] as const satisfies readonly PermissionKey[];
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
  'print_proof',
  'knowledge',
  'consent_evidence',
  'call_recording',
  'whatsapp_media',
  'call_transcript',
  // U1 vendors and supplier quotes.
  'vendor_quote',
] as const satisfies readonly FilePurpose[];

/** The types an upload may be, each with its short name under `files.types`. */
export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/wav',
] as const satisfies readonly UploadContentType[];

/** Why the checks refused a file; each has a sentence under `errors`. */
export const FILE_REJECT_REASONS = [
  'file_infected',
  'file_scan_failed',
  'file_not_scanned',
  'file_unreadable',
  'file_image_too_large',
  'file_pdf_active_content',
  'file_pdf_too_many_pages',
  'file_mask_failed',
  'file_pdf_page_too_dense',
  'file_masking_unavailable',
  'file_upload_abandoned',
  'file_replaced',
  'file_audio_too_long',
] as const satisfies readonly FileRejectReason[];

/** What the malware scan said, and what the checks did to the bytes. */
export const FILE_SCAN_VERDICTS = [
  'no_threats_found',
  'not_scanned',
] as const satisfies readonly FileScanVerdictInput[];
/** The documents the render worker prints, each with its name under `activity.values`. */
export const PDF_DOCUMENT_TYPES = [
  'quote',
  'proforma',
  'delivery_challan',
  'handover_kit',
  'company_letterhead_proof',
] as const satisfies readonly PdfDocumentType[];

export const FILE_SANITISING = [
  're_encoded',
  'pdf_checked',
  'masked',
  'sheet_checked',
  'document_checked',
  'audio_checked',
] as const satisfies readonly FileSanitising[];

/** `PLAYBOOK_DIRECTIVE_TYPES` (`@shakti/contracts`). */
export const PLAYBOOK_TYPE_VALUES = ['policy', 'priority', 'target', 'sop', 'faq', 'tone'] as const;

/** `PLAYBOOK_AUDIENCES` (`@shakti/contracts`). */
export const PLAYBOOK_AUDIENCE_VALUES = ['customer', 'staff', 'management'] as const;

/** `PLAYBOOK_DIRECTIVE_STATES` (`@shakti/contracts`). */
export const PLAYBOOK_STATE_VALUES = ['draft', 'approved', 'retired'] as const;

/** `PLAYBOOK_RESOLUTIONS` (`@shakti/contracts`). */
export const PLAYBOOK_RESOLUTION_VALUES = ['not_a_conflict', 'other_retired'] as const;
/** The systems whose messages land in `webhook_inbox` (phase 2 design §5.1). */
export const WEBHOOK_PROVIDERS = [
  'meta_whatsapp',
  'meta_leadgen',
  'google_leadform',
  'exotel_status',
  'exotel_incoming',
  'livekit',
] as const satisfies readonly WebhookProvider[];

// H1 stock ledger
/** A hub's kinds, in the order the hub form offers them. */
export const WAREHOUSE_KINDS = [
  'godown',
  'factory',
  'transit',
] as const satisfies readonly WarehouseKind[];

/** A bin's kinds. */
export const BIN_KINDS = [
  'storage',
  'receiving',
  'dispatch',
  'quarantine',
  'surplus',
  'transit',
] as const satisfies readonly BinKind[];

/** The kinds a person gives a bin. */
export const EDITABLE_BIN_KINDS = [
  'storage',
  'quarantine',
  'surplus',
] as const satisfies readonly EditableBinKind[];

/** The states of a serial. */
export const SERIAL_STATES = [
  'in_stock',
  'reserved',
  'picked',
  'in_transit',
  'with_customer',
  'faulty',
  'with_supplier',
  'scrapped',
] as const satisfies readonly SerialState[];

/** Why stock moved. */
export const STOCK_REASONS = [
  'opening',
  'receipt',
  'transfer',
  'pick',
  'issue',
  'return_customer',
  'return_supplier',
  'adjust_gain',
  'adjust_loss',
  'damage',
  'count',
  'warranty_replacement',
  'surplus_in',
  'surplus_out',
  'reversal',
] as const satisfies readonly StockReason[];

/** The adjustments the Adjust dialog offers. */
export const STOCK_ADJUSTMENTS = [
  'gain',
  'loss',
  'damage',
] as const satisfies readonly StockAdjustment[];

// U2 purchase orders
/** A purchase order's states, in the order the machine moves through them. */
export const PURCHASE_ORDER_STATES = [
  'draft',
  'approved',
  'sent',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const satisfies readonly PurchaseOrderState[];

/** How a purchase order reached its vendor. */
export const PURCHASE_ORDER_SENT_VIA = [
  'email',
  'by_hand',
] as const satisfies readonly PurchaseOrderSentVia[];

/** A goods receipt's states. */
export const GOODS_RECEIPT_STATES = [
  'posted',
  'reversed',
] as const satisfies readonly GoodsReceiptState[];
