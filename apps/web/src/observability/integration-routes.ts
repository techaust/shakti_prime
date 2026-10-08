import {
  DomainError,
  ERROR_HTTP_STATUS,
  ErrorEnvelope,
  IntegrationReplayRequest,
  IntegrationReplayResponse,
  type Principal,
} from '@shakti/contracts';
import { executeCommand, replayDeadLetter, type KeyValue } from '@shakti/domain';
import en from '../../messages/en.json';
import { clientMeta } from '../auth/client-address';
import { errorKey, toDomainError } from '../auth/errors';
import { logger } from '../log';
import { readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { nudgeOutbox } from '../workers/outbox';
import { assertIntegrationHealth, readIntegrationHealth } from './integration-health';

/** A replay names one event id: well under a kilobyte. */
const REPLAY_BODY_MAX_BYTES = 1024;

export interface IntegrationRouteDeps {
  /** The signed-in principal, or undefined with no session (`currentPrincipal`). */
  principal: () => Promise<Principal | undefined>;
  keyValue: KeyValue;
}

function answer(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
  });
}

/** The error envelope, its sentence from the catalogue by the error's reason or code. */
function failure(error: unknown, requestId: string): Response {
  const domain = toDomainError(error);
  if (domain.code === 'internal' || domain.code === 'integration_unavailable') {
    logger.log('error', 'integrations.route_failed', { requestId, error });
  }
  const catalogue: Readonly<Record<string, string>> = en.errors;
  const reason = errorKey(domain);
  // The one catalogue is English (ADR 0014); a route handler has no request locale to resolve.
  const message = catalogue[reason] ?? catalogue[domain.code] ?? en.errors.internal;
  const body = ErrorEnvelope.parse({
    error: {
      code: domain.code,
      message,
      requestId,
      ...(reason === domain.code ? {} : { details: { reason } }),
    },
  });
  return answer(body, requestId, ERROR_HTTP_STATUS[domain.code]);
}

async function caller(deps: IntegrationRouteDeps): Promise<Principal> {
  const principal = await deps.principal();
  if (principal === undefined) throw new DomainError('unauthorized');
  return principal;
}

/**
 * `GET /api/v1/admin/integrations?cursor=&limit=` (docs/06-api.md §3.7): the Integration Health
 * data for a session holding `admin.integrations.write:all`.
 */
export async function getIntegrationHealth(
  request: Request,
  deps: IntegrationRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  try {
    const principal = await caller(deps);
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return answer(
      await readIntegrationHealth(principal, requestId, query, deps.keyValue),
      requestId,
    );
  } catch (error) {
    return failure(error, requestId);
  }
}

/**
 * `POST /api/v1/admin/integrations/replay` (docs/06-api.md §3.7): puts one dead letter back in the
 * queue through `integrations.dlq.replay`, audited with the caller. The body must be declared as
 * JSON, so a page on another site cannot send one with the person's cookie unless the browser
 * asks this site first, which it refuses.
 */
export async function postIntegrationReplay(
  request: Request,
  deps: IntegrationRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  try {
    const principal = await caller(deps);
    assertIntegrationHealth(principal);
    const json = /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '');
    const text = json ? await readTextWithin(request, REPLAY_BODY_MAX_BYTES) : undefined;
    const input = parseReplay(text);
    if (input === undefined) throw new DomainError('validation_failed', 'invalid replay body');
    const result = await executeCommand(principal, { requestId }, replayDeadLetter, input, {
      client: clientMeta(request.headers),
      onCommitted: nudgeOutbox,
    });
    return answer(IntegrationReplayResponse.parse(result), requestId);
  } catch (error) {
    return failure(error, requestId);
  }
}

function parseReplay(text: string | undefined): IntegrationReplayRequest | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed = IntegrationReplayRequest.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
