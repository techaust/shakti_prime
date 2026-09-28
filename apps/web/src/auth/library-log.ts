/**
 * Better Auth's own log arguments can carry a user row or a session with its user. The logger
 * scrubs email addresses and numbers from text, but it cannot tell a person's name from any other
 * text, so the fields that name a person are dropped here before the arguments reach it. The JSON
 * logger also redacts `args` whole (AUDIT M10); this holds for any logger behind the port.
 */
const PERSON_KEYS: ReadonlySet<string> = new Set([
  'name',
  'email',
  'username',
  'displayname',
  'fullname',
  'firstname',
  'lastname',
]);

const MAX_DEPTH = 6;

/** A copy of the arguments with every field that names a person left out, at any depth. */
export function withoutPersonFields(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => withoutPersonFields(v, depth + 1));
  // An error is logged by its name, message and codes only (redactError), never its own fields.
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (PERSON_KEYS.has(key.toLowerCase().replace(/[_-]/g, ''))) continue;
    out[key] = withoutPersonFields(v, depth + 1);
  }
  return out;
}
