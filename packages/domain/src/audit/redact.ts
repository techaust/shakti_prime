import type { AuthAuditEvent } from '@shakti/contracts';
import { IDENTITY_KEYS, redactText } from '../ports/logger';

/**
 * Redaction for the audit trail (docs/design/backend-weeks-3-5.md §3.3, AUDIT M16). The audit
 * keeps what changed, never a credential or an identity number: secret-named fields and the
 * Aadhaar, PAN, bank account and IFSC fields are removed at any depth, and phone numbers and
 * email addresses keep only their last four characters. Business codes (an entity, item or
 * stage `code`) are kept; the one-time codes of sign-in never reach a command,
 * and the auth events record only the fields their allow-list names.
 *
 * Field names alone miss a number typed where it does not belong, such as an Aadhaar number in a
 * name, village or address field, so every other text value is scrubbed as a log line is
 * (`redactText`): twelve-digit numbers go in full, phone numbers keep their last four digits, and
 * email addresses, set-password links and credentials are replaced.
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

function normalise(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

export function isDeniedKey(key: string): boolean {
  const k = normalise(key);
  return DENIED_KEYS.has(k) || DENIED_PATTERN.test(k);
}

function isMaskedKey(key: string): boolean {
  return MASKED_PATTERN.test(normalise(key));
}

/** `******3210`: the last four characters, and nothing at all of a value that short. */
export function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `${'*'.repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

function walk(value: unknown, depth: number, masked: boolean): unknown {
  if (value === null || value === undefined) return null;
  if (depth > MAX_DEPTH) return '[deep]';
  if (typeof value === 'string') {
    if (masked) return maskValue(value);
    const text = redactText(value);
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return masked ? '****' : value;
  if (typeof value === 'bigint') return masked ? '****' : value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((v) => walk(v, depth + 1, masked));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || isDeniedKey(key)) continue;
      out[key] = walk(v, depth + 1, masked || isMaskedKey(key));
    }
    return out;
  }
  // Functions and symbols have no place in an audit row.
  return null;
}

/** A plain JSON copy of a command's input or of a before/after snapshot, safe to store. */
export function redactForAudit(value: unknown): unknown {
  return walk(value, 0, false);
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
