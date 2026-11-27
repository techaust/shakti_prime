import {
  ConnectorCursorQuery,
  ConnectorHeartbeatResponse,
  IdempotencyKeySchema,
  IdSchema,
  isDomainError,
  type ErrorCode,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  findTallyConnector,
  ingestTallyBatch,
  readTallyCursor,
  recordTallyHeartbeat,
  recordTallySnapshot,
  type ExecuteOptions,
  type TallyConnectorAuth,
  type TallyConnectorCompany,
} from '@shakti/domain';
import { apiFailure } from '../../api-failure';
import { clientMeta } from '../../auth/client-address';
import { logger } from '../../log';
import { readBytesWithin } from '../../request-body';
import { incomingRequestId } from '../../request-id';
import { tallyConnectorPrincipal } from './connector-principal';
import { parseBatch, parseHeartbeat, parseSnapshot } from './payloads';
import { CONNECTOR_HEADERS, verifyConnectorRequest } from './signature';

/**
 * The Tally connector's routes (docs/06-api.md §3.5, docs/03-roadmap-appendix/phase5.md §6.3). In
 * order, before anything is written: a body within the route's cap; the connector the header names,
 * found as that connector (unknown or revoked: 401); its signature under its current key or, during
 * a rotation, its next one, with a timestamp within five minutes (401); the contract (400); the
 * Tally company mapped to it, under the company code the body names (403). Then one command or
 * query runs as the connector's own principal in that one company; it reaches no table but
 * through the definers that check the connector and its mapping again. Nothing is ever sent back
 * towards Tally.
 */

/** A batch: 500 vouchers and 2,000 ledgers with their entries. */
export const TALLY_BATCH_MAX_BYTES = 4 * 1024 * 1024;
/** A snapshot: up to 500,000 GUIDs of about 50 characters each. */
export const TALLY_SNAPSHOT_MAX_BYTES = 32 * 1024 * 1024;
const HEARTBEAT_MAX_BYTES = 16 * 1024;

export interface TallyRouteDeps {
  now: () => Date;
  options: (meta: { client: { ip: string | null; device: string | null } }) => ExecuteOptions;
}

type Verified =
  | { ok: true; connectorId: string; auth: TallyConnectorAuth; body: Uint8Array }
  | { ok: false; response: Response };

function fail(code: ErrorCode, requestId: string, reason?: string): Response {
  return apiFailure(code, requestId, reason === undefined ? undefined : { reason });
}

function answer(body: unknown, requestId: string): Response {
  return Response.json(body, {
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
  });
}

/** Reads the body within its cap and checks the signature of the connector the header names. */
async function verified(
  request: Request,
  requestId: string,
  maxBytes: number,
  deps: TallyRouteDeps,
): Promise<Verified> {
  const body = await readBytesWithin(request, maxBytes).catch(() => undefined);
  if (body === undefined) {
    return { ok: false, response: fail('validation_failed', requestId, 'tally_body_too_large') };
  }
  const named = IdSchema.safeParse(request.headers.get(CONNECTOR_HEADERS.id));
  if (!named.success) {
    return { ok: false, response: fail('unauthorized', requestId, 'tally_connector_refused') };
  }
  let auth: TallyConnectorAuth | undefined;
  try {
    auth = await executeQuery(
      tallyConnectorPrincipal(named.data, []),
      { entityIds: [], requestId },
      (ctx) => findTallyConnector(ctx, named.data),
      { name: 'findTallyConnector' },
    );
  } catch (error) {
    logger.log('error', 'tally.connector_lookup_failed', { requestId, error });
    return { ok: false, response: fail('internal', requestId) };
  }
  const url = new URL(request.url);
  const verdict = verifyConnectorRequest(
    {
      method: request.method,
      pathWithQuery: `${url.pathname}${url.search}`,
      headers: request.headers,
      body,
    },
    (id) => (id === named.data && auth !== undefined ? auth.signingKeys : []),
    deps.now(),
  );
  if (!verdict.ok || auth === undefined) {
    logger.log('warn', 'tally.connector_refused', {
      requestId,
      connectorId: named.data,
      problem: verdict.ok ? 'unknown_connector' : verdict.problem,
    });
    return { ok: false, response: fail('unauthorized', requestId, 'tally_connector_refused') };
  }
  return { ok: true, connectorId: named.data, auth, body };
}

/** The company a call names: mapped to this connector, under the company code the body gives. */
function mappedCompany(
  auth: TallyConnectorAuth,
  company: string,
  entityCode?: string,
): TallyConnectorCompany | undefined {
  const found = auth.companies.find((c) => c.tallyCompany === company);
  if (found === undefined) return undefined;
  return entityCode === undefined || found.entityCode === entityCode ? found : undefined;
}

function parsedJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return undefined;
  }
}

function failed(error: unknown, requestId: string, event: string): Response {
  if (isDomainError(error)) {
    const reason = error.details?.reason;
    return fail(error.code, requestId, typeof reason === 'string' ? reason : undefined);
  }
  logger.log('error', event, { requestId, error });
  return fail('internal', requestId);
}

