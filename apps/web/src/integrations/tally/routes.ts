import {
  ConnectorCursorQuery,
  ConnectorHeaders,
  ConnectorHeartbeatResponse,
  IdempotencyKeySchema,
  isConnectorTimestampFresh,
  isDomainError,
  type ErrorCode,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  findTallyConnector,
  openConnectorKeys,
  ingestTallyBatch,
  readTallyCursor,
  recordTallyHeartbeat,
  recordTallySnapshot,
  type ExecuteOptions,
  type FieldCipher,
  type FieldEnvelope,
  type KeyValue,
  type TallyConnectorAuth,
  type TallyConnectorCompany,
} from '@shakti/domain';
import { apiFailure } from '../../api-failure';
import { clientMeta } from '../../auth/client-address';
import { addressKey, countRequest, type CapRule } from '../../auth/request-cap';
import { logger } from '../../log';
import { readBytesWithin } from '../../request-body';
import { incomingRequestId } from '../../request-id';
import {
  forgetTallyConnector,
  isUnknownConnector,
  knownConnector,
  rememberConnector,
  rememberUnknownConnector,
} from './connector-cache';
import { tallyConnectorPrincipal } from './connector-principal';
import { parseBatch, parseHeartbeat, parseSnapshot } from './payloads';
import { CONNECTOR_HEADERS, verifyConnectorRequest } from './signature';

/**
 * The Tally connector's routes (docs/06-api.md §3.5, docs/03-roadmap-appendix/phase5.md §6.3). In
 * order, before anything is written:
 * - the three headers well formed with a timestamp within five minutes (401), before the body is
 *   read or the database asked;
 * - the caps per connector id and per address in the shared store (429);
 * - a body within the route's cap (400);
 * - the signature under the connector's current key or, during a rotation, its next one, over the
 *   path and query exactly as they arrived (a space as `+`, as the connector's `URLSearchParams`
 *   writes it) and the body's digest (401). The keys come from what this instance read of the
 *   connector in the last minute (`connector-cache.ts`), so a call verifies before any
 *   transaction; otherwise, during a rotation, or after a refused signature once that reading is
 *   ten seconds old, the connector is read again, as itself, through `app.tally_connector_auth()`
 *   (an unknown or revoked one: 401, and an unknown id is not read again for a minute);
 * - the contract (400);
 * - the Tally company mapped to it, under the company code the body names (403).
 * Then one command or query runs as the connector's own principal in that one company; it reaches
 * no table but through the definers that check the live connector and its mapping again. Nothing
 * is ever sent back towards Tally.
 */

/** A batch: 500 vouchers and 2,000 ledgers with their entries. */
export const TALLY_BATCH_MAX_BYTES = 4 * 1024 * 1024;
/**
 * A snapshot, or one part of one: a function takes at most 4.5 MB (Vercel), so a larger snapshot
 * comes in parts (`part`), about 80,000 GUIDs each.
 */
export const TALLY_SNAPSHOT_MAX_BYTES = 4_500_000;
const HEARTBEAT_MAX_BYTES = 16 * 1024;

/**
 * Calls a connector, and an address, may make in a minute: an office computer sends a heartbeat
 * every five minutes and its batches one after another, a few a second at most while it reads a
 * company from the start.
 */
export const TALLY_CAPS = {
  perConnector: { window: 60, max: 240 },
  perAddress: { window: 60, max: 600 },
} as const satisfies Record<string, CapRule>;

/** How old this instance's reading of a connector must be before a refused signature reads it again. */
const READ_AGAIN_AFTER_MS = 10_000;

