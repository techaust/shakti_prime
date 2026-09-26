const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The header the server actions use to pass the widget's token to the auth routes. */
export const TURNSTILE_HEADER = 'x-turnstile-token';

/**
 * Verifies a Cloudflare Turnstile token server-side (docs/SECURITY.md §2). A missing or failed
 * token answers false; a network failure also answers false, so the check never fails open.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  options: { secretKey: string; remoteIp?: string | undefined; fetch: typeof fetch },
): Promise<boolean> {
  if (token === null || token === undefined || token === '' || options.secretKey === '') {
    return false;
  }
  try {
    const body = new URLSearchParams({ secret: options.secretKey, response: token });
    if (options.remoteIp !== undefined && options.remoteIp !== '') {
      body.set('remoteip', options.remoteIp);
    }
    const response = await options.fetch(VERIFY_URL, { method: 'POST', body });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}
