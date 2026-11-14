import {
  AskInput,
  AskStreamEvent,
  hasGrant,
  IdempotencyKeySchema,
  isDomainError,
  type AskSourceLabelDto,
  type AskTurnDto,
  type ErrorCode,
  type Principal,
} from '@shakti/contracts';
import {
  askCapReached,
  askTheBusiness,
  type AiProvider,
  type ClientMeta,
  type ExecuteOptions,
  type KeyValue,
} from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { countRequest, type CapRule } from '../auth/request-cap';
import { logger } from '../log';
import type { Env } from '../realtime/keys';
import { bosIssuer } from '../realtime/token';
import { readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';

// `POST /api/v1/ask` (docs/06-api.md §3.1, docs/03-roadmap-appendix/phase2.md §6.5): one question
// to Ask the Business, answered as a stream of lines (`AskStreamEvent`, NDJSON). Everything that
// can refuse the question is checked before the stream starts and answered in the error envelope:
// the caller, `knowledge.ask`, the body, the key, the per-person call cap and the day's spend caps,
// so a question past a cap reaches no model and no lookup. The stream then names each lookup as it
// starts and ends with the answer only once the grounding filter has passed it, so no line ever
// carries a figure the filter has not checked.

/** A question and its conversation id: well under this. */
export const ASK_BODY_MAX_BYTES = 4 * 1024;

/**
 * Questions one person may send in a minute. A question runs up to five model calls, so a screen
 * sent again and again cannot use the day's share in a burst.
 */
export const ASK_ROUTE_CAP: CapRule = { window: 60, max: 6 };

const ANSWERED_CODES: readonly ErrorCode[] = [
  'validation_failed',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'integration_unavailable',
];

export interface AskRouteDeps {
  /** The signed-in person from the session cookie; undefined without one. May throw `unauthorized`. */
  principal: () => Promise<Principal | undefined>;
  /**
   * The person a bearer token speaks for: V2's voice token (`aud: shakti-voice`), a typed seam
   * live voice fills. Left out, a bearer token is refused.
   */
  bearer?: (token: string) => Promise<Principal | undefined>;
  keyValue: KeyValue;
  provider: () => AiProvider;
  /** The command options (the caller's address and the outbox nudge). */
  options: (meta: { client: ClientMeta }) => ExecuteOptions;
  /** The cited records' words, read as the person in the conversation's companies. */
  labels: (
    principal: Principal,
    turn: AskTurnDto,
    requestId: string,
  ) => Promise<AskSourceLabelDto[]>;
  env?: Env;
  now?: () => Date;
}

/** Seconds until midnight in India, when the day's spend starts again. */
export function secondsToIstMidnight(now: Date): number {
  const ist = now.getTime() + 330 * 60_000;
  const day = 24 * 60 * 60_000;
  return Math.max(1, Math.ceil((day - (ist % day)) / 1000));
}

const reasonOf = (error: unknown): string | undefined => {
  const reason = isDomainError(error) ? error.details?.reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
};

type Caller = { ok: true; principal: Principal } | { ok: false; response: Response };

async function caller(request: Request, deps: AskRouteDeps, requestId: string): Promise<Caller> {
  const fail = (code: ErrorCode, reason?: string): Caller => ({
    ok: false,
    response: apiFailure(code, requestId, reason === undefined ? undefined : { reason }),
  });
  const authorization = request.headers.get('authorization');
  let principal: Principal | undefined;
  try {
    if (authorization !== null) {
      const token = /^Bearer ([\w.~+/=-]{1,4096})$/.exec(authorization)?.[1];
      principal =
        token === undefined || deps.bearer === undefined ? undefined : await deps.bearer(token);
    } else {
      // The session cookie is a credential only from the BOS's own screens.
      const issuer = bosIssuer(deps.env ?? process.env);
      if (issuer === undefined || request.headers.get('origin') !== issuer)
        return fail('forbidden');
      principal = await deps.principal();
    }
  } catch (error) {
    if (isDomainError(error) && error.code === 'unauthorized') {
      return fail('unauthorized', reasonOf(error));
    }
    logger.log('error', 'ask.principal_failed', { requestId, error });
    return fail('internal');
  }
  if (principal === undefined) return fail('unauthorized');
  if (
    principal.kind !== 'user' ||
    principal.entityIds.length === 0 ||
    !hasGrant(principal.permissions, 'knowledge.ask', 'team')
  ) {
    return fail('forbidden');
  }
  return { ok: true, principal };
}

const line = (event: AskStreamEvent): Uint8Array =>
  new TextEncoder().encode(`${JSON.stringify(AskStreamEvent.parse(event))}\n`);

/** `POST /api/v1/ask`. */
export async function askRoute(request: Request, deps: AskRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const now = (deps.now ?? (() => new Date()))();
  const who = await caller(request, deps, requestId);
  if (!who.ok) return who.response;
  const { principal } = who;

  const rawKey = request.headers.get('idempotency-key');
  const key = rawKey === null ? undefined : IdempotencyKeySchema.safeParse(rawKey);
  if (key?.success === false) return apiFailure('validation_failed', requestId);
  const text = await readTextWithin(request, ASK_BODY_MAX_BYTES).catch(() => undefined);
  if (text === undefined) return apiFailure('validation_failed', requestId);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiFailure('validation_failed', requestId);
  }
  const input = AskInput.safeParse(body);
  if (!input.success) return apiFailure('validation_failed', requestId);

  const provider = deps.provider();
  try {
    const counted = await countRequest(deps.keyValue, `ask:${principal.id}`, ASK_ROUTE_CAP);
    if (!counted.allowed) {
      return apiFailure('rate_limited', requestId, undefined, {
        'retry-after': String(counted.retryAfter),
      });
    }
    if (!provider.claudeAvailable) {
      return apiFailure('integration_unavailable', requestId, { reason: 'ask_unavailable' });
    }
    const reached = await askCapReached(deps.keyValue, principal.id, now);
    if (reached !== undefined) {
      return apiFailure(
        'rate_limited',
        requestId,
        { reason: reached === 'person' ? 'ask_person_cap_reached' : 'ask_cap_reached' },
        { 'retry-after': String(secondsToIstMidnight(now)) },
      );
    }
  } catch (error) {
    logger.log('error', 'ask.cap_failed', { requestId, error });
    return apiFailure('integration_unavailable', requestId);
  }

  // The key goes to the question itself, which answers a repeat from its record.
  const { idempotencyKey: _unused, ...options } = deps.options({
    client: clientMeta(request.headers),
  });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const turn = await askTheBusiness(
          principal,
          input.data,
          { provider, now: () => now },
          {
            requestId,
            entityIds: principal.entityIds,
            command: options,
            ...(key?.data === undefined ? {} : { idempotencyKey: key.data }),
            onLookup: (lookup) => {
              controller.enqueue(line({ type: 'lookup', lookup }));
            },
          },
        );
        const sources = await deps.labels(principal, turn, requestId);
        controller.enqueue(line({ type: 'answer', turn, sources }));
      } catch (error) {
        const code: ErrorCode =
          isDomainError(error) && ANSWERED_CODES.includes(error.code) ? error.code : 'internal';
        if (code === 'internal' || code === 'integration_unavailable') {
          logger.log('error', 'ask.failed', { requestId, error });
        }
        controller.enqueue(
          line({ type: 'error', error: { code, reason: reasonOf(error) ?? null } }),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-request-id': requestId,
      // Each line as it is written, not held back by a proxy's buffer.
      'x-accel-buffering': 'no',
    },
  });
}
