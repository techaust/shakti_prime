import { DomainError } from '@shakti/contracts';
import type { z } from 'zod';

/** Parses a query's input, answering `validation_failed` with the issues as commands do. */
export function parseQueryInput<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  query: string,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError('validation_failed', `invalid input for ${query}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

/** A keyset cursor as the lists carry it: base64url JSON, checked against its schema. */
export function decodeCursor<S extends z.ZodType>(schema: S, cursor: string): z.output<S> {
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new DomainError('validation_failed', 'cursor is not valid', { cursor });
  }
}

export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
