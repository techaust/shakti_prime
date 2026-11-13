import { ProviderError, type ProviderName } from '../http';

/**
 * JSON from a speech or model vendor holds transcripts and replies. A parse failure becomes an
 * `invalid_response` with no `cause`: the runtime's own error quotes the text it could not parse,
 * and a logger or Sentry that records the cause would then keep a transcript.
 */
export function parseVendorJson(provider: ProviderName, text: string, status = 200): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError(provider, 'invalid_response', { status });
  }
}

/** A response body read whole and parsed, failing without the body's text. */
export async function vendorJsonBody(provider: ProviderName, response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ProviderError(provider, 'network', { status: response.status });
  }
  return parseVendorJson(provider, text, response.status);
}

/**
 * A key read from the environment: trimmed, undefined when empty, and refused when it holds a
 * control character (it would break the header, and the header's error could quote it).
 */
export function keyFrom(value: string | undefined, name: string): string | undefined {
  const key = value?.trim() ?? '';
  if (key === '') return undefined;
  if (/\p{Cc}/u.test(key)) throw new Error(`${name} holds a control character`);
  return key;
}
