import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bodyOf, stubFetch, urlOf } from '../test-fetch';
import { whatsappClient, whatsappConfig } from './client';
import { parseWhatsAppWebhook, verifyHandshake, verifyHubSignature } from './webhook';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const APP_SECRET = 'whatsapp-app-test-secret';
const VERIFY_TOKEN = 'whatsapp-verify-test-phrase';
const CONFIG = {
  phoneNumberId: '200000000000001',
  accessToken: 'whatsapp-test-access',
  apiVersion: 'v23.0',
  graphBaseUrl: 'https://graph.facebook.test',
};

/** The fixture bytes exactly as Meta would post them, since the signature covers the raw body. */
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const sign = (body: Buffer | string, secret = APP_SECRET) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const accepted = {
  messaging_product: 'whatsapp',
  contacts: [{ input: '919000000002', wa_id: '919000000002' }],
  messages: [{ id: 'wamid.sent-1', message_status: 'accepted' }],
};

function client(response: Response) {
  const fetchImpl = stubFetch(() => response);
  return { fetchImpl, wa: whatsappClient(CONFIG, { fetch: fetchImpl, timeoutMs: 1_000 }) };
}

describe('sending', () => {
  it('sends an approved template with its body values', async () => {
    const { fetchImpl, wa } = client(Response.json(accepted));
    await expect(
      wa.sendTemplate({
        to: '919000000002',
        templateName: 'quote_ready',
        languageCode: 'en',
        bodyParameters: ['Q-SS-2026-27-0042', '1,25,000'],
      }),
    ).resolves.toEqual({ messageId: 'wamid.sent-1', waId: '919000000002' });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe('https://graph.facebook.test/v23.0/200000000000001/messages');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer whatsapp-test-access');
    expect(JSON.parse(bodyOf(init))).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919000000002',
      type: 'template',
      template: {
        name: 'quote_ready',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Q-SS-2026-27-0042' },
              { type: 'text', text: '1,25,000' },
            ],
          },
        ],
      },
    });
  });

  it('sends a text inside the customer window', async () => {
    const { fetchImpl, wa } = client(Response.json(accepted));
    await wa.sendText({ to: '919000000002', body: 'Your survey is booked for Monday.' });
    expect(JSON.parse(bodyOf(fetchImpl.mock.calls[0]?.[1]))).toMatchObject({
      type: 'text',
      text: { body: 'Your survey is booked for Monday.', preview_url: false },
    });
  });

  it("reports Meta's error code and subcode, and refuses a malformed recipient", async () => {
    const { wa } = client(
      Response.json(
        {
          error: {
            message: 'outside window',
            type: 'OAuthException',
            code: 131047,
            error_subcode: 2494010,
          },
        },
        { status: 400 },
      ),
    );
    await expect(wa.sendText({ to: '919000000002', body: 'x' })).rejects.toMatchObject({
      provider: 'whatsapp',
      status: 400,
      vendorCode: '131047/2494010',
      retryable: false,
    });
    await expect(wa.sendText({ to: '+91 90000', body: 'x' })).rejects.toThrow(/E\.164/);
  });

  it('reads its settings only when the number id and access key are set', () => {
    expect(whatsappConfig({})).toBeUndefined();
    expect(
      whatsappConfig({ WHATSAPP_PHONE_NUMBER_ID: '2', WHATSAPP_ACCESS_TOKEN: 't' }),
    ).toMatchObject({ apiVersion: 'v23.0' });
  });
});

describe('the webhook handshake', () => {
  const params = (token: string) =>
    new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': token,
      'hub.challenge': '1158201444',
    });

  it('answers the challenge for our verify phrase only', () => {
    expect(verifyHandshake(params(VERIFY_TOKEN), VERIFY_TOKEN)).toEqual({
      ok: true,
      challenge: '1158201444',
    });
    expect(verifyHandshake(params('someone-else'), VERIFY_TOKEN)).toEqual({ ok: false });
    expect(verifyHandshake(params(''), '')).toEqual({ ok: false });
    expect(verifyHandshake(new URLSearchParams(), VERIFY_TOKEN)).toEqual({ ok: false });
  });
});

describe('X-Hub-Signature-256', () => {
  const body = fixture('inbound-text.json');

  it('accepts the signature of the exact raw body', () => {
    expect(verifyHubSignature(body, sign(body), APP_SECRET)).toBe(true);
    expect(verifyHubSignature(body.toString('utf8'), sign(body), APP_SECRET)).toBe(true);
  });

  it('refuses a missing, malformed or foreign signature, or a changed body', () => {
    expect(verifyHubSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyHubSignature(body, sign(body).replace('sha256=', 'sha1='), APP_SECRET)).toBe(
      false,
    );
    expect(verifyHubSignature(body, sign(body, 'another-app-secret'), APP_SECRET)).toBe(false);
    const reserialised = JSON.stringify(JSON.parse(body.toString('utf8')));
    expect(verifyHubSignature(reserialised, sign(body), APP_SECRET)).toBe(false);
    expect(verifyHubSignature(body, sign(body), '')).toBe(false);
  });
});

describe('webhook events', () => {
  it('reads an inbound text message', () => {
    const events = parseWhatsAppWebhook(JSON.parse(fixture('inbound-text.json').toString('utf8')));
    expect(events.messages).toEqual([
      {
        id: 'wamid.HBgMOTE5MDAwMDAwMDAyFQIAEhgUM0EwQjFDMkQzRTRGNUE2QjdDOEQA',
        phoneNumberId: '200000000000001',
        from: '919000000002',
        timestamp: 1790575200,
        type: 'text',
        text: '5 HP submersible ka rate batao',
      },
    ]);
    expect(events.statuses).toEqual([]);
  });

  it('reads delivery states, failure codes and template approvals', () => {
    const events = parseWhatsAppWebhook(JSON.parse(fixture('statuses.json').toString('utf8')));
    expect(events.statuses.map((s) => [s.status, s.errorCodes])).toEqual([
      ['delivered', []],
      ['failed', [131026]],
    ]);
    expect(events.templates).toEqual([{ templateName: 'quote_ready', event: 'APPROVED' }]);
  });

  it('ignores another object type and malformed entries', () => {
    expect(parseWhatsAppWebhook({ object: 'page', entry: [] })).toEqual({
      messages: [],
      statuses: [],
      templates: [],
    });
    expect(
      parseWhatsAppWebhook({
        object: 'whatsapp_business_account',
        entry: [{ changes: [{ field: 'messages', value: { messages: [{ type: 'text' }] } }] }],
      }).messages,
    ).toEqual([]);
  });
});
