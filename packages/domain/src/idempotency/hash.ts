import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every depth, so equal inputs always read the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const source = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((k) => [k, source[k]]),
    );
  });
}

/**
 * What a repeat must match to replay the first answer (docs/design/backend-weeks-3-5.md §5): the
 * command and its parsed input. The same key sent to another command is a different call.
 */
export function inputHash(command: string, input: unknown): string {
  return createHash('sha256')
    .update(command)
    .update('\n')
    .update(canonicalJson(input))
    .digest('hex');
}
