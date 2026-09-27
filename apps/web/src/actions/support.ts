import { DomainError, newId } from '@shakti/contracts';
import type { ClientMeta } from '@shakti/domain';
import { headers } from 'next/headers';
import { clientMeta, platformRequestId } from '../auth/client-address';

/**
 * One id per incoming request (AUDIT M35): Vercel's own request id when present, so a log line
 * from the database transaction and the platform's request log share it; otherwise a new one.
 * It is passed to `withRequestContext`, which sets `app.request_id` for the audit trail, with the
 * caller's address and browser, which the audit row records (docs/design/backend-weeks-3-5.md §3).
 */
export async function requestMeta(): Promise<{ requestId: string; client: ClientMeta }> {
  const h = await headers();
  return { requestId: platformRequestId(h) ?? newId(), client: clientMeta(h) };
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