/** The `Idempotency-Key` of a write: absent, a UUID, or refused. */
function idempotencyOf(request: Request): { ok: true; key?: string } | { ok: false } {
  const raw = request.headers.get('idempotency-key');
  if (raw === null) return { ok: true };
  const parsed = IdempotencyKeySchema.safeParse(raw);
  return parsed.success ? { ok: true, key: parsed.data } : { ok: false };
}

/** `GET /api/v1/connector/tally/cursor?company=`. */
export async function tallyCursorRoute(request: Request, deps: TallyRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const check = await verified(request, requestId, HEARTBEAT_MAX_BYTES, deps);
  if (!check.ok) return check.response;
  const query = ConnectorCursorQuery.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return fail('validation_failed', requestId);
  const company = mappedCompany(check.auth, query.data.company);
  if (company === undefined) return fail('forbidden', requestId, 'tally_company_not_mapped');
  try {
    const cursor = await executeQuery(
      tallyConnectorPrincipal(check.connectorId, [company.entityId]),
      { entityIds: [company.entityId], requestId },
      (ctx) => readTallyCursor(ctx, { entityId: company.entityId, company: company.tallyCompany }),
      { name: 'readTallyCursor' },
    );
    return answer(cursor, requestId);
  } catch (error) {
    return failed(error, requestId, 'tally.cursor_failed');
  }
}

/** `POST /api/v1/connector/tally/batches`, with `Idempotency-Key`. */
export async function tallyBatchRoute(request: Request, deps: TallyRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const check = await verified(request, requestId, TALLY_BATCH_MAX_BYTES, deps);
  if (!check.ok) return check.response;
  const idempotency = idempotencyOf(request);
  if (!idempotency.ok || idempotency.key === undefined) {
    return fail('validation_failed', requestId, 'tally_idempotency_key_missing');
  }
  const parsed = parseBatch(parsedJson(check.body));
  if (!parsed.ok) return fail('validation_failed', requestId);
  const batch = parsed.value;
  const company = mappedCompany(check.auth, batch.company, batch.entityCode);
  if (company === undefined) return fail('forbidden', requestId, 'tally_company_not_mapped');
  try {
    const out = await executeCommand(
      tallyConnectorPrincipal(
        check.connectorId,
        check.auth.companies.map((c) => c.entityId),
      ),
      { entityIds: [company.entityId], requestId },
      ingestTallyBatch,
      { entityId: company.entityId, batch },
      { ...deps.options({ client: clientMeta(request.headers) }), idempotencyKey: idempotency.key },
    );
    return answer(out, requestId);
  } catch (error) {
    return failed(error, requestId, 'tally.batch_failed');
  }
}

/** `POST /api/v1/connector/tally/snapshot`, with an optional `Idempotency-Key`. */
export async function tallySnapshotRoute(
  request: Request,
  deps: TallyRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const check = await verified(request, requestId, TALLY_SNAPSHOT_MAX_BYTES, deps);
  if (!check.ok) return check.response;
  const idempotency = idempotencyOf(request);
  if (!idempotency.ok) return fail('validation_failed', requestId);
  const parsed = parseSnapshot(parsedJson(check.body));
  if (!parsed.ok) return fail('validation_failed', requestId);
  const snapshot = parsed.value;
  const company = mappedCompany(check.auth, snapshot.company, snapshot.entityCode);
  if (company === undefined) return fail('forbidden', requestId, 'tally_company_not_mapped');
  try {
    const out = await executeCommand(
      tallyConnectorPrincipal(
        check.connectorId,
        check.auth.companies.map((c) => c.entityId),
      ),
      { entityIds: [company.entityId], requestId },
      recordTallySnapshot,
      { entityId: company.entityId, snapshot },
      {
        ...deps.options({ client: clientMeta(request.headers) }),
        ...(idempotency.key === undefined ? {} : { idempotencyKey: idempotency.key }),
      },
    );
    return answer(out.response, requestId);
  } catch (error) {
    return failed(error, requestId, 'tally.snapshot_failed');
  }
}

/**
 * `POST /api/v1/connector/tally/heartbeat`. The BOS publishes no connector release until TC4, so
 * the latest version is the one the connector runs and no update is offered.
 */
export async function tallyHeartbeatRoute(
  request: Request,
  deps: TallyRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const check = await verified(request, requestId, HEARTBEAT_MAX_BYTES, deps);
  if (!check.ok) return check.response;
  const parsed = parseHeartbeat(parsedJson(check.body));
  if (!parsed.ok) return fail('validation_failed', requestId);
  const entityIds = check.auth.companies.map((c) => c.entityId);
  try {
    await executeCommand(
      tallyConnectorPrincipal(check.connectorId, entityIds),
      { entityIds, requestId },
      recordTallyHeartbeat,
      { heartbeat: parsed.value },
      deps.options({ client: clientMeta(request.headers) }),
    );
    return answer(
      ConnectorHeartbeatResponse.parse({
        serverTime: deps.now().toISOString(),
        latestVersion: parsed.value.connectorVersion,
        updateAvailable: false,
      }),
      requestId,
    );
  } catch (error) {
    return failed(error, requestId, 'tally.heartbeat_failed');
  }
}
