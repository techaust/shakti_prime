import {
  IdempotencyKeySchema,
  IngestHealthResponse,
  IngestLeadRequest,
  IngestLeadResponse,
  isDomainError,
  type ErrorCode,
} from '@shakti/contracts';
import {
  executeCommand,
  executeQuery,
  findIngestKey,
  findIngestSource,
  hashIngestKey,
  ingestLead,
  type ExecuteOptions,
  type FoundIngestSource,
  type KeyValue,
} from '@shakti/domain';
import { createHash } from 'node:crypto';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import type { TurnstileVerdict } from '../auth/turnstile';
import { logger } from '../log';
import { readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import { systemWorkersPrincipal } from '../workers/events/system-principal';

/**
 * Website ingest (docs/06-api.md §3.3, docs/03-roadmap-appendix/phase2.md §6.2): a company's own
 * website sends an enquiry with the company's key in `X-Ingest-Key` and a Turnstile answer, and the
 * lead is made in the request as the platform (`crm.lead.ingest`), not queued: it is no webhook.
 * In order, before anything is written: the key found by its hash (unknown or revoked: 401), 60 a
 * minute per key (429), a body of at most 16 KiB that reads as the contract (400), the company the
 * key belongs to (403), Turnstile (403, or 503 when Cloudflare cannot be asked). The key never
 * reaches a log, an audit row or the database: only its SHA-256 is looked up.
 */

/** Enquiries one key may send in a minute (docs/06-api.md §1). */
export const INGEST_PER_MINUTE = 60;
export const INGEST_BODY_MAX_BYTES = 16 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export interface IngestRouteDeps {
  keyValue: KeyValue;
  verifyTurnstile: (token: string, remoteIp: string | undefined) => Promise<TurnstileVerdict>;
  /** False when the runtime has no Turnstile secret: the route answers `integration_unavailable`. */
  enabled: boolean;
  options: (meta: { client: { ip: string | null; device: string | null } }) => ExecuteOptions;
  now: () => Date;
}

function fail(
  code: ErrorCode,
  requestId: string,
  reason?: string,
  headers?: Record<string, string>,
) {
  return apiFailure(code, requestId, reason === undefined ? undefined : { reason }, headers);
}

/** The minute a request is counted in, and when the next one starts. */
function minuteOf(now: Date): { key: string; resetAt: Date } {
  const minute = Math.floor(now.getTime() / 60_000);
  return { key: String(minute), resetAt: new Date((minute + 1) * 60_000) };
}

async function findKey(request: Request, requestId: string) {
  const raw = request.headers.get('x-ingest-key')?.trim() ?? '';
  if (!KEY_PATTERN.test(raw)) return undefined;
  return executeQuery(
    systemWorkersPrincipal(null),
    { entityIds: [], requestId },
    (ctx) => findIngestKey(ctx, hashIngestKey(raw)),
    { name: 'findIngestKey' },
  );
}

/** `POST /api/v1/ingest/leads`. */
export async function ingestLeadRoute(request: Request, deps: IngestRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  if (!deps.enabled) return fail('integration_unavailable', requestId);
  let key;
  try {
    key = await findKey(request, requestId);
  } catch (error) {
    logger.log('error', 'ingest.key_lookup_failed', { requestId, error });
    return fail('internal', requestId);
  }
  if (key === undefined) return fail('unauthorized', requestId, 'ingest_key_refused');

  const minute = minuteOf(deps.now());
  try {
    const count = await deps.keyValue.incr(`ingest:${key.keyId}:${minute.key}`, 120);
    if (count > INGEST_PER_MINUTE) {
      const wait = Math.max(1, Math.ceil((minute.resetAt.getTime() - deps.now().getTime()) / 1000));
      return fail('rate_limited', requestId, undefined, { 'retry-after': String(wait) });
    }
  } catch (error) {
    logger.log('error', 'ingest.cap_failed', { requestId, error });
    return fail('integration_unavailable', requestId);
  }

  const rawIdempotency = request.headers.get('idempotency-key');
  const idempotency =
    rawIdempotency === null ? undefined : IdempotencyKeySchema.safeParse(rawIdempotency);
  if (idempotency?.success === false) return fail('validation_failed', requestId);
  const text = await readTextWithin(request, INGEST_BODY_MAX_BYTES).catch(() => undefined);
  if (text === undefined) return fail('validation_failed', requestId);
  let parsed;
  try {
    parsed = IngestLeadRequest.safeParse(JSON.parse(text));
  } catch {
    return fail('validation_failed', requestId);
  }
  if (!parsed.success) return fail('validation_failed', requestId);
  const body = parsed.data;
  if (body.entityCode !== key.entityCode) {
    return fail('forbidden', requestId, 'ingest_key_other_company');
  }

  const client = clientMeta(request.headers);
  const verdict = await deps.verifyTurnstile(body.turnstileToken, client.ip ?? undefined);
  if (verdict === 'unavailable') return fail('integration_unavailable', requestId);
  if (verdict !== 'human') return fail('forbidden', requestId, 'turnstile_failed');

  // The company's connected site this enquiry came from (by its address), for its pipeline and
  // what its consent box consents to.
  const host = siteHost(request.headers.get('origin'));
  let source: FoundIngestSource | undefined;
  if (host !== undefined) {
    const found = await executeQuery(
      systemWorkersPrincipal(null),
      { entityIds: [], requestId },
      (ctx) => findIngestSource(ctx, 'website', host),
      { name: 'findIngestSource' },
    );
    if (found?.entityId === key.entityId) source = found;
  }
  if (source === undefined && body.segment === undefined) {
    return fail('validation_failed', requestId, 'lead_source_missing');
  }

  const consent =
    source?.consent === null || source === undefined
      ? undefined
      : {
          channels: source.consent.channels,
          purpose: body.consent.purpose,
          // The version is the wording the form showed, so the record proves what was agreed.
          textVersion: `web-${createHash('sha256').update(body.consent.text).digest('hex').slice(0, 16)}`,
          givenAt: body.consent.givenAt,
        };
  const input = {
    entityId: key.entityId,
    channel: 'website' as const,
    // A segment the form names chooses the pipeline of that business line.
    ...(body.segment === undefined && source !== undefined
      ? { sourceId: source.sourceId }
      : { pipelineKey: body.segment }),
    contact: { name: body.name, phone: body.phone },
    ...(body.pin === undefined ? {} : { site: { pin: body.pin } }),
    ...(body.utm === undefined ? {} : { attribution: { utm: body.utm } }),
    ...(consent === undefined ? {} : { consent }),
    ...(body.message === undefined ? {} : { message: body.message }),
    ingestKeyId: key.keyId,
  };
  try {
    const out = await executeCommand(
      systemWorkersPrincipal(key.entityId),
      { entityIds: [key.entityId], requestId },
      ingestLead,
      input,
      {
        ...deps.options({ client }),
        ...(idempotency?.success === true ? { idempotencyKey: idempotency.data } : {}),
      },
    );
    return Response.json(IngestLeadResponse.parse({ leadId: out.leadId, outcome: out.outcome }), {
      headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
    });
  } catch (error) {
    if (isDomainError(error)) {
      const reason = error.details?.reason;
      return fail(error.code, requestId, typeof reason === 'string' ? reason : undefined);
    }
    logger.log('error', 'ingest.failed', { requestId, error });
    return fail('internal', requestId);
  }
}

/** `GET /api/v1/ingest/health`: the key works, for which company, and the minute's allowance. */
export async function ingestHealthRoute(
  request: Request,
  deps: IngestRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  if (!deps.enabled) return fail('integration_unavailable', requestId);
  let key;
  try {
    key = await findKey(request, requestId);
  } catch (error) {
    logger.log('error', 'ingest.key_lookup_failed', { requestId, error });
    return fail('internal', requestId);
  }
  if (key === undefined) return fail('unauthorized', requestId, 'ingest_key_refused');
  const minute = minuteOf(deps.now());
  const used = Number((await deps.keyValue.get(`ingest:${key.keyId}:${minute.key}`)) ?? '0');
  return Response.json(
    IngestHealthResponse.parse({
      keyValid: true,
      entityCode: key.entityCode,
      rateLimit: {
        limit: INGEST_PER_MINUTE,
        remaining: Math.max(0, INGEST_PER_MINUTE - (Number.isFinite(used) ? used : 0)),
        resetAt: minute.resetAt.toISOString(),
      },
    }),
    { headers: { 'cache-control': 'no-store', 'x-request-id': requestId } },
  );
}

/** The host name of an `Origin` header, as a connected website's external id holds it. */
export function siteHost(origin: string | null): string | undefined {
  if (origin === null) return undefined;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return /^[A-Za-z0-9_.:-]{1,200}$/.test(host) ? host : undefined;
  } catch {
    return undefined;
  }
}