export interface TallyRouteDeps {
  now: () => Date;
  /** The shared store the caps count in. */
  keyValue: KeyValue;
  /** The field cipher that opens the connectors' sealed keys; undefined when the runtime has none. */
  cipher: () => FieldCipher | undefined;
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

/**
 * Opened keys, kept a few minutes per sealed value so a connector's every call does not ask the
 * key service again; a rotated or retired key is a new sealed value and is opened afresh. Only in
 * this process's memory, never logged.
 */
const opened = new Map<string, { keys: string[]; until: number }>();
const OPENED_FOR_MS = 5 * 60_000;
const OPENED_MAX = 50;

async function openedKeys(
  cipher: FieldCipher,
  connectorId: string,
  sealed: readonly FieldEnvelope[],
): Promise<string[]> {
  const cacheKey = `${connectorId}:${sealed.map((s) => s.ciphertext).join(':')}`;
  const now = Date.now();
  const hit = opened.get(cacheKey);
  if (hit !== undefined && hit.until > now) return hit.keys;
  const keys = await openConnectorKeys(cipher, connectorId, sealed);
  if (opened.size >= OPENED_MAX) opened.clear();
  opened.set(cacheKey, { keys, until: now + OPENED_FOR_MS });
  return keys;
}

/** The caps per connector id and per address; a response when either is passed. */
async function capped(
  request: Request,
  connectorId: string,
  requestId: string,
  deps: TallyRouteDeps,
): Promise<Response | undefined> {
  const address = addressKey(clientMeta(request.headers).ip ?? undefined);
  try {
    for (const [key, rule] of [
      [`tally:connector:${connectorId}`, TALLY_CAPS.perConnector],
      [`tally:address:${address}`, TALLY_CAPS.perAddress],
    ] as const) {
      const counted = await countRequest(deps.keyValue, key, rule);
      if (!counted.allowed) {
        return apiFailure('rate_limited', requestId, undefined, {
          'retry-after': String(counted.retryAfter),
        });
      }
    }
  } catch (error) {
    logger.log('error', 'tally.cap_failed', { requestId, error });
    return fail('integration_unavailable', requestId);
  }
  return undefined;
}

/**
 * Checks the headers, the caps, the body's size and the signature of the connector the header
 * names, in that order (see the top of this file).
 */
async function verified(
  request: Request,
  requestId: string,
  maxBytes: number,
  deps: TallyRouteDeps,
): Promise<Verified> {
  const refused = (problem: string, connectorId?: string): Verified => {
    logger.log('warn', 'tally.connector_refused', { requestId, connectorId, problem });
    return { ok: false, response: fail('unauthorized', requestId, 'tally_connector_refused') };
  };
  const headers = ConnectorHeaders.safeParse({
    [CONNECTOR_HEADERS.id]: request.headers.get(CONNECTOR_HEADERS.id) ?? undefined,
    [CONNECTOR_HEADERS.timestamp]: request.headers.get(CONNECTOR_HEADERS.timestamp) ?? undefined,
    [CONNECTOR_HEADERS.signature]: request.headers.get(CONNECTOR_HEADERS.signature) ?? undefined,
  });
  if (!headers.success) return refused('missing_headers');
  const connectorId = headers.data[CONNECTOR_HEADERS.id];
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  if (!isConnectorTimestampFresh(headers.data[CONNECTOR_HEADERS.timestamp], nowSeconds)) {
    return refused('stale_timestamp', connectorId);
  }
  const cap = await capped(request, connectorId, requestId, deps);
  if (cap !== undefined) return { ok: false, response: cap };
  if (isUnknownConnector(connectorId)) return refused('unknown_connector', connectorId);
  const body = await readBytesWithin(request, maxBytes).catch(() => undefined);
  if (body === undefined) {
    return { ok: false, response: fail('validation_failed', requestId, 'tally_body_too_large') };
  }
  const url = new URL(request.url);
  const signedBy = (keys: readonly string[]) =>
    verifyConnectorRequest(
      {
        method: request.method,
        pathWithQuery: `${url.pathname}${url.search}`,
        headers: request.headers,
        body,
      },
      (id) => (id === connectorId ? keys : []),
      deps.now(),
    );

  // What this instance read of the connector in the last minute. A rotation under way is read
  // again on every call, so a key turned off stops verifying at once.
  const warm = knownConnector(connectorId);
  if (warm !== undefined) {
    const verdict = signedBy(warm.keys);
    if (verdict.ok && warm.auth.sealedKeys.length === 1) {
      return { ok: true, connectorId, auth: warm.auth, body };
    }
    if (!verdict.ok && Date.now() - warm.readAt < READ_AGAIN_AFTER_MS) {
      return refused(verdict.problem, connectorId);
    }
  }

  let auth: TallyConnectorAuth | undefined;
  try {
    auth = await executeQuery(
      tallyConnectorPrincipal(connectorId, []),
      { entityIds: [], requestId },
      (ctx) => findTallyConnector(ctx, connectorId),
      { name: 'findTallyConnector' },
    );
  } catch (error) {
    logger.log('error', 'tally.connector_lookup_failed', { requestId, error });
    return { ok: false, response: fail('internal', requestId) };
  }
  if (auth === undefined) {
    rememberUnknownConnector(connectorId);
    return refused('unknown_connector', connectorId);
  }
  const cipher = deps.cipher();
  if (cipher === undefined) {
    return { ok: false, response: fail('integration_unavailable', requestId) };
  }
  let keys: string[];
  try {
    keys = await openedKeys(cipher, connectorId, auth.sealedKeys);
  } catch (error) {
    logger.log('error', 'tally.connector_key_unopened', { requestId, connectorId, error });
    return { ok: false, response: fail('internal', requestId) };
  }
  rememberConnector(connectorId, { auth, keys });
  const verdict = signedBy(keys);
  if (!verdict.ok) return refused(verdict.problem, connectorId);
  return { ok: true, connectorId, auth, body };
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

/** The database's refusal code, bare or wrapped by Drizzle or the command runner. */
function sqlstateOf(error: unknown): unknown {
  if (isDomainError(error)) return error.details?.sqlstate;
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return (cause as { code?: unknown } | null)?.code;
}

function failed(error: unknown, requestId: string, event: string, connectorId: string): Response {
  // A definer refused the connector or its company: what this instance read of it is out of date
  // (turned off or unlinked meanwhile), so the next call reads it again.
  const refusedByDefiner = sqlstateOf(error) === '42501';
  if (refusedByDefiner) forgetTallyConnector(connectorId);
  if (isDomainError(error)) {
    const reason = error.details?.reason;
    return fail(error.code, requestId, typeof reason === 'string' ? reason : undefined);
  }
  if (refusedByDefiner) return fail('forbidden', requestId);
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
    return failed(error, requestId, 'tally.cursor_failed', check.connectorId);
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
    return failed(error, requestId, 'tally.batch_failed', check.connectorId);
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
    return failed(error, requestId, 'tally.snapshot_failed', check.connectorId);
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
    return failed(error, requestId, 'tally.heartbeat_failed', check.connectorId);
  }
}

/**
 * `GET /api/v1/connector/tally/release`: the signed release manifest for the connector's
 * self-update. The BOS publishes none until TC4, so a verified connector is answered that there
 * is no release (`not_found`), and keeps the version it runs.
 */
export async function tallyReleaseRoute(request: Request, deps: TallyRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const check = await verified(request, requestId, HEARTBEAT_MAX_BYTES, deps);
  if (!check.ok) return check.response;
  return fail('not_found', requestId, 'tally_no_release');
}
