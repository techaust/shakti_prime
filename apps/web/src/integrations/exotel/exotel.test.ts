import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../http';
import { bodyOf, stubFetch as stub, urlOf } from '../test-fetch';
import { DialRefusedError, exotelClient, exotelConfig, type ClickToDialInput } from './client';
import connectResponse from './fixtures/connect-response.json';
import statusCallback from './fixtures/status-callback.json';
import {
  parseStatusCallback,
  signedStatusCallbackUrl,
  verifyStatusCallbackUrl,
} from './status-callback';

// Low-entropy phrases, so the secret scan never mistakes them for keys (CLAUDE.md).
const CONFIG = {
  accountSid: 'shaktiprime1',
  apiKey: 'exotel-test-key',
  apiToken: 'exotel-test-token',
  subdomain: 'api.in.exotel.com',
};
const CALLBACK_SECRET = 'exotel-callback-test-secret';
const CALL_REF = '01931f6e-8a2b-7c3d-9e4f-5a6b7c8d9e0f';
const ELEVEN_AM_IST = new Date('2026-09-28T05:30:00Z');

const dial: ClickToDialInput = {
  agentNumber: '09000000001',
  customerNumber: '+91 90000 00002',
  callerId: '1400000000',
  purpose: 'promotional',
  hasRecordedConsent: false,
  onDnd: false,
  statusCallbackUrl: 'https://bos.shakti.test/api/v1/webhooks/exotel/call-status',
  record: true,
  customField: CALL_REF,
};

function stubFetch(response: Response) {
  return stub(() => response);
}

function client(fetchImpl: typeof fetch, now = ELEVEN_AM_IST) {
  return exotelClient(CONFIG, { fetch: fetchImpl, timeoutMs: 1_000, now: () => now });
}

