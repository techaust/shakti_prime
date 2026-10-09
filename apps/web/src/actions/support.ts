import { DomainError, IdempotencyKeySchema, newId, type Principal } from '@shakti/contracts';
import type { ClientMeta, ExecuteOptions } from '@shakti/domain';
import { headers } from 'next/headers';
import { clientMeta, platformRequestId } from '../auth/client-address';
import { currentPrincipal, currentPrincipalIn, currentSession } from '../auth/current-principal';
import { sectionEntities, type HomeSection } from '../screens/home';
import { nudgeOutbox } from '../workers/outbox';

/** The caller of an action; `unauthorized` when nobody is signed in. */
export async function signedIn(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (!principal) throw new DomainError('unauthorized');
  return principal;
}

/** The caller as they act in one company they hold a role in (their grants and team there). */
export async function signedInIn(entityId: number): Promise<Principal> {
  // Nobody signed in is `unauthorized`, as `signedIn()` says; only a company not held is `forbidden`.
  if ((await currentPrincipal()) === undefined) throw new DomainError('unauthorized');
  const principal = await currentPrincipalIn(entityId);
  if (!principal) throw new DomainError('forbidden', `no role in company ${entityId}`);
  return principal;
}

/**
 * The companies, among those the caller views, where their role gives them a home section. Worked
 * out from the session alone: a server action is a public endpoint, so it never takes the list
 * from the browser, and a caller cannot make it read more companies than they hold roles in.
 */
export async function sessionSectionEntities(section: HomeSection): Promise<number[]> {
  const principal = await signedIn();
  const session = await currentSession();
  const viewed = (session?.access.entities ?? []).filter((e) =>
    principal.entityIds.includes(e.entityId),
  );
  return [...new Set(sectionEntities(viewed, section))];
}

/**
 * One id per incoming request (AUDIT M35): Vercel's own request id when present, so a log line
 * from the database transaction and the platform's request log share it; otherwise a new one.
 * It is passed to `withRequestContext`, which sets `app.request_id` for the audit trail, with the
 * caller's address and browser, which the audit row records (docs/03-roadmap-appendix/backend-weeks-3-5.md §3).
 */
export async function requestMeta(): Promise<{ requestId: string; client: ClientMeta }> {
  const h = await headers();
  return { requestId: platformRequestId(h) ?? newId(), client: clientMeta(h) };
}

/**
 * The options every action passes to `executeCommand`: the caller's address and browser for the
 * audit row, the nudge that has the outbox publisher deliver the command's events at once, and
 * the form's idempotency key when it sent one, so a double submit acts once (docs/06-api.md §1).
 */
export function commandOptions(
  meta: { client: ClientMeta },
  idempotencyKey?: unknown,
): ExecuteOptions {
  return {
    client: meta.client,
    onCommitted: nudgeOutbox,
    ...(idempotencyKey === undefined
      ? {}
      : { idempotencyKey: parseInput(IdempotencyKeySchema, idempotencyKey) }),
  };
}

/** The part of a Zod schema the parser needs; the contracts package owns Zod itself. */
export interface Schema<T> {
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
