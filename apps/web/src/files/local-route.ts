import { contentDisposition, sha256Hex, verifyLocalGrant, type FileStore } from '@shakti/domain';
import { logger } from '../log';
import { readBytesWithin } from '../request-body';
import { incomingRequestId } from '../request-id';

export interface LocalRouteDeps {
  store: FileStore | undefined;
  secret: string;
  hosted: boolean;
  now?: () => Date;
}

const NO_STORE = { 'cache-control': 'no-store' };

function answer(status: number, requestId: string): Response {
  return new Response(null, { status, headers: { ...NO_STORE, 'x-request-id': requestId } });
}

/**
 * `PUT /api/v1/files/local/<token>`: the development store's stand-in for a signed S3 upload, so
 * the browser flow works on a developer's machine without AWS. The token is the signed grant
 * `presignPut()` made; the bytes must be exactly its type, length and SHA-256, as S3 would insist.
 * A hosted deployment answers 404: this route exists only where nothing is hosted.
 */
export async function localUpload(
  request: Request,
  token: string,
  deps: LocalRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  if (deps.hosted || deps.store === undefined) return answer(404, requestId);
  const grant = verifyLocalGrant(deps.secret, token, deps.now?.());
  if (grant?.op !== 'put') return answer(403, requestId);
  if (request.headers.get('content-type') !== grant.contentType) return answer(400, requestId);
  const bytes = await readBytesWithin(request, grant.size);
  if (bytes?.length !== grant.size || sha256Hex(bytes) !== grant.sha256) {
    return answer(400, requestId);
  }
  await deps.store.put(grant.key, bytes, grant.contentType);
  logger.log('info', 'files.local_upload', { requestId, size: grant.size });
  return answer(200, requestId);
}

/** `GET /api/v1/files/local/<token>`: the development stand-in for a signed S3 download. */
export async function localDownload(
  request: Request,
  token: string,
  deps: LocalRouteDeps,
): Promise<Response> {
  const requestId = incomingRequestId(request.headers);
  if (deps.hosted || deps.store === undefined) return answer(404, requestId);
  const grant = verifyLocalGrant(deps.secret, token, deps.now?.());
  if (grant?.op !== 'get') return answer(403, requestId);
  const [bytes, head] = await Promise.all([deps.store.get(grant.key), deps.store.head(grant.key)]);
  if (bytes === undefined) return answer(404, requestId);
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      ...NO_STORE,
      'x-request-id': requestId,
      'content-type': head?.contentType ?? 'application/octet-stream',
      'content-disposition': contentDisposition(grant),
      'x-content-type-options': 'nosniff',
    },
  });
}
