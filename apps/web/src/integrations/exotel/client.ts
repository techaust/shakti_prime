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
  /**
   * The exact hosts a recording is copied from, which alone receive the account's key
   * (`EXOTEL_RECORDING_HOSTS`, comma-separated; `DEFAULT_RECORDING_HOSTS` when unset).
   */
  recordingHosts?: readonly string[];
}

/**
 * Exotel's recording host, as its call API documents `RecordingUrl`; the spike's step 5 confirms
 * it on the live account, and `EXOTEL_RECORDING_HOSTS` replaces the list.
 */
export const DEFAULT_RECORDING_HOSTS: readonly string[] = ['recordings.exotel.com'];

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
  /** A contact of the customer, or anyone holding the number, withdrew consent to calls (CRM-10). */
  callConsentWithdrawn: boolean;
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

/** A recording as copied from Exotel: its bytes and kind. */
export interface FetchedRecording {
  bytes: Uint8Array;
  contentType: 'audio/mpeg' | 'audio/wav';
}

export interface ExotelClient {
  connectCall(input: ClickToDialInput): Promise<PlacedCall>;
  getCall(sid: string): Promise<PlacedCall>;
  /**
   * Copies a call's recording from the `RecordingUrl` of its status report: only from Exotel's
   * own recording hosts (`isExotelRecordingUrl`), with the account's key on Exotel's hosts, at
   * most `maxBytes`, an MP3 or a WAV. The link itself is never kept.
   */
  fetchRecording(url: string, maxBytes: number): Promise<FetchedRecording>;
  /** Whether a link is on one of the account's recording hosts, so `fetchRecording` may ask it. */
  recordingAllowed(url: string): boolean;
}

/** How long a recording's download may take: a long call's MP3 is a few megabytes. */
export const RECORDING_TIMEOUT_MS = 30_000;

/**
 * Whether a report's `RecordingUrl` may be fetched: https, no user, password or port, on one of
 * the account's recording hosts exactly. A report's link is unsigned body data, so any other
 * address is refused and never receives the account's key.
 */
export function isExotelRecordingUrl(
  raw: string,
  hosts: readonly string[] = DEFAULT_RECORDING_HOSTS,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  return hosts.includes(url.hostname.toLowerCase());
}

/** The body of a response, read a chunk at a time and given up once it passes `maxBytes`. */
async function readWithin(response: Response, maxBytes: number): Promise<Uint8Array | undefined> {
  const reader = response.body?.getReader();
  if (reader === undefined) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** The kind of a downloaded recording, by the type Exotel sent or the file's extension. */
function recordingType(
  contentType: string | null,
  url: string,
): 'audio/mpeg' | 'audio/wav' | undefined {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'audio/mpeg';
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'audio/wav';
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.mp3')) return 'audio/mpeg';
  if (path.endsWith('.wav')) return 'audio/wav';
  return undefined;
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
        callConsentWithdrawn: input.callConsentWithdrawn,
      });
      if (!decision.allowed) throw new DialRefusedError(decision.refusals);

      const form = new URLSearchParams({
        From: input.agentNumber,
        To: input.customerNumber,
        CallerId: input.callerId,
        Record: input.record ? 'true' : 'false',
        StatusCallback: input.statusCallbackUrl,
        'StatusCallbackEvents[0]': 'terminal',
        // The answer too, so the caller's call bar shows the customer on the line as it happens.
        'StatusCallbackEvents[1]': 'answered',
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

    recordingAllowed(url) {
      return isExotelRecordingUrl(url, config.recordingHosts ?? DEFAULT_RECORDING_HOSTS);
    },

    async fetchRecording(url, maxBytes) {
      const hosts = config.recordingHosts ?? DEFAULT_RECORDING_HOSTS;
      if (!isExotelRecordingUrl(url, hosts)) {
        throw new ProviderError('exotel', 'invalid_response');
      }
      const download = (address: string) =>
        providerFetch(
          'exotel',
          { ...deps, timeoutMs: Math.max(deps.timeoutMs, RECORDING_TIMEOUT_MS) },
          address,
          // Only an allowed recording host is ever asked, so the key goes to those alone.
          { method: 'GET', headers: { authorization }, redirect: 'manual' },
          { retries: 2 },
        );
      let final = url;
      let response = await download(url);
      // Exotel may send the download on once, only to another of the allowed recording hosts.
      const next = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && next !== null) {
        const target = new URL(next, url).toString();
        if (!isExotelRecordingUrl(target, hosts)) {
          throw new ProviderError('exotel', 'invalid_response');
        }
        final = target;
        response = await download(target);
      }
      if (!response.ok) throw new ProviderError('exotel', 'http', { status: response.status });
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > maxBytes) {
        throw new ProviderError('exotel', 'invalid_response', { status: response.status });
      }
      // Read with a running count: a body that passes the limit is cancelled, never held whole.
      const bytes = await readWithin(response, maxBytes);
      const contentType = recordingType(response.headers.get('content-type'), final);
      if (bytes === undefined || bytes.length === 0 || contentType === undefined) {
        throw new ProviderError('exotel', 'invalid_response', { status: response.status });
      }
      return { bytes, contentType };
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
  const hosts = (env.EXOTEL_RECORDING_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^[a-z0-9.-]+$/.test(host));
  return {
    accountSid,
    apiKey,
    apiToken,
    subdomain: subdomain === '' ? 'api.in.exotel.com' : subdomain,
    recordingHosts: hosts.length === 0 ? DEFAULT_RECORDING_HOSTS : hosts,
  };
}
