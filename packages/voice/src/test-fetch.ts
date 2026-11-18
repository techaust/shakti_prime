import { vi } from 'vitest';

// Helpers for the wrapper tests only: a `fetch` stand-in and readers for what it was called with.

/** A `fetch` stand-in that answers every call with `respond()`. */
export function stubFetch(respond: () => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(() => Promise.resolve(respond()));
}

/** The address a recorded call went to. */
export function urlOf(input: RequestInfo | URL | undefined): string {
  if (input === undefined) throw new Error('no call was recorded');
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

/** The body of a recorded call as text (a JSON or form body); throws for anything else. */
export function bodyOf(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  throw new Error('the recorded body is not text');
}
