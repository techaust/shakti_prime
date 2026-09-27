import { checkDial, type CallPurpose, type DialRefusal } from '@shakti/domain';
import {
  asNumber,
  asString,
  at,
  defaultHttpDeps,
  jsonBody,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';

/**
 * Exotel click-to-dial (BLUEPRINT §10, ARCHITECTURE §7): Exotel rings the caller's phone first and,
 * when they answer, the customer, showing the entity's DLT-registered number. Transport only; the
 * dial command owns the call record. Every dial passes `checkDial()` first, so no path can place a
 * call outside TRAI hours, from the wrong number series or without the consent a service call needs.
 */

export interface ExotelConfig {
  accountSid: string;
  apiKey: string;
  apiToken: string;
  /** `api.in.exotel.com` (Mumbai cluster, the default) or `api.exotel.com` (Singapore). */
  subdomain: string;
}

/** Exotel answers within a few seconds; a slow dial is reported and never repeated. */
export const DIAL_TIMEOUT_MS = 8_000;

export interface ClickToDialInput {
  /** The caller's own phone, rung first. */
  agentNumber: string;
  /** The customer. */
  customerNumber: string;
  /** The entity's ExoPhone: 140-series for promotional calls, 160-series for service calls. */
  callerId: string;
  purpose: CallPurpose;
  hasRecordedConsent: boolean;
  onDnd: boolean;
  /** Where Exotel posts the final state; made by `signedStatusCallbackUrl()`. */
  statusCallbackUrl: string;
  record: boolean;
  /** Longest call in seconds. */
  timeLimitSeconds?: number;
  /** Echoed back in the status callback: the BOS call id, never personal data. */
  customField?: string;
}

export interface PlacedCall {
  sid: string;
  status: string;
}

/** The dial broke a calling rule; Exotel was never called. */
export class DialRefusedError extends Error {
  readonly refusals: DialRefusal[];
  constructor(refusals: DialRefusal[]) {
    super(`dial refused: ${refusals.join(', ')}`);
    this.name = 'DialRefusedError';
    this.refusals = refusals;
  }
}

async function failure(response: Response): Promise<ProviderError> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = asNumber(at(body, 'RestException', 'Code'));
  return new ProviderError('exotel', 'http', {
    status: response.status,
    ...(code === undefined ? {} : { vendorCode: String(code) }),
  });
}

export interface ExotelClient {
  connectCall(input: ClickToDialInput): Promise<PlacedCall>;
  getCall(sid: string): Promise<PlacedCall>;
}

export function exotelClient(
  config: ExotelConfig,
  deps: HttpDeps & { now: () => Date } = {
    ...defaultHttpDeps(DIAL_TIMEOUT_MS),
    now: () => new Date(),
  },
): ExotelClient {
  const base = `https://${config.subdomain}/v1/Accounts/${encodeURIComponent(config.accountSid)}`;
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiToken}`).toString('base64')}`;

  async function parseCall(response: Response): Promise<PlacedCall> {
    if (!response.ok) throw await failure(response);
    const body = await jsonBody('exotel', response);
    const sid = asString(at(body, 'Call', 'Sid'));
    const status = asString(at(body, 'Call', 'Status'));
    if (sid === undefined || sid === '' || status === undefined) {
      throw new ProviderError('exotel', 'invalid_response', { status: response.status });
    }
    return { sid, status };
  }

  return {
    async connectCall(input) {
      const decision = checkDial({
        at: deps.now(),
        purpose: input.purpose,
        callerId: input.callerId,
        to: input.customerNumber,
        hasRecordedConsent: input.hasRecordedConsent,
        onDnd: input.onDnd,
      });
      if (!decision.allowed) throw new DialRefusedError(decision.refusals);

      const form = new URLSearchParams({
        From: input.agentNumber,
        To: input.customerNumber,
        CallerId: input.callerId,
        Record: input.record ? 'true' : 'false',
        StatusCallback: input.statusCallbackUrl,
        'StatusCallbackEvents[0]': 'terminal',
        StatusCallbackContentType: 'application/json',
      });
      if (input.timeLimitSeconds !== undefined) {
        form.set('TimeLimit', String(input.timeLimitSeconds));
      }
      if (input.customField !== undefined) form.set('CustomField', input.customField);

      // A dial is never retried: a timeout does not prove the phones did not ring.
      const response = await providerFetch('exotel', deps, `${base}/Calls/connect.json`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      return parseCall(response);
    },

    async getCall(sid) {
      const response = await providerFetch(
        'exotel',
        deps,
        `${base}/Calls/${encodeURIComponent(sid)}.json`,
        { method: 'GET', headers: { authorization } },
        { retries: 2 },
      );
      return parseCall(response);
    },
  };
}

/** Exotel settings from the environment, or undefined when any is missing. */
export function exotelConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ExotelConfig | undefined {
  const accountSid = env.EXOTEL_ACCOUNT_SID ?? '';
  const apiKey = env.EXOTEL_API_KEY ?? '';
  const apiToken = env.EXOTEL_API_TOKEN ?? '';
  const subdomain = env.EXOTEL_SUBDOMAIN ?? '';
  if (accountSid === '' || apiKey === '' || apiToken === '') return undefined;
  return {
    accountSid,
    apiKey,
    apiToken,
    subdomain: subdomain === '' ? 'api.in.exotel.com' : subdomain,
  };
}
