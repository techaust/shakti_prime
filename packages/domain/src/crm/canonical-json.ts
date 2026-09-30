/**
 * A value as JSON with every object's keys in sorted order, so two values that differ only in key
 * order (a rule as typed, and the same rule read back from `jsonb`, which reorders keys) compare
 * equal. Arrays keep their order, since it is part of the value.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sorted((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}
