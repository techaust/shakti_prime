import type { AuthAuditEvent } from '@shakti/contracts';
import {
  fieldKind,
  IDENTITY_KEYS,
  normaliseKey,
  scrubValue,
  type FieldKind,
} from '../ports/logger';

/**
 * Redaction for the audit trail (docs/design/backend-weeks-3-5.md §3.3, AUDIT M16). The audit
 * keeps what changed, never a credential or an identity number: secret-named fields and the
 * Aadhaar, PAN, bank account and IFSC fields are removed at any depth, and phone numbers and
 * email addresses keep only their last four characters. The one-time codes of sign-in never
 * reach a command, and the auth events record only the fields their allow-list names.
 *
 * Field names alone miss a number typed where it does not belong, such as an Aadhaar number in a
 * name, village or address field, so the text of every other field is scrubbed as a log line is
 * (`redactText`): twelve-digit numbers go in full, phone numbers keep their last four digits, and
 * email addresses, set-password links and credentials are replaced; a number of ten digits or
 * more given as a number is hidden whole unless its field holds a time or an amount. A value in
 * an id or code field (`isCodeKey` in ../ports/logger.ts: ids, `code`, `sku`, `hsn`, `gstin`,
 * `pin`, document numbers) is kept whole only when it looks like a code as well (`keepsAsCode`):
 * a key alone never keeps a value, since input that failed to parse is recorded too.
 */

/** Field names, compared without case or underscores, that are removed wherever they appear. */
const DENIED_KEYS = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'secret',
  'backupcodes',
  'token',
  'identifier',
  'bankjson',
  'apikey',
  // Identity numbers never reach the audit trail (CLAUDE.md, docs/SECURITY.md §5).
  ...IDENTITY_KEYS,
]);

/** Any field whose name carries one of these words is removed as well. */
const DENIED_PATTERN = /password|secret|token|apikey|backupcode/;

/** Fields whose values keep only their last four characters. */
const MASKED_PATTERN = /phone|mobile|whatsapp|e164|email/;

const MAX_DEPTH = 8;
const MAX_ITEMS = 200;
const MAX_TEXT = 2000;

export function isDeniedKey(key: string): boolean {
  const k = normaliseKey(key);
  return DENIED_KEYS.has(k) || DENIED_PATTERN.test(k);
}

function isMaskedKey(key: string): boolean {
  return MASKED_PATTERN.test(normaliseKey(key));
}

/** `******3210`: the last four characters, and nothing at all of a value that short. */
export function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

/**
 * How a value is stored: `masked` keeps its last four characters; otherwise by the kind of its
 * field (`scrubValue`).
 */
type Treatment = FieldKind | 'masked';

/** The treatment of a field's value; a masked field stays masked all the way down. */
function treatmentOf(key: string, parent: Treatment): Treatment {
  if (parent === 'masked' || isMaskedKey(key)) return 'masked';
  return fieldKind(key);
}

function bounded(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function walk(value: unknown, depth: number, treatment: Treatment): unknown {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[deep]';
  if (typeof value === 'string') {
    if (treatment === 'masked') return maskValue(value);
    return bounded(scrubValue(value, treatment) as string);
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    if (treatment === 'masked') return '****';
    const stored = scrubValue(value, treatment);
    return typeof stored === 'bigint' ? stored.toString() : stored;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((v) => walk(v, depth + 1, treatment));
  }
  if (typeof value === 'object') {
    // The fields of an object inside an id, code, time or amount field go by their own names.
    const parent: Treatment = treatment === 'masked' ? 'masked' : 'text';
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || isDeniedKey(key)) continue;
      out[key] = walk(v, depth + 1, treatmentOf(key, parent));
    }
    return out;
  }
  // Functions and symbols have no place in an audit row.
  return null;
}

/** A plain JSON copy of a command's input or of a before/after snapshot, safe to store. */
export function redactForAudit(value: unknown): unknown {
  return walk(value, 0, 'text');
}

/**
 * The fields each auth event may record. Anything else in the request (the password, the
 * one-time code, the link token) is never looked at.
 */
export const AUTH_EVENT_FIELDS: Readonly<Record<AuthAuditEvent, readonly string[]>> = {
  'auth.sign_in': ['email', 'detail'],
  'auth.two_factor.verify': ['method'],
  'auth.sign_out': [],
  'auth.password.reset_requested': ['email'],
  'auth.password.set': [],
  'auth.password.change': ['revokeOtherSessions'],
  'auth.two_factor.enable': [],
  'auth.backup_codes.regenerate': [],
};

/** The allow-listed fields of an auth event, masked like any other audit input. */
export function redactAuthEvent(
  event: AuthAuditEvent,
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of AUTH_EVENT_FIELDS[event]) {
    if (fields[key] !== undefined) picked[key] = fields[key];
  }
  return redactForAudit(picked) as Record<string, unknown>;
}