describe('click-to-dial', () => {
  it('posts the dial form with basic auth and reads the call id', async () => {
    const fetchImpl = stubFetch(Response.json(connectResponse));
    const call = await client(fetchImpl).connectCall(dial);
    expect(call).toEqual({ sid: 'b6cfaf5e4d8a1c7e2f9d3a0b1c2d1a8f', status: 'in-progress' });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlOf(url)).toBe(
      'https://api.in.exotel.com/v1/Accounts/shaktiprime1/Calls/connect.json',
    );
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('exotel-test-key:exotel-test-token').toString('base64')}`,
    );
    const form = new URLSearchParams(bodyOf(init));
    expect(Object.fromEntries(form)).toMatchObject({
      From: '09000000001',
      To: '+91 90000 00002',
      CallerId: '1400000000',
      Record: 'true',
      'StatusCallbackEvents[0]': 'terminal',
      StatusCallbackContentType: 'application/json',
      CustomField: CALL_REF,
    });
  });

  it('never calls Exotel for a dial that breaks a calling rule', async () => {
    const fetchImpl = stubFetch(Response.json(connectResponse));
    const late = client(fetchImpl, new Date('2026-09-28T16:00:00Z')); // 21:30 IST
    await expect(late.connectCall(dial)).rejects.toMatchObject({
      refusals: ['outside_calling_hours'],
    });
    await expect(client(fetchImpl).connectCall({ ...dial, purpose: 'service' })).rejects.toEqual(
      new DialRefusedError(['caller_id_not_service', 'service_call_without_consent']),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports Exotel's error code without the body", async () => {
    const fetchImpl = stubFetch(
      Response.json(
        { RestException: { Status: 403, Code: 21210, Message: 'caller id' } },
        {
          status: 403,
        },
      ),
    );
    const error = await client(fetchImpl)
      .connectCall(dial)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ status: 403, vendorCode: '21210', retryable: false });
  });

  it('does not retry a dial that timed out, but retries a status read', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const failing = vi.fn(() => Promise.reject(timeout));
    await expect(client(failing).connectCall(dial)).rejects.toMatchObject({ failure: 'timeout' });
    expect(failing).toHaveBeenCalledTimes(1);

    const flaky = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json(connectResponse));
    await expect(client(flaky).getCall('b6cf')).resolves.toMatchObject({ status: 'in-progress' });
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it('refuses an answer without a call id', async () => {
    await expect(
      client(stubFetch(Response.json({ Call: {} }))).connectCall(dial),
    ).rejects.toMatchObject({ failure: 'invalid_response' });
  });

  it('reads its settings only when all are present', () => {
    expect(exotelConfig({})).toBeUndefined();
    expect(
      exotelConfig({ EXOTEL_ACCOUNT_SID: 'a', EXOTEL_API_KEY: 'b', EXOTEL_API_TOKEN: 'c' }),
    ).toEqual({ accountSid: 'a', apiKey: 'b', apiToken: 'c', subdomain: 'api.in.exotel.com' });
  });
});

describe('the status callback', () => {
  const base = 'https://bos.shakti.test/api/v1/webhooks/exotel/call-status';

  it('accepts its own signed address and names the call', () => {
    const url = signedStatusCallbackUrl(base, CALL_REF, CALLBACK_SECRET, ELEVEN_AM_IST);
    expect(verifyStatusCallbackUrl(url, CALLBACK_SECRET, ELEVEN_AM_IST)).toEqual({
      ok: true,
      ref: CALL_REF,
    });
  });

  it('refuses an unsigned, altered, re-pointed or expired address', () => {
    const url = new URL(signedStatusCallbackUrl(base, CALL_REF, CALLBACK_SECRET, ELEVEN_AM_IST));
    expect(verifyStatusCallbackUrl(base, CALLBACK_SECRET, ELEVEN_AM_IST)).toEqual({
      ok: false,
      problem: 'unsigned',
    });
    const other = new URL(url);
    other.searchParams.set('ref', '01931f6e-8a2b-7c3d-9e4f-000000000000');
    expect(verifyStatusCallbackUrl(other.toString(), CALLBACK_SECRET, ELEVEN_AM_IST)).toMatchObject(
      { problem: 'bad_signature' },
    );
    expect(
      verifyStatusCallbackUrl(url.toString(), 'another-callback-secret', ELEVEN_AM_IST),
    ).toMatchObject({ problem: 'bad_signature' });
    const twoDaysLater = new Date(ELEVEN_AM_IST.getTime() + 2 * 86_400_000);
    expect(verifyStatusCallbackUrl(url.toString(), CALLBACK_SECRET, twoDaysLater)).toMatchObject({
      problem: 'expired',
    });
  });

  it('reads a JSON callback', () => {
    expect(parseStatusCallback(JSON.stringify(statusCallback), 'application/json')).toEqual({
      callSid: 'b6cfaf5e4d8a1c7e2f9d3a0b1c2d1a8f',
      status: 'completed',
      conversationSeconds: 251,
      recordingUrl: 'https://recordings.exotel.test/shaktiprime1/b6cfaf5e.mp3',
      customField: CALL_REF,
      updatedAt: '2026-09-28 11:04:40',
    });
  });

  it('reads a form-encoded callback and an unanswered call', () => {
    const form = new URLSearchParams({
      CallSid: 'c1',
      Status: 'no-answer',
      DateUpdated: '2026-09-28 11:01:00',
    }).toString();
    expect(parseStatusCallback(form, 'application/x-www-form-urlencoded')).toEqual({
      callSid: 'c1',
      status: 'no-answer',
      conversationSeconds: undefined,
      recordingUrl: undefined,
      customField: undefined,
      updatedAt: '2026-09-28 11:01:00',
    });
  });

  it('ignores a body that names no call or is not JSON', () => {
    expect(parseStatusCallback('{}', 'application/json')).toBeUndefined();
    expect(parseStatusCallback('not json', 'application/json')).toBeUndefined();
  });

  it('reads the body through the published contract', () => {
    const form = (fields: Record<string, string>) =>
      parseStatusCallback(new URLSearchParams(fields).toString(), null);
    const base = { CallSid: 'c2', DateUpdated: '2026-09-28 11:01:00' };
    expect(form({ ...base, Status: 'In-Progress' })?.status).toBe('other');
    expect(form({ ...base, Status: 'Completed' })?.status).toBe('completed');
    expect(form({ ...base, Status: 'ringing' })).toBeUndefined();
    expect(form({ ...base, Status: 'busy', DateUpdated: 'yesterday' })).toBeUndefined();
    expect(form({ ...base, Status: 'busy', RecordingUrl: 'http://plain.test/a.mp3' })).toBe(
      undefined,
    );
  });
});
