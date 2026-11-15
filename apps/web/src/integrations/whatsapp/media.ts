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
import { DEFAULT_GRAPH_VERSION, whatsappClient, type WhatsAppClient } from './client';

/**
 * The system key's side of the WhatsApp Cloud API that is the same for every company's number: a
 * company's sends name its own number (`entity_channels.provider_ref`), and a customer's file is
 * fetched by its media id. Undefined while no access key is set (production until the final
 * phase, docs/03-roadmap-appendix/phase2.md §2 question 13).
 */
export interface WhatsAppAccess {
  accessToken: string;
  apiVersion: string;
  graphBaseUrl: string;
  /** The only hosts a media address may name: the system key is sent to no other. */
  mediaHosts: readonly string[];
}

/**
 * The hosts Meta serves a customer's WhatsApp file from (the Cloud API's media addresses), exactly;
 * an address on any other host is refused before the key is sent.
 */
export const WHATSAPP_MEDIA_HOSTS: readonly string[] = ['lookaside.fbsbx.com'];

/** Whether a media address is https on one of the allowed hosts, exactly. */
export function mediaAddressAllowed(url: string, hosts: readonly string[]): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.port === '' && hosts.includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function whatsappAccess(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppAccess | undefined {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN ?? '';
  if (accessToken === '') return undefined;
  const version = env.WHATSAPP_GRAPH_VERSION ?? '';
  return {
    accessToken,
    apiVersion: version === '' ? DEFAULT_GRAPH_VERSION : version,
    graphBaseUrl: 'https://graph.facebook.com',
    mediaHosts: WHATSAPP_MEDIA_HOSTS,
  };
}

/** The send client of one company's number. */
export function clientFor(access: WhatsAppAccess, phoneNumberId: string): WhatsAppClient {
  return whatsappClient({ ...access, phoneNumberId });
}

/** A customer's file as Meta holds it. */
export interface DownloadedMedia {
  bytes: Uint8Array;
  contentType: string;
}

/** The largest file a customer's message brings in, as an upload's limit (15 MB). */
export const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
const MEDIA_TIMEOUT_MS = 20_000;

/**
 * A customer's file by its media id: Meta answers its address, type and size, then the bytes, with
 * the system key, which goes only to an address on `access.mediaHosts`. A file over
 * `MEDIA_MAX_BYTES`, an address on any other host, or bytes that are not the size Meta said, are
 * refused as `invalid_response`. Reads may be retried; nothing is sent.
 */
export async function downloadMedia(
  access: WhatsAppAccess,
  mediaId: string,
  deps: HttpDeps = defaultHttpDeps(MEDIA_TIMEOUT_MS),
): Promise<DownloadedMedia> {
  const headers = { authorization: `Bearer ${access.accessToken}` };
  const info = await providerFetch(
    'whatsapp',
    deps,
    `${access.graphBaseUrl}/${access.apiVersion}/${encodeURIComponent(mediaId)}`,
    { method: 'GET', headers },
    { retries: 1 },
  );
  if (!info.ok) throw new ProviderError('whatsapp', 'http', { status: info.status });
  const body = await jsonBody('whatsapp', info);
  const url = asString(at(body, 'url'));
  const contentType = asString(at(body, 'mime_type'));
  const size = asNumber(at(body, 'file_size'));
  if (url === undefined || contentType === undefined || !mediaAddressAllowed(url, access.mediaHosts)) {
    throw new ProviderError('whatsapp', 'invalid_response', { status: info.status });
  }
  if (size !== undefined && size > MEDIA_MAX_BYTES) {
    throw new ProviderError('whatsapp', 'invalid_response', { status: info.status });
  }
  const file = await providerFetch('whatsapp', deps, url, { method: 'GET', headers }, { retries: 1 });
  if (!file.ok) throw new ProviderError('whatsapp', 'http', { status: file.status });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MEDIA_MAX_BYTES || (size !== undefined && bytes.length !== size)) {
    throw new ProviderError('whatsapp', 'invalid_response', { status: file.status });
  }
  return { bytes, contentType: contentType.split(';')[0]?.trim().toLowerCase() ?? contentType };
}
