import { DomainError, newId } from '@shakti/contracts';
import { headers } from 'next/headers';

/** A request id supplied by the platform, when it is safe to echo into logs. */
const SAFE_ID = /^[\w.:-]{1,128}$/;

/**
 * One id per incoming request (AUDIT M35): Vercel's own request id when present, so a log line
 * from the database transaction and the platform's request log share it; otherwise a new one.
 * It is passed to `withRequestContext`, which sets `app.request_id` for the audit trail.
 */
export async function requestId(): Promise<string> {
  const h = await headers();
  const given = h.get('x-request-id') ?? h.get('x-vercel-id');
  return given !== null && SAFE_ID.test(given) ? given : newId();
}

/** The part of a Zod schema the parser needs; the contracts package owns Zod itself. */
interface Schema<T> {
  safeParse(
    raw: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/**
 * Parses an action's input once, answering `validation_failed` with the issues instead of a raw
 * `ZodError`, which the screens would show as an unexpected failure (AUDIT L13).
 */
export function parseInput<T>(schema: Schema<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new DomainError('validation_failed', 'invalid input', {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}
