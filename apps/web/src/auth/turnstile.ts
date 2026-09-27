import type { Logger } from '@shakti/domain';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The header the server actions use to pass the widget's token to the auth routes. */
export const TURNSTILE_HEADER = 'x-turnstile-token';

/** The action the sign-in widget declares; an answer for any other widget is refused. */
export const TURNSTILE_SIGN_IN_ACTION = 'sign-in';

/** Cloudflare's published test secrets answer for any hostname and action. */
const TEST_SECRET = /^[123]x0+AA$/;

/**
 * `human` passes; `bot` is a failed or missing check; `unavailable` means Cloudflare could not be
 * asked (a timeout or network failure), which the screen reports as an outage, not as a bot.
 */
export type TurnstileVerdict = 'human' | 'bot' | 'unavailable';

interface TurnstileAnswer {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  'error-codes'?: unknown;
}

/**
 * Verifies a Cloudflare Turnstile token server-side (docs/SECURITY.md §2, AUDIT M37). The check
 * never fails open: anything but a clear pass from the expected hostname and widget is refused.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  options: {
    secretKey: string;
    remoteIp?: string | undefined;
    fetch: typeof fetch;
    expectedHostname?: string | undefined;
    expectedAction?: string | undefined;
    timeoutMs?: number;
    logger?: Logger | undefined;
  },
): Promise<TurnstileVerdict> {
  if (token === null || token === undefined || token === '' || options.secretKey === '') {
    return 'bot';
  }
  const body = new URLSearchParams({ secret: options.secretKey, response: token });
  if (options.remoteIp !== undefined && options.remoteIp !== '') {
    body.set('remoteip', options.remoteIp);
  }
  let answer: TurnstileAnswer;
  try {
    const response = await options.fetch(VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
    });
    if (!response.ok) {
      options.logger?.log('warn', 'turnstile.unavailable', { status: response.status });
      return 'unavailable';
    }
    answer = (await response.json()) as TurnstileAnswer;
  } catch (error) {
    options.logger?.log('warn', 'turnstile.unavailable', { error });
    return 'unavailable';
  }
  if (answer.success !== true) {
    options.logger?.log('info', 'turnstile.refused', { codes: answer['error-codes'] });
    return 'bot';
  }
  if (TEST_SECRET.test(options.secretKey)) return 'human';
  const wrongHost =
    options.expectedHostname !== undefined && answer.hostname !== options.expectedHostname;
  const wrongAction =
    options.expectedAction !== undefined && answer.action !== options.expectedAction;
  if (wrongHost || wrongAction) {
    options.logger?.log('warn', 'turnstile.mismatch', {
      hostname: answer.hostname,
      action: answer.action,
    });
    return 'bot';
  }
  return 'human';
}
