import {
  FileCompleteParams,
  FileCompleteRequest,
  FileCompleteResponse,
  FilePresignRequest,
  IdempotencyKeySchema,
  isDomainError,
  type ErrorCode,
  type FilePresignResponse,
  type Principal,
} from '@shakti/contracts';
import type { ClientMeta, ExecuteOptions, KeyValue } from '@shakti/domain';
import { apiFailure } from '../api-failure';
import { clientMeta } from '../auth/client-address';
import { countRequest, type CapRule } from '../auth/request-cap';
import { logger } from '../log';
import { bosIssuer } from '../realtime/token';
import { readTextWithin } from '../request-body';
import { incomingRequestId } from '../request-id';
import type { UploadCall } from './uploads';

/** A presign or complete body: a few short fields, well under this. */
export const FILE_ROUTE_BODY_MAX_BYTES = 2 * 1024;

/**
 * Upload calls one person may make in five minutes. Each is audited; a screen uploading a batch of
 * photos stays far inside it, a runaway client does not fill the Activity log.
 */
export const FILE_ROUTE_CAP: CapRule = { window: 5 * 60, max: 60 };

const DOMAIN_ANSWERS: readonly ErrorCode[] = [
  'validation_failed',
  'forbidden',
  'not_found',
  'conflict',
  'integration_unavailable',
];

export interface FileRouteDeps {
  /** The signed-in caller; undefined without a session. May throw `unauthorized`. */
  principal: () => Promise<Principal | undefined>;
  keyValue: KeyValue;
  presign: (
    principal: Principal,
    input: FilePresignRequest,
    call: UploadCall,
  ) => Promise<FilePresignResponse>;
  complete: (
    principal: Principal,
    fileId: string,
    input: FileCompleteRequest,
    call: UploadCall,
  ) => Promise<{ id: string; status: string }>;
  /** Builds the command options (audit client, outbox nudge, idempotency key). */
  options: (meta: { client: ClientMeta }, idempotencyKey?: string) => ExecuteOptions;
  env?: NodeJS.ProcessEnv;
}

type Prepared =
  | { ok: true; principal: Principal; body: unknown; call: UploadCall }
  | { ok: false; response: Response };

/**
 * What both routes check before any work (docs/06-api.md §3.2): the BOS's own origin (the session
 * cookie is the credential until the field app's bearer tokens exist), a small body, a signed-in
 * person, the per-person cap, a well-formed `Idempotency-Key` when one is sent, and JSON.
 */
async function prepare(
  request: Request,
  deps: FileRouteDeps,
  requestId: string,
): Promise<Prepared> {
  const fail = (code: ErrorCode, reason?: string, headers?: Record<string, string>) => ({
    ok: false as const,
    response: apiFailure(code, requestId, reason === undefined ? undefined : { reason }, headers),
  });
  const issuer = bosIssuer(deps.env ?? process.env);
  if (issuer === undefined || request.headers.get('origin') !== issuer) return fail('forbidden');

  let principal: Principal | undefined;
  try {
    principal = await deps.principal();
  } catch (error) {
    if (isDomainError(error) && error.code === 'unauthorized') {
      const reason = error.details?.reason;
      return fail('unauthorized', typeof reason === 'string' ? reason : undefined);
    }
    logger.log('error', 'files.principal_failed', { requestId, error });
    return fail('internal');
  }
  if (principal === undefined) return fail('unauthorized');
  if (principal.kind !== 'user' || principal.entityIds.length === 0) return fail('forbidden');

  try {
    const counted = await countRequest(deps.keyValue, `files:${principal.id}`, FILE_ROUTE_CAP);
    if (!counted.allowed) {
      return fail('rate_limited', undefined, { 'retry-after': String(counted.retryAfter) });
    }
  } catch (error) {
    logger.log('error', 'files.cap_failed', { requestId, error });
    return fail('integration_unavailable');
  }

  const rawKey = request.headers.get('idempotency-key');
  const key = rawKey === null ? undefined : IdempotencyKeySchema.safeParse(rawKey);
  if (key?.success === false) return fail('validation_failed');

  const text = await readTextWithin(request, FILE_ROUTE_BODY_MAX_BYTES).catch(() => undefined);
  if (text === undefined) return fail('validation_failed');
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('validation_failed');
  }
  const meta = { client: clientMeta(request.headers) };
  return {
    ok: true,
    principal,
    body,
    call: { requestId, options: deps.options(meta, key?.data) },
  };
}

function domainFailure(error: unknown, requestId: string, event: string): Response {
  if (isDomainError(error) && DOMAIN_ANSWERS.includes(error.code)) {
    const reason = error.details?.reason;
    if (error.code === 'integration_unavailable') {
      logger.log('error', event, { requestId, error });
    }
    return apiFailure(error.code, requestId, typeof reason === 'string' ? { reason } : undefined);
  }
  logger.log('error', event, { requestId, error });
  return apiFailure('internal', requestId);
}

function ok(body: unknown, requestId: string): Response {
  return Response.json(body, {
    headers: { 'cache-control': 'no-store', 'x-request-id': requestId },
  });
}

/** `POST /api/v1/files/presign`: records the upload and answers its signed address. */
export async function presignRoute(request: Request, deps: FileRouteDeps): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const prepared = await prepare(request, deps, requestId);
  if (!prepared.ok) return prepared.response;
  const input = FilePresignRequest.safeParse(prepared.body);
  if (!input.success) return apiFailure('validation_failed', requestId);
  try {
    return ok(await deps.presign(prepared.principal, input.data, prepared.call), requestId);
  } catch (error) {
    return domainFailure(error, requestId, 'files.presign_failed');
  }
}

/** `POST /api/v1/files/:id/complete`: the bytes landed; the checks start. */
export async function completeRoute(
  request: Request,
  params: unknown,
  deps: FileRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  const parsedParams = FileCompleteParams.safeParse(params);
  if (!parsedParams.success) return apiFailure('not_found', requestId);
  const prepared = await prepare(request, deps, requestId);
  if (!prepared.ok) return prepared.response;
  const input = FileCompleteRequest.safeParse(prepared.body);
  if (!input.success) return apiFailure('validation_failed', requestId);
  try {
    const file = await deps.complete(
      prepared.principal,
      parsedParams.data.id,
      input.data,
      prepared.call,
    );
    return ok(FileCompleteResponse.parse({ fileId: file.id, status: file.status }), requestId);
  } catch (error) {
    return domainFailure(error, requestId, 'files.complete_failed');
  }
}
