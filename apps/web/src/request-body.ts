/**
 * Bounded request bodies for the `/api/v1` routes. A route reads a body only after this check, so
 * a caller cannot make it buffer an arbitrarily large one before the signature, the session or the
 * contract has been looked at: a declared `Content-Length` over the route's cap is refused without
 * reading anything, and a body sent without one (or with a false one) is read only up to the cap.
 */

/** The largest body a QStash worker call carries: a few ids, well under a kilobyte. */
export const WORKER_BODY_MAX_BYTES = 4 * 1024;

/** The render worker's cap: a `PdfRenderJob` may name a sheet of up to 500 labels, about 20 KB. */
export const PDF_JOB_MAX_BYTES = 24 * 1024;

/** True when the request declares a body over `maxBytes`, or a length that is not a number. */
export function declaredTooLarge(headers: Headers, maxBytes: number): boolean {
  const declared = headers.get('content-length');
  if (declared === null) return false;
  if (!/^\d{1,15}$/.test(declared.trim())) return true;
  return Number(declared.trim()) > maxBytes;
}

/**
 * The body as text, or undefined when it is longer than `maxBytes`, whether declared so or found
 * so while reading; reading stops at the cap.
 */
export async function readTextWithin(
  request: Request,
  maxBytes: number,
): Promise<string | undefined> {
  const bytes = await readBytesWithin(request, maxBytes);
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

/** The body's bytes, on the same terms as `readTextWithin`. */
export async function readBytesWithin(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array | undefined> {
  if (declaredTooLarge(request.headers, maxBytes)) return undefined;
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
