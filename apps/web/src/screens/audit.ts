// The Activity log's date window and its reading of a change (docs/design/backend-weeks-3-5.md
// §3.4). Pure functions, so the screen and its tests share them.

import type { EventType } from '@shakti/contracts';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The longest window the audit reader accepts, in days (`AuditQueryInput`). */
const MAX_WINDOW_DAYS = 93;

/** Today's calendar date in India, as `YYYY-MM-DD`. */
export function istToday(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The window the screen opens with: the last seven days, today included. */
export function defaultWindow(now: Date): { from: string; to: string } {
  const today = istToday(now);
  return { from: addDays(today, -6), to: today };
}

export type WindowProblem = 'dateMissing' | 'windowBackwards' | 'windowTooLong';

/**
 * The reader's window for two calendar dates as picked on screen: from the start of `from` to the
 * end of `to`, both in India time. Every day of both ends is included, so one day's window is
 * `from` = `to`.
 */
export function auditWindow(
  from: string | undefined,
  to: string | undefined,
): { ok: true; from: string; to: string } | { ok: false; problem: WindowProblem } {
  if (from === undefined || to === undefined || from === '' || to === '') {
    return { ok: false, problem: 'dateMissing' };
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const endExclusive = Date.parse(`${addDays(to, 1)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(endExclusive))
    return { ok: false, problem: 'dateMissing' };
  if (endExclusive <= start) return { ok: false, problem: 'windowBackwards' };
  if (endExclusive - start > MAX_WINDOW_DAYS * DAY_MS)
    return { ok: false, problem: 'windowTooLong' };
  return { ok: true, from: `${from}T00:00:00+05:30`, to: `${addDays(to, 1)}T00:00:00+05:30` };
}

/**
 * Commands and sign-in events with a name on screen, by the key of that name in the catalogue:
 * every command in the domain registry and every auth event (a test derives both lists).
 */
const ACTIONS = {
  'crm.lead.create': 'leadCreate',
  'crm.opportunity.stage.move': 'opportunityStageMove',
  'crm.opportunity.assign': 'opportunityAssign',
  'crm.opportunity.nurture': 'opportunityNurture',
  'crm.opportunity.reopen': 'opportunityReopen',
  'crm.opportunity.win': 'opportunityWin',
  'crm.opportunity.lose': 'opportunityLose',
  'crm.task.create': 'taskCreate',
  'crm.task.complete': 'taskComplete',
  'crm.task.reschedule': 'taskReschedule',
  'crm.task.cancel': 'taskCancel',
  'crm.tag.create': 'tagCreate',
  'crm.tag.archive': 'tagArchive',
  'crm.lead.tag': 'leadTag',
  'crm.lead.untag': 'leadUntag',
  'crm.account.update': 'accountUpdate',
  'crm.contact.update': 'contactUpdate',
  'crm.site.upsert': 'siteUpsert',
  'crm.note.add': 'noteAdd',
  'crm.consent.record': 'consentRecord',
  'crm.consent.withdraw': 'consentWithdraw',
  'org.entity.update': 'entityUpdate',
  'pricing.price.set': 'priceSet',
  'pricing.list.create': 'priceListCreate',
  'pricing.list.approve': 'priceListApprove',
  'pricing.list.archive': 'priceListArchive',
  'catalogue.item.create': 'itemCreate',
  'catalogue.item.update': 'itemUpdate',
  'catalogue.item.archive': 'itemArchive',
  'catalogue.kit.create': 'kitCreate',
  'catalogue.kit.update': 'kitUpdate',
  'catalogue.kit.archive': 'kitArchive',
  'catalogue.pump_curve.set': 'pumpCurveSet',
  'tax.rate.set': 'taxRateSet',
  'tax.composite.set': 'compositeRuleSet',
  'imports.job.create': 'importCreate',
  'imports.job.map': 'importMap',
  'imports.job.preview': 'importPreview',
  'imports.job.commit': 'importCommit',
  'imports.job.commit_batch': 'importCommitBatch',
  'imports.job.rollback': 'importRollback',
  'files.upload.begin': 'fileUploadBegin',
  'files.upload.complete': 'fileUploadComplete',
  'files.file.mark_scanned': 'fileScanned',
  'files.file.mark_ready': 'fileReady',
  'files.file.reject': 'fileRejected',
  'files.file.recheck': 'filesRecheck',
  'files.document.record': 'fileRendered',
  'print.proof.request': 'printProofRequest',
  'integrations.dlq.replay': 'deadLetterReplay',
  'platform.probe.run': 'deliveryCheck',
  'admin.user.invite': 'userInvite',
  'admin.user.role.set': 'userRoles',
  'admin.role.permissions.set': 'rolePermissions',
  'admin.user.suspend': 'userSuspend',
  'admin.user.reactivate': 'userReactivate',
  'admin.session.revoke': 'sessionRevoke',
  'admin.user.two_factor.reset': 'twoFactorReset',
  'admin.user.lock.clear': 'signInLockClear',
  'profile.theme.set': 'themeSet',
  'profile.view.save': 'viewSave',
  'profile.view.delete': 'viewDelete',
  'realtime.token.issue': 'liveUpdatesOpen',
  'profile.contrast.set': 'contrastSet',
  'agents.run.record': 'agentRunRecord',
  'agents.inbox.approve': 'inboxApprove',
  'agents.inbox.edit': 'inboxEdit',
  'agents.inbox.reject': 'inboxReject',
  'agents.config.set': 'agentConfigSet',
  'agents.killswitch.set': 'agentKillSwitchSet',
  'auth.sign_in': 'signIn',
  'auth.two_factor.verify': 'twoFactorVerify',
  'auth.sign_out': 'signOut',
  'auth.password.reset_requested': 'passwordResetRequested',
  'auth.password.set': 'passwordSet',
  'auth.password.change': 'passwordChange',
  'auth.two_factor.enable': 'twoFactorEnable',
  'auth.backup_codes.regenerate': 'backupCodesRegenerate',
} as const;

export type ActionKey = (typeof ACTIONS)[keyof typeof ACTIONS] | 'other';

/** The filter's choices: every recorded action with a name, in the order of the catalogue. */
export const ACTION_FILTERS = Object.entries(ACTIONS).map(([command, key]) => ({ command, key }));

/** The catalogue key naming a recorded action; `other` for one without a name yet. */
export function actionKey(command: string): ActionKey {
  return (ACTIONS as Record<string, ActionKey | undefined>)[command] ?? 'other';
}

/**
 * Every event the system sends on, by the key of its name under `activity.events`. Typed against
 * the event catalogue, so a new event without a name fails the typecheck.
 */
const EVENT_NAMES = {
  'org.entity.updated': 'entityUpdated',
  'crm.lead.created': 'leadCreated',
  'crm.opportunity.stage_moved': 'opportunityStageMoved',
  'crm.opportunity.assigned': 'opportunityAssigned',
  'crm.opportunity.nurtured': 'opportunityNurtured',
  'crm.opportunity.reopened': 'opportunityReopened',
  'crm.opportunity.won': 'opportunityWon',
  'crm.opportunity.lost': 'opportunityLost',
  'pricing.price.changed': 'priceChanged',
  'pricing.list.created': 'priceListCreated',
  'pricing.list.approved': 'priceListApproved',
  'pricing.list.archived': 'priceListArchived',
  'catalogue.item.created': 'itemCreated',
  'catalogue.item.updated': 'itemUpdated',
  'catalogue.item.archived': 'itemArchived',
  'catalogue.kit.created': 'kitCreated',
  'catalogue.kit.updated': 'kitUpdated',
  'catalogue.kit.archived': 'kitArchived',
  'catalogue.pump_curve.set': 'pumpCurveSet',
  'auth.session.revoked': 'sessionRevoked',
  'admin.user.invited': 'userInvited',
  'admin.user.suspended': 'userSuspended',
  'admin.user.two_factor_reset': 'twoFactorReset',
  'admin.user.reactivated': 'userReactivated',
  'admin.user.roles_changed': 'userRolesChanged',
  'admin.role.permissions_changed': 'rolePermissionsChanged',
  'imports.job.committed': 'importCommitted',
  'imports.job.failed': 'importFailed',
  'imports.job.rolled_back': 'importRolledBack',
  'platform.probe.requested': 'deliveryCheckRequested',
  'files.file.uploaded': 'fileUploaded',
  'print.document.requested': 'documentRequested',
} as const satisfies Record<EventType, string>;

export type EventNameKey = (typeof EVENT_NAMES)[EventType];

/** The catalogue key naming an event type; undefined for a type the catalogue does not know. */
export function eventNameKey(type: string): EventNameKey | undefined {
  return isNamedEvent(type) ? EVENT_NAMES[type] : undefined;
}

/**
 * The names are keyed by every event type and no other (the `satisfies` above), so a name here
 * means a type of the catalogue; the catalogue itself, with its schemas, stays off the browser.
 */
function isNamedEvent(type: string): type is EventType {
  return Object.hasOwn(EVENT_NAMES, type);
}

/** A value of a change, as the detail sheet shows it. */
export type ChangeValue =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value: number }
  | { kind: 'yesNo'; value: boolean }
  | { kind: 'money'; amount: string }
  | { kind: 'time'; iso: string }
  | { kind: 'userStatus'; value: string }
  | { kind: 'theme'; value: string }
  | { kind: 'contrast'; value: string }
  | { kind: 'role'; value: string }
  | {
      kind: 'viewSettings';
      /** How many columns the view hides. */
      hidden: number;
      /** How many columns it filters on. */
      filters: number;
      sorted: boolean;
      density: string;
    }
  | { kind: 'endReason'; value: string }
  | { kind: 'roles'; roles: { entityId: number; roleKey: string }[] }
  | { kind: 'grants'; grants: { permission: string; scope: string }[] }
  | { kind: 'date'; iso: string }
  | { kind: 'percent'; value: string }
  | { kind: 'code'; group: CodeGroup; value: string }
  | {
      kind: 'specs';
      /** An item's specifications in the order they were recorded, each a number or a code. */
      entries: { key: string; value: string | number }[];
    }
  | {
      kind: 'mapping';
      /** Each lead field filled from a column of the file. */
      columns: { field: string; column: string }[];
      /** Each lead field given one value for every row. */
      defaults: { field: string; value: string }[];
    };

/**
 * Coded values the sheet reads through a catalogue of their own (the component knows which),
 * falling back to the code in plain words for a value the catalogue does not name yet.
 */
const CODE_GROUPS = [
  'state',
  'lostReason',
  'nurtureReason',
  'importKind',
  'fileType',
  'segment',
  'errorCode',
  'signInDetail',
  'method',
  'eventType',
  'screen',
  'taskKind',
  'accountType',
  'language',
  'siteType',
  'consentChannel',
  'consentPurpose',
  'consentSource',
  'itemCategory',
  'itemUnit',
  'priceTier',
  'fileStatus',
  'filePurpose',
  'contentType',
  'scanVerdict',
  'sanitising',
  'scanStatus',
  'documentType',
  'agent',
  'agentAction',
  'autonomy',
  'runOutcome',
] as const;
export type CodeGroup = (typeof CODE_GROUPS)[number];
const IS_CODE: ReadonlySet<string> = new Set(CODE_GROUPS);

/** How a sign-in went, as the sign-in hook records it (`apps/web/src/auth/create-auth.ts`). */
export const SIGN_IN_DETAILS = ['locked', 'inactive', 'code_required', 'complete'] as const;
/** What confirmed a sign-in: the authenticator app or a backup code. */
export const CONFIRM_METHODS = ['totp', 'backup_code'] as const;

/** Whether `value` is one of `list`, narrowing it for a typed catalogue key. */
export function oneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value);
}

/**
 * The fields with a name on screen, in the order they are listed, and how their values read:
 * every field a command or a sign-in event writes to the audit trail other than ids, which is
 * every command's `auditFields` and the auth events' allow-lists (a test reads both). Pairs rather
 * than an object, so no source line reads like a domain error's reason.
 */
const FIELD_KINDS = [
  // People, companies, prices, devices and new leads
  ['displayName', 'text'],
  ['email', 'text'],
  ['phone', 'text'],
  ['status', 'userStatus'],
  ['entityRoles', 'roles'],
  ['bosRole', 'role'],
  ['revokedSessions', 'number'],
  // Role permissions
  ['grants', 'grants'],
  ['customisedAt', 'time'],
  ['holders', 'number'],
  ['twoFactorEnabled', 'yesNo'],
  ['theme', 'theme'],
  ['contrast', 'contrast'],
  // Saved list views
  ['screen', 'screen'],
  ['settings', 'viewSettings'],
  ['brandName', 'text'],
  ['upiId', 'text'],
  ['gstin', 'text'],
  ['stateCode', 'text'],
  ['addressLine1', 'text'],
  ['addressLine2', 'text'],
  ['city', 'text'],
  ['pin', 'text'],
  ['bankAccount', 'text'],
  ['price', 'money'],
  ['reason', 'text'],
  ['revokedAt', 'time'],
  ['revokedReason', 'endReason'],
  ['existingAccount', 'yesNo'],
  ['consent', 'recorded'],
  // Sign-in
  ['detail', 'signInDetail'],
  ['method', 'method'],
  ['revokeOtherSessions', 'yesNo'],
  // Lead moves
  ['state', 'state'],
  ['lockedUntil', 'time'],
  ['handover', 'yesNo'],
  ['lostReason', 'lostReason'],
  ['nurtureReason', 'nurtureReason'],
  // Tasks
  ['taskKind', 'taskKind'],
  ['title', 'text'],
  ['dueAt', 'time'],
  ['doneAt', 'time'],
  // Tags
  ['archivedAt', 'time'],
  // Customers
  ['accountType', 'accountType'],
  ['billingStateCode', 'text'],
  ['preferredLanguage', 'language'],
  ['phones', 'text'],
  ['primaryPhone', 'text'],
  ['siteType', 'siteType'],
  ['address', 'text'],
  ['village', 'text'],
  ['tehsil', 'text'],
  ['district', 'text'],
  ['lat', 'text'],
  ['lng', 'text'],
  // Consents
  ['channel', 'consentChannel'],
  ['consentPurpose', 'consentPurpose'],
  ['source', 'consentSource'],
  ['textVersion', 'text'],
  ['givenAt', 'time'],
  ['withdrawnAt', 'time'],
  ['evidence', 'yesNo'],
  // Tax
  ['hsn', 'text'],
  ['segment', 'segment'],
  ['ratePct', 'percent'],
  ['goodsSharePct', 'percent'],
  ['servicesSharePct', 'percent'],
  ['goodsRatePct', 'percent'],
  ['servicesRatePct', 'percent'],
  ['effectiveFrom', 'date'],
  ['effectiveTo', 'date'],
  ['sourceRef', 'text'],
  // Catalogue and price lists
  ['sku', 'text'],
  ['itemName', 'text'],
  ['kitName', 'text'],
  ['category', 'itemCategory'],
  ['unit', 'itemUnit'],
  ['isSerialTracked', 'yesNo'],
  ['isDcr', 'yesNo'],
  ['almmRef', 'text'],
  ['specs', 'specs'],
  ['isActive', 'yesNo'],
  ['components', 'listCount'],
  ['points', 'listCount'],
  ['tierCode', 'priceTier'],
  ['version', 'number'],
  ['prices', 'number'],
  ['approvedAt', 'time'],
  // Imports
  ['kind', 'importKind'],
  ['name', 'text'],
  ['format', 'fileType'],
  ['mapping', 'mapping'],
  ['totalRows', 'number'],
  ['validRows', 'number'],
  ['invalidRows', 'number'],
  ['skippedRows', 'number'],
  ['suggested', 'number'],
  ['batch', 'number'],
  ['fromRow', 'number'],
  ['toRow', 'number'],
  ['rows', 'number'],
  ['committedRows', 'number'],
  ['batches', 'number'],
  ['rolledBackRows', 'number'],
  ['archived', 'number'],
  ['failedBatch', 'number'],
  ['failedRow', 'number'],
  ['refusedRows', 'number'],
  ['errorCode', 'errorCode'],
  // Messages the system sends on
  ['eventType', 'eventType'],
  ['attempts', 'number'],
  ['deadLetteredAt', 'time'],
  ['requestedAt', 'time'],
  // Uploaded files and their checks
  ['fileStatus', 'fileStatus'],
  ['purpose', 'filePurpose'],
  ['contentType', 'contentType'],
  ['size', 'number'],
  ['verdict', 'scanVerdict'],
  ['sanitising', 'sanitising'],
  ['regionsMasked', 'number'],
  ['rejectReason', 'errorCode'],
  ['scanStatus', 'scanStatus'],
  // Printed documents
  ['documentType', 'documentType'],
  // Agents and the Agent Inbox
  ['agent', 'agent'],
  ['actionType', 'agentAction'],
  ['autonomy', 'autonomy'],
  ['outcome', 'runOutcome'],
  ['edited', 'yesNo'],
  ['dailySpendCap', 'money'],
  ['enabled', 'yesNo'],
] as const;

export type FieldKey = (typeof FIELD_KINDS)[number][0];
type FieldKind = (typeof FIELD_KINDS)[number][1];
const KIND_OF: ReadonlyMap<string, FieldKind> = new Map(FIELD_KINDS);

/** Every field with a name on screen, in the order the sheet lists them. */
export const NAMED_FIELDS: readonly FieldKey[] = FIELD_KINDS.map(([field]) => field);

/** Whether a key has a name on screen; any other key falls back to `wordsOf`. */
export function isNamedField(key: string): key is FieldKey {
  return KIND_OF.has(key);
}

export interface ChangeRow {
  /** A field with a name in the catalogue, or undefined for one listed under Other details. */
  field: FieldKey | undefined;
  /** For other details: the field's name in plain words, such as `Text version`. */
  label: string;
  before: ChangeValue;
  after: ChangeValue;
}

const EMPTY: ChangeValue = { kind: 'empty' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An id is an internal reference; the screen names records, never their ids. A named field wins
 * over the pattern, so the UPI ID (`upiId`) is shown like any other company detail.
 */
function isReference(key: string): boolean {
  return !KIND_OF.has(key) && (key === 'id' || /Ids?$/.test(key));
}

/**
 * `textVersion` → `Text version`, `sign_in` → `Sign in`. Only the fallback for a key or a code no
 * catalogue names yet: every field the commands record has its own label under
 * `activity.fields`.
 */
export function wordsOf(key: string): string {
  const words = key
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function plain(value: unknown): ChangeValue {
  if (value === null || value === undefined || value === '') return EMPTY;
  if (typeof value === 'boolean') return { kind: 'yesNo', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'string') {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value))
      ? { kind: 'time', iso: value }
      : { kind: 'text', text: value };
  }
  if (Array.isArray(value)) {
    const items = value.filter((v) => typeof v === 'string' || typeof v === 'number');
    return items.length === 0 ? EMPTY : { kind: 'text', text: items.join(', ') };
  }
  return EMPTY;
}

/** An import's column matching (`LeadImportMappingSchema`): columns, then fixed values. */
function mappingOf(value: Record<string, unknown>): ChangeValue {
  const pairs = (raw: unknown) =>
    isRecord(raw)
      ? Object.entries(raw).flatMap(([field, v]) =>
          typeof v === 'string' && v !== '' ? [[field, v] as const] : [],
        )
      : [];
  const columns = pairs(value.columns).map(([field, column]) => ({ field, column }));
  const defaults = pairs(value.defaults).map(([field, v]) => ({ field, value: v }));
  return columns.length === 0 && defaults.length === 0
    ? EMPTY
    : { kind: 'mapping', columns, defaults };
}

/**
 * A saved view's settings (`SavedViewSettings`) as a short description: how many columns it hides
 * and filters on, whether it sorts, and its row height. Column ids and filter text are the grid's
 * own and are never shown. Read field by field, so an older shape still reads.
 */
function viewSettingsOf(value: Record<string, unknown>): ChangeValue {
  const hidden = isRecord(value.columns) ? value.columns.hidden : undefined;
  return {
    kind: 'viewSettings',
    hidden: Array.isArray(hidden) ? hidden.length : 0,
    filters: isRecord(value.filters) ? Object.keys(value.filters).length : 0,
    sorted: isRecord(value.sort),
    density: typeof value.density === 'string' ? value.density : 'comfortable',
  };
}

/** An item's specifications: each plain number or code, in the order recorded. */
function specsOf(value: Record<string, unknown>): ChangeValue {
  const entries = Object.entries(value).flatMap(([key, v]) =>
    typeof v === 'number' || typeof v === 'string' ? [{ key, value: v }] : [],
  );
  return entries.length === 0 ? EMPTY : { kind: 'specs', entries };
}

function known(field: FieldKey, value: unknown): ChangeValue {
  const kind = KIND_OF.get(field);
  // A side that does not carry the field at all (the before of a new record) shows nothing.
  if (value === undefined) return EMPTY;
  if (kind === 'recorded') return { kind: 'yesNo', value: value !== null };
  if (value === null) return EMPTY;
  if (typeof value === 'string') {
    if (kind === 'money') return { kind: 'money', amount: value };
    if (kind === 'userStatus') return { kind: 'userStatus', value };
    if (kind === 'theme') return { kind: 'theme', value };
    if (kind === 'contrast') return { kind: 'contrast', value };
    if (kind === 'role') return { kind: 'role', value };
    if (kind === 'endReason') return { kind: 'endReason', value };
    if (kind === 'date') return { kind: 'date', iso: value };
    if (kind === 'percent') return { kind: 'percent', value };
    if (kind !== undefined && IS_CODE.has(kind)) {
      return { kind: 'code', group: kind as CodeGroup, value };
    }
  }
  if (kind === 'percent' && typeof value === 'number') {
    return { kind: 'percent', value: String(value) };
  }
  if (kind === 'mapping' && isRecord(value)) return mappingOf(value);
  if (kind === 'listCount') {
    return Array.isArray(value) ? { kind: 'number', value: value.length } : EMPTY;
  }
  if (kind === 'specs') return isRecord(value) ? specsOf(value) : EMPTY;
  if (kind === 'viewSettings') return isRecord(value) ? viewSettingsOf(value) : EMPTY;
  if (kind === 'grants' && Array.isArray(value)) {
    return {
      kind: 'grants',
      grants: value.flatMap((g) =>
        isRecord(g) && typeof g.permission === 'string' && typeof g.scope === 'string'
          ? [{ permission: g.permission, scope: g.scope }]
          : [],
      ),
    };
  }
  if (kind === 'roles' && Array.isArray(value)) {
    return {
      kind: 'roles',
      roles: value.flatMap((r) =>
        isRecord(r) && typeof r.entityId === 'number' && typeof r.roleKey === 'string'
          ? [{ entityId: r.entityId, roleKey: r.roleKey }]
          : [],
      ),
    };
  }
  return plain(value);
}

/** Nested details of an unnamed field, one row per plain value: `Consent: Channel`. */
function leaves(prefix: string, value: unknown, out: Map<string, unknown>) {
  if (isRecord(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (!isReference(k)) leaves(prefix === '' ? wordsOf(k) : `${prefix}: ${wordsOf(k)}`, v, out);
    }
    return;
  }
  out.set(prefix, value);
}

/**
 * What changed, field by field, from an audit row's before and after (both already redacted when
 * written). Named fields come first in the order of the catalogue; ids are left out; anything
 * else is listed with its name in plain words, never as raw data.
 */
export function auditChanges(before: unknown, after: unknown): ChangeRow[] {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !isReference(k));
  const named = FIELD_KINDS.map(([field]) => field)
    .filter((f) => keys.includes(f))
    .map((field) => ({
      field,
      label: '',
      before: known(field, b[field]),
      after: known(field, a[field]),
    }));
  // Field by field, so a nested field's lines stay together whichever side carries them.
  const others = keys
    .filter((k) => !KIND_OF.has(k))
    .flatMap((k) => {
      const was = new Map<string, unknown>();
      const now = new Map<string, unknown>();
      if (b[k] !== undefined) leaves(wordsOf(k), b[k], was);
      if (a[k] !== undefined) leaves(wordsOf(k), a[k], now);
      return [...new Set([...was.keys(), ...now.keys()])].map((label) => ({
        field: undefined,
        label,
        before: plain(was.get(label)),
        after: plain(now.get(label)),
      }));
    })
    .filter((r) => r.before.kind !== 'empty' || r.after.kind !== 'empty');
  return [...named, ...others];
}
