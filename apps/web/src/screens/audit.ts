// The Activity log's date window and its reading of a change (docs/design/backend-weeks-3-5.md
// §3.4). Pure functions, so the screen and its tests share them.

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The longest window the audit reader accepts, in days (`AuditQueryInput`). */
export const MAX_WINDOW_DAYS = 93;

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

/** Commands and sign-in events with a name on screen, by the key of that name in the catalogue. */
const ACTIONS = {
  'crm.lead.create': 'leadCreate',
  'org.entity.update': 'entityUpdate',
  'pricing.price.set': 'priceSet',
  'admin.user.invite': 'userInvite',
  'admin.user.role.set': 'userRoles',
  'admin.user.suspend': 'userSuspend',
  'admin.user.reactivate': 'userReactivate',
  'admin.session.revoke': 'sessionRevoke',
  'admin.user.two_factor.reset': 'twoFactorReset',
  'profile.theme.set': 'themeSet',
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
  | { kind: 'endReason'; value: string }
  | { kind: 'roles'; roles: { entityId: number; roleKey: string }[] };

/**
 * The fields with a name on screen, in the order they are listed, and how their values read.
 * Pairs rather than an object, so no source line reads like a domain error's reason.
 */
const FIELD_KINDS = [
  ['displayName', 'text'],
  ['email', 'text'],
  ['phone', 'text'],
  ['status', 'userStatus'],
  ['entityRoles', 'roles'],
  ['revokedSessions', 'number'],
  ['twoFactorEnabled', 'yesNo'],
  ['theme', 'theme'],
  ['brandName', 'text'],
  ['upiId', 'text'],
  ['price', 'money'],
  ['reason', 'text'],
  ['revokedAt', 'time'],
  ['revokedReason', 'endReason'],
  ['existingAccount', 'yesNo'],
  ['consent', 'recorded'],
] as const;

export type FieldKey = (typeof FIELD_KINDS)[number][0];
type FieldKind = (typeof FIELD_KINDS)[number][1];
const KIND_OF: ReadonlyMap<string, FieldKind> = new Map(FIELD_KINDS);

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

/** An id is an internal reference; the screen names records, never their ids. */
function isReference(key: string): boolean {
  return key === 'id' || /Ids?$/.test(key);
}

/** `textVersion` → `Text version`, `sign_in` → `Sign in`. */
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
    if (kind === 'endReason') return { kind: 'endReason', value };
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
