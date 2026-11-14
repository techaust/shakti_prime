import { MetaLeadDetails } from '@shakti/contracts';
import {
  asNumber,
  at,
  defaultHttpDeps,
  jsonBody,
  ProviderError,
  providerFetch,
  type HttpDeps,
} from '../http';

/**
 * Meta Lead Ads (docs/03-roadmap-appendix/phase2.md §6.2, docs/06-api.md §6): the lead itself, read
 * from the Graph API (`GET /<leadgen_id>`) with the Page's token, since the webhook carries only
 * ids. A read, so it is tried twice; the token goes in the `Authorization` header, never in the
 * address, so no log or trace of the address holds it.
 */

/** Graph API version, pinned so Meta's upgrades are deliberate; the WhatsApp client's. */
export const LEADGEN_GRAPH_VERSION = 'v23.0';
export const LEADGEN_GRAPH_BASE = 'https://graph.facebook.com';
export const LEADGEN_TIMEOUT_MS = 4_000;

/** The fields asked of a lead: its ids for attribution, its answers and its consent boxes. */
const FIELDS = [
  'id',
  'created_time',
  'form_id',
  'ad_id',
  'adset_id',
  'campaign_id',
  'is_organic',
  'field_data',
  'custom_disclaimer_responses',
].join(',');

export interface MetaLeadClient {
  fetchLead(leadgenId: string, pageToken: string): Promise<MetaLeadDetails>;
}

async function failure(response: Response): Promise<ProviderError> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = asNumber(at(body, 'error', 'code'));
  return new ProviderError('meta_leadgen', 'http', {
    status: response.status,
    ...(code === undefined ? {} : { vendorCode: String(code) }),
  });
}

export function metaLeadClient(
  config: { graphBaseUrl: string; apiVersion: string } = {
    graphBaseUrl: LEADGEN_GRAPH_BASE,
    apiVersion: LEADGEN_GRAPH_VERSION,
  },
  deps: HttpDeps = defaultHttpDeps(LEADGEN_TIMEOUT_MS),
): MetaLeadClient {
  return {
    async fetchLead(leadgenId, pageToken) {
      if (!/^\d{1,40}$/.test(leadgenId)) {
        throw new ProviderError('meta_leadgen', 'invalid_response');
      }
      const url = `${config.graphBaseUrl}/${config.apiVersion}/${leadgenId}?fields=${FIELDS}`;
      const response = await providerFetch(
        'meta_leadgen',
        deps,
        url,
        { method: 'GET', headers: { authorization: `Bearer ${pageToken}` } },
        { retries: 1 },
      );
      if (!response.ok) throw await failure(response);
      const parsed = MetaLeadDetails.safeParse(await jsonBody('meta_leadgen', response));
      if (!parsed.success) {
        throw new ProviderError('meta_leadgen', 'invalid_response', { status: response.status });
      }
      return parsed.data;
    },
  };
}
