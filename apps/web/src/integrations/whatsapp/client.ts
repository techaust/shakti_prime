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
 * WhatsApp Cloud API sends (BLUEPRINT §10, docs/API.md §6). Transport only: the messaging worker
 * decides whether a message may go (opt-out, 24-hour window, template approval, tier budget,
 * output filter) before it calls this, and records the returned message id.
 */

export interface WhatsAppConfig {
  /** The entity's WhatsApp number id in Meta's Business Manager. */
  phoneNumberId: string;
  /** A system-user access token with `whatsapp_business_messaging`. */
  accessToken: string;
  /** Graph API version, pinned so Meta's upgrades are deliberate. */
  apiVersion: string;
  graphBaseUrl: string;
}

export const DEFAULT_GRAPH_VERSION = 'v23.0';
export const SEND_TIMEOUT_MS = 10_000;

export interface SentMessage {
  /** Meta's message id (`wamid.…`), the key status webhooks refer to. */
  messageId: string;
  /** The WhatsApp id Meta resolved the number to. */
  waId: string | undefined;
}

export interface TemplateMessage {
  /** E.164 digits without the plus, for example 919000000002. */
  to: string;
  templateName: string;
  /** The approved template's language code, for example `en` or `en_US`. */
  languageCode: string;
  /** Values for the body's {{1}}, {{2}} … in order. */
  bodyParameters: readonly string[];
}

export interface TextMessage {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface WhatsAppClient {
  sendTemplate(message: TemplateMessage): Promise<SentMessage>;
  sendText(message: TextMessage): Promise<SentMessage>;
}

const TO_PATTERN = /^[1-9]\d{7,14}$/;

async function failure(response: Response): Promise<ProviderError> {
  const body: unknown = await response.json().catch(() => undefined);
  const code = asNumber(at(body, 'error', 'code'));
  const subcode = asNumber(at(body, 'error', 'error_subcode'));
  const vendorCode =
    code === undefined
      ? undefined
      : subcode === undefined
        ? String(code)
        : `${String(code)}/${String(subcode)}`;
  return new ProviderError('whatsapp', 'http', {
    status: response.status,
    ...(vendorCode === undefined ? {} : { vendorCode }),
  });
}

export function whatsappClient(
  config: WhatsAppConfig,
  deps: HttpDeps = defaultHttpDeps(SEND_TIMEOUT_MS),
): WhatsAppClient {
  const url = `${config.graphBaseUrl}/${config.apiVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`;

  async function send(to: string, payload: Record<string, unknown>): Promise<SentMessage> {
    if (!TO_PATTERN.test(to)) throw new Error('the recipient must be E.164 digits without a plus');
    // A send is never retried here: a timeout does not prove Meta did not deliver it.
    const response = await providerFetch('whatsapp', deps, url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...payload,
      }),
    });
    if (!response.ok) throw await failure(response);
    const body = await jsonBody('whatsapp', response);
    const messageId = asString(at(body, 'messages', 0, 'id'));
    if (messageId === undefined || messageId === '') {
      throw new ProviderError('whatsapp', 'invalid_response', { status: response.status });
    }
    return { messageId, waId: asString(at(body, 'contacts', 0, 'wa_id')) };
  }

  return {
    sendTemplate(message) {
      return send(message.to, {
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          components:
            message.bodyParameters.length === 0
              ? []
              : [
                  {
                    type: 'body',
                    parameters: message.bodyParameters.map((text) => ({ type: 'text', text })),
                  },
                ],
        },
      });
    },
    sendText(message) {
      return send(message.to, {
        type: 'text',
        text: { body: message.body, preview_url: message.previewUrl ?? false },
      });
    },
  };
}

/** WhatsApp settings from the environment, or undefined when any is missing. */
export function whatsappConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): WhatsAppConfig | undefined {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID ?? '';
  const accessToken = env.WHATSAPP_ACCESS_TOKEN ?? '';
  if (phoneNumberId === '' || accessToken === '') return undefined;
  const version = env.WHATSAPP_GRAPH_VERSION ?? '';
  return {
    phoneNumberId,
    accessToken,
    apiVersion: version === '' ? DEFAULT_GRAPH_VERSION : version,
    graphBaseUrl: 'https://graph.facebook.com',
  };
}
